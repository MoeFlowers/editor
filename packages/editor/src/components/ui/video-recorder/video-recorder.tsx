'use client'

import { Circle, Download, Mic, Pause, Play, Square, Video, X } from 'lucide-react'
import { type ReactNode, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../../../lib/utils'
import {
  formatRecordingTime,
  type OrbitSpeed,
  VIDEO_FPS_OPTIONS,
  VIDEO_QUALITY_LABELS,
  type VideoFormatPreference,
  type VideoQuality,
} from '../../../lib/video-recorder'
import {
  downloadLastTake,
  isVideoRecordingSupported,
  useVideoRecorder,
} from '../../../store/use-video-recorder'
import { Popover, PopoverContent, PopoverTrigger } from '../primitives/popover'
import { Switch } from '../primitives/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'

/** Global shortcut: start a take, or stop the running one. Works in walkthrough
 *  (pointer lock keeps keyboard events flowing) where the toolbar is hidden. */
export const VIDEO_RECORDER_SHORTCUT_LABEL = 'Ctrl+Alt+R'

export function toggleVideoRecording() {
  const { status, start, stop } = useVideoRecorder.getState()
  if (status === 'idle') void start()
  else stop()
}

function useElapsedMs(): number {
  const status = useVideoRecorder((s) => s.status)
  const segmentStartedAt = useVideoRecorder((s) => s.segmentStartedAt)
  const accumulatedMs = useVideoRecorder((s) => s.accumulatedMs)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (status !== 'recording') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [status])
  return accumulatedMs + (segmentStartedAt === null ? 0 : Math.max(0, now - segmentStartedAt))
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5">
      {options.map((option) => (
        <button
          className={cn(
            'rounded-md px-2 py-1 text-xs transition-colors disabled:opacity-50',
            option.value === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
          disabled={disabled}
          key={String(option.value)}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs text-foreground">{label}</div>
        {hint && <div className="text-[11px] leading-tight text-muted-foreground">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

const QUALITY_OPTIONS = (Object.keys(VIDEO_QUALITY_LABELS) as VideoQuality[]).map((q) => ({
  value: q,
  label: VIDEO_QUALITY_LABELS[q],
}))
const FPS_OPTIONS = VIDEO_FPS_OPTIONS.map((fps) => ({ value: fps, label: `${fps}` }))
const FORMAT_OPTIONS: { value: VideoFormatPreference; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'mp4', label: 'MP4' },
  { value: 'webm', label: 'WebM' },
]
const ORBIT_OPTIONS: { value: OrbitSpeed; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'slow', label: 'Slow' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Fast' },
]

/** Settings + start. Rendered inside the popover of {@link VideoRecordButton}. */
export function VideoRecorderPanel({ onStart }: { onStart?: () => void }) {
  const settings = useVideoRecorder()
  const { setSettings } = settings
  const supported = isVideoRecordingSupported()

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="font-medium text-sm">Record video</div>
        <div className="text-[11px] text-muted-foreground">
          Records the 3D view only — panels and cursor stay out of the video. Orbit, walk through
          (Walkthrough) or edit while recording.
        </div>
      </div>

      <SettingRow label="Quality">
        <Segmented
          onChange={(quality) => setSettings({ quality })}
          options={QUALITY_OPTIONS}
          value={settings.quality}
        />
      </SettingRow>
      <SettingRow label="Frame rate" hint="fps">
        <Segmented
          onChange={(fps) => setSettings({ fps })}
          options={FPS_OPTIONS}
          value={settings.fps}
        />
      </SettingRow>
      <SettingRow label="Format" hint="Auto = MP4 when the browser supports it">
        <Segmented
          onChange={(format) => setSettings({ format })}
          options={FORMAT_OPTIONS}
          value={settings.format}
        />
      </SettingRow>
      <SettingRow label="Cinematic orbit" hint="Turntable around the view target">
        <Segmented
          onChange={(orbit) => setSettings({ orbit })}
          options={ORBIT_OPTIONS}
          value={settings.orbit}
        />
      </SettingRow>
      <SettingRow label="Narrate with microphone">
        <Switch
          checked={settings.microphone}
          onCheckedChange={(microphone) => setSettings({ microphone })}
        />
      </SettingRow>
      <SettingRow label="Clean view" hint="Hide grid, handles and panels (preview mode)">
        <Switch
          checked={settings.cleanView}
          onCheckedChange={(cleanView) => setSettings({ cleanView })}
        />
      </SettingRow>
      <SettingRow label="3-second countdown">
        <Switch
          checked={settings.countdown}
          onCheckedChange={(countdown) => setSettings({ countdown })}
        />
      </SettingRow>

      <button
        className="flex h-8 items-center justify-center gap-2 rounded-lg bg-red-600 font-medium text-sm text-white transition-colors hover:bg-red-500 disabled:opacity-50"
        disabled={!supported || settings.status !== 'idle'}
        onClick={() => {
          onStart?.()
          void settings.start()
        }}
        type="button"
      >
        <Circle className="h-3 w-3 fill-current" />
        Start recording
        <span className="text-[10px] text-white/70">{VIDEO_RECORDER_SHORTCUT_LABEL}</span>
      </button>
      {!supported && (
        <div className="text-[11px] text-red-400">
          This browser cannot record the canvas. Use a recent Chrome, Edge or Firefox.
        </div>
      )}
    </div>
  )
}

/**
 * Toolbar button for the viewer toolbar. Idle: opens the settings popover.
 * Recording: stops the take.
 */
export function VideoRecordButton({ className }: { className?: string }) {
  const status = useVideoRecorder((s) => s.status)
  const stop = useVideoRecorder((s) => s.stop)
  const [open, setOpen] = useState(false)
  const busy = status !== 'idle'

  if (busy) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label="Stop recording"
            className={cn(
              'flex w-8 items-center justify-center text-red-500 transition-colors hover:bg-white/8',
              className,
            )}
            onClick={stop}
            type="button"
          >
            <Square className="h-3.5 w-3.5 animate-pulse fill-current" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">Stop recording</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              aria-label="Record video"
              className={cn(
                'flex w-8 items-center justify-center text-muted-foreground/80 transition-colors hover:bg-white/8 hover:text-foreground/90',
                open && 'bg-white/8 text-foreground',
                className,
              )}
              type="button"
            >
              <Video className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">Record video</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="dark w-80 text-foreground" sideOffset={8}>
        <VideoRecorderPanel onStart={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Always-mounted overlay: countdown, REC pill with timer / pause / stop, the
 * "saved" toast, and the global shortcut. Portaled to <body> so it survives
 * every editor layout (v1, v2, preview, walkthrough, capture mode). It is DOM,
 * not canvas, so it never appears in the recorded video.
 */
export function VideoRecorderHud() {
  const status = useVideoRecorder((s) => s.status)
  const countdownValue = useVideoRecorder((s) => s.countdownValue)
  const microphone = useVideoRecorder((s) => s.microphone)
  const error = useVideoRecorder((s) => s.error)
  const lastTake = useVideoRecorder((s) => s.lastTake)
  const { stop, togglePause, cancelCountdown, dismissLastTake, clearError } =
    useVideoRecorder.getState()
  const elapsed = useElapsedMs()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && !event.shiftKey && event.code === 'KeyR') {
        event.preventDefault()
        toggleVideoRecording()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Recording in a background tab stalls the render loop — the video freezes.
  useEffect(() => {
    if (status !== 'recording') return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [status])

  useEffect(() => {
    if (!error) return
    const id = setTimeout(clearError, 5000)
    return () => clearTimeout(id)
  }, [error, clearError])

  if (!mounted) return null

  return createPortal(
    <div className="dark pointer-events-none fixed inset-0 z-[90] text-foreground">
      {status === 'countdown' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
          <div className="flex h-28 w-28 items-center justify-center rounded-full bg-black/55 font-semibold text-6xl text-white tabular-nums shadow-2xl backdrop-blur">
            {countdownValue}
          </div>
          <button
            className="pointer-events-auto rounded-full bg-black/55 px-3 py-1 text-white/80 text-xs backdrop-blur hover:text-white"
            onClick={cancelCountdown}
            type="button"
          >
            Cancel
          </button>
        </div>
      )}

      {(status === 'recording' || status === 'paused') && (
        <div className="absolute top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background/90 py-1 pr-1 pl-3 shadow-2xl backdrop-blur-md">
          <span
            className={cn(
              'h-2.5 w-2.5 rounded-full bg-red-500',
              status === 'recording' && 'animate-pulse',
              status === 'paused' && 'bg-amber-400',
            )}
          />
          <span className="min-w-12 pl-1 font-medium text-xs tabular-nums">
            {status === 'paused' ? 'Paused' : 'REC'} {formatRecordingTime(elapsed)}
          </span>
          {microphone && <Mic className="h-3.5 w-3.5 text-muted-foreground" />}
          <button
            aria-label={status === 'paused' ? 'Resume recording' : 'Pause recording'}
            className="pointer-events-auto ml-1 flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"
            onClick={togglePause}
            title={status === 'paused' ? 'Resume' : 'Pause'}
            type="button"
          >
            {status === 'paused' ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          </button>
          <button
            aria-label="Stop recording"
            className="pointer-events-auto flex h-7 items-center gap-1.5 rounded-full bg-red-600 px-3 font-medium text-white text-xs hover:bg-red-500"
            onClick={stop}
            title={`Stop and save (${VIDEO_RECORDER_SHORTCUT_LABEL})`}
            type="button"
          >
            <Square className="h-3 w-3 fill-current" />
            Stop
          </button>
        </div>
      )}

      {status === 'idle' && lastTake && (
        <div className="pointer-events-auto absolute right-4 bottom-4 flex items-center gap-2 rounded-xl border border-border bg-background/95 py-2 pr-2 pl-3 text-xs shadow-2xl backdrop-blur-md">
          <Video className="h-4 w-4 text-muted-foreground" />
          <div>
            <div className="font-medium">Video saved</div>
            <div className="text-muted-foreground">
              {lastTake.fileName} · {formatRecordingTime(lastTake.durationMs)} ·{' '}
              {formatSize(lastTake.sizeBytes)}
            </div>
          </div>
          <button
            aria-label="Download again"
            className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-white/10"
            onClick={downloadLastTake}
            title="Download again"
            type="button"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <button
            aria-label="Dismiss"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-white/10"
            onClick={dismissLastTake}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && (
        <div className="pointer-events-auto absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-red-500/40 bg-background/95 px-3 py-2 text-red-300 text-xs shadow-2xl">
          {error}
        </div>
      )}
    </div>,
    document.body,
  )
}
