'use client'

import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import {
  type OrbitSpeed,
  pickVideoMimeType,
  VIDEO_BITRATES,
  type VideoFormatPreference,
  type VideoFps,
  type VideoQuality,
  videoFileName,
} from '../lib/video-recorder'
import useEditor from './use-editor'

export type VideoRecorderStatus = 'idle' | 'countdown' | 'starting' | 'recording' | 'paused'

export type VideoRecorderSettings = {
  quality: VideoQuality
  fps: VideoFps
  format: VideoFormatPreference
  /** Mix the microphone in so the walkthrough can be narrated live. */
  microphone: boolean
  /** 3-2-1 before the first frame, so the UI click is not in the take. */
  countdown: boolean
  /** Slow turntable around the camera target while recording (orbit view only). */
  orbit: OrbitSpeed
  /** Switch to preview mode (no grid, handles or panels) for the take. */
  cleanView: boolean
}

type VideoRecorderState = VideoRecorderSettings & {
  status: VideoRecorderStatus
  countdownValue: number
  /** Wall-clock ms of the running segment start; null while paused/idle. */
  segmentStartedAt: number | null
  /** Recorded ms accumulated before the current segment (pause support). */
  accumulatedMs: number
  error: string | null
  /** Last finished take, kept so the HUD can offer it again. */
  lastTake: { url: string; fileName: string; sizeBytes: number; durationMs: number } | null
  setSettings: (settings: Partial<VideoRecorderSettings>) => void
  start: () => Promise<void>
  stop: () => void
  togglePause: () => void
  cancelCountdown: () => void
  dismissLastTake: () => void
  clearError: () => void
}

// Live objects stay outside zustand: they are not serialisable and must never
// trigger React renders.
let recorder: MediaRecorder | null = null
let canvasStream: MediaStream | null = null
let micStream: MediaStream | null = null
let chunks: Blob[] = []
let countdownTimer: ReturnType<typeof setInterval> | null = null
let canvasWatchdog: ReturnType<typeof setInterval> | null = null
let restorePreviewMode: boolean | null = null
/** Canvas on screen before "clean view" switched to preview mode. Preview mode
 *  mounts a new <Canvas>, so recording must wait for the replacement. */
let canvasBeforeViewSwitch: HTMLCanvasElement | null = null

/** The 3D viewer canvas. Split view mounts a 2D floorplan beside it, so prefer
 *  the viewer's own container and fall back to the largest canvas on the page. */
export function findViewerCanvas(): HTMLCanvasElement | null {
  const tagged = document.querySelector<HTMLCanvasElement>('[data-pascal-viewer-3d] canvas')
  if (tagged) return tagged
  let best: HTMLCanvasElement | null = null
  for (const canvas of document.querySelectorAll('canvas')) {
    if (!best || canvas.width * canvas.height > best.width * best.height) best = canvas
  }
  return best
}

export function isVideoRecordingSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype
  )
}

/**
 * Resolves the canvas to record once it is live. After a preview-mode switch the
 * old canvas is detached and a new one mounts a few frames later; timers (not
 * rAF) poll so a backgrounded tab cannot stall the wait.
 */
async function waitForViewerCanvas(previous: HTMLCanvasElement | null, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const canvas = findViewerCanvas()
    if (canvas?.isConnected && canvas !== previous && canvas.width > 0) return canvas
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const fallback = findViewerCanvas()
  return fallback?.isConnected ? fallback : null
}

function releaseStreams() {
  if (canvasWatchdog) clearInterval(canvasWatchdog)
  canvasWatchdog = null
  for (const track of canvasStream?.getTracks() ?? []) track.stop()
  for (const track of micStream?.getTracks() ?? []) track.stop()
  canvasStream = null
  micStream = null
  recorder = null
}

function restoreView() {
  if (restorePreviewMode === null) return
  useEditor.getState().setPreviewMode(restorePreviewMode)
  restorePreviewMode = null
}

function download(url: string, fileName: string) {
  Object.assign(document.createElement('a'), { href: url, download: fileName }).click()
}

export const useVideoRecorder = create<VideoRecorderState>()(
  persist(
    (set, get) => {
      const beginRecording = async () => {
        set({ status: 'starting' })
        const canvas = await waitForViewerCanvas(canvasBeforeViewSwitch)
        canvasBeforeViewSwitch = null
        if (get().status !== 'starting') return // cancelled while waiting
        if (!canvas) {
          set({ status: 'idle', error: 'No 3D view to record. Switch to the 3D view first.' })
          restoreView()
          return
        }
        const { fps, quality, format, microphone } = get()

        canvasStream = canvas.captureStream(fps)
        const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()]
        if (microphone) {
          try {
            micStream = await navigator.mediaDevices.getUserMedia({
              audio: { echoCancellation: true, noiseSuppression: true },
            })
            tracks.push(...micStream.getAudioTracks())
          } catch {
            // Denied or no device: keep recording silently rather than failing the take.
            set({ error: 'Microphone unavailable — recording without narration.' })
          }
        }

        const withAudio = tracks.some((t) => t.kind === 'audio')
        const mimeType = pickVideoMimeType(format, withAudio, (t) =>
          MediaRecorder.isTypeSupported(t),
        )
        if (!mimeType) {
          releaseStreams()
          restoreView()
          set({ status: 'idle', error: 'This browser cannot record video (MediaRecorder).' })
          return
        }

        chunks = []
        const stream = new MediaStream(tracks)
        const rec = new MediaRecorder(stream, {
          mimeType,
          videoBitsPerSecond: VIDEO_BITRATES[quality],
          audioBitsPerSecond: 128_000,
        })
        recorder = rec
        rec.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data)
        }
        rec.onstop = () => {
          const state = get()
          const durationMs =
            state.accumulatedMs +
            (state.segmentStartedAt === null ? 0 : Date.now() - state.segmentStartedAt)
          const blob = new Blob(chunks, { type: mimeType.split(';')[0] })
          chunks = []
          releaseStreams()
          restoreView()
          if (state.lastTake) URL.revokeObjectURL(state.lastTake.url)
          if (blob.size === 0) {
            set({
              status: 'idle',
              segmentStartedAt: null,
              accumulatedMs: 0,
              lastTake: null,
              error: 'The recording was empty — the 3D view produced no frames.',
            })
            return
          }
          const url = URL.createObjectURL(blob)
          const fileName = videoFileName(mimeType)
          download(url, fileName)
          set({
            status: 'idle',
            segmentStartedAt: null,
            accumulatedMs: 0,
            lastTake: { url, fileName, sizeBytes: blob.size, durationMs },
          })
        }
        // The canvas can be torn down mid-take (preview toggle, VR entry, layout
        // switch). A detached canvas keeps a live track that simply stops
        // producing frames, so watch the element too — then save what we have.
        const endTake = (reason: string) => {
          if (get().status === 'recording' || get().status === 'paused') {
            set({ error: reason })
            get().stop()
          }
        }
        canvasStream
          .getVideoTracks()[0]
          ?.addEventListener('ended', () => endTake('The 3D view closed — recording saved.'))
        canvasWatchdog = setInterval(() => {
          if (!canvas.isConnected) {
            endTake('The 3D view was reloaded (view switch) — recording saved up to that point.')
          }
        }, 500)

        // 1 s timeslices keep memory flat-ish and survive a tab crash mid-take.
        rec.start(1000)
        set({ status: 'recording', segmentStartedAt: Date.now(), accumulatedMs: 0 })
      }

      return {
        quality: 'high',
        fps: 30,
        format: 'auto',
        microphone: false,
        countdown: true,
        orbit: 'off',
        cleanView: false,
        status: 'idle',
        countdownValue: 0,
        segmentStartedAt: null,
        accumulatedMs: 0,
        error: null,
        lastTake: null,

        setSettings: (settings) => set(settings),

        start: async () => {
          if (get().status !== 'idle') return
          if (!isVideoRecordingSupported()) {
            set({ error: 'This browser cannot record video (MediaRecorder).' })
            return
          }
          set({ error: null })
          if (get().cleanView) {
            const editor = useEditor.getState()
            restorePreviewMode = editor.isPreviewMode
            if (!editor.isPreviewMode) {
              canvasBeforeViewSwitch = findViewerCanvas()
              editor.setPreviewMode(true)
            }
          }
          if (!get().countdown) {
            await beginRecording()
            return
          }
          set({ status: 'countdown', countdownValue: 3 })
          countdownTimer = setInterval(() => {
            const next = get().countdownValue - 1
            if (next > 0) {
              set({ countdownValue: next })
              return
            }
            if (countdownTimer) clearInterval(countdownTimer)
            countdownTimer = null
            set({ countdownValue: 0 })
            void beginRecording()
          }, 1000)
        },

        cancelCountdown: () => {
          if (countdownTimer) clearInterval(countdownTimer)
          countdownTimer = null
          restoreView()
          set({ status: 'idle', countdownValue: 0 })
        },

        stop: () => {
          const { status } = get()
          if (status === 'countdown' || status === 'starting') {
            // `starting` is awaiting the canvas; beginRecording sees the status
            // change and bails out.
            canvasBeforeViewSwitch = null
            get().cancelCountdown()
            return
          }
          if (!recorder || recorder.state === 'inactive') return
          // Freeze the clock now; onstop reads it once the final chunk flushes.
          if (status === 'recording') {
            const { segmentStartedAt, accumulatedMs } = get()
            set({
              accumulatedMs: accumulatedMs + (segmentStartedAt ? Date.now() - segmentStartedAt : 0),
              segmentStartedAt: null,
            })
          }
          recorder.stop()
        },

        togglePause: () => {
          if (!recorder) return
          const { status, segmentStartedAt, accumulatedMs } = get()
          if (status === 'recording' && recorder.state === 'recording') {
            recorder.pause()
            set({
              status: 'paused',
              accumulatedMs: accumulatedMs + (segmentStartedAt ? Date.now() - segmentStartedAt : 0),
              segmentStartedAt: null,
            })
          } else if (status === 'paused' && recorder.state === 'paused') {
            recorder.resume()
            set({ status: 'recording', segmentStartedAt: Date.now() })
          }
        },

        dismissLastTake: () => {
          const { lastTake } = get()
          if (lastTake) URL.revokeObjectURL(lastTake.url)
          set({ lastTake: null })
        },

        clearError: () => set({ error: null }),
      }
    },
    {
      name: 'pascal-video-recorder',
      storage: createJSONStorage(() => localStorage),
      // Only preferences survive a reload — never live recording state.
      partialize: (s) => ({
        quality: s.quality,
        fps: s.fps,
        format: s.format,
        microphone: s.microphone,
        countdown: s.countdown,
        orbit: s.orbit,
        cleanView: s.cleanView,
      }),
    },
  ),
)

/** Re-download the last take (e.g. the browser blocked the automatic download). */
export function downloadLastTake() {
  const take = useVideoRecorder.getState().lastTake
  if (take) download(take.url, take.fileName)
}
