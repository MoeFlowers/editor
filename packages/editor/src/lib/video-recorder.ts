// Pure helpers for the in-editor video recorder (store/use-video-recorder.ts).
// Kept free of DOM globals so they can be unit-tested under `bun test`.

export type VideoFormatPreference = 'auto' | 'mp4' | 'webm'
export type VideoQuality = 'standard' | 'high' | 'ultra'
export type VideoFps = 24 | 30 | 50

/** Video bitrate per quality preset, in bits/second. Sized for a ~1080p canvas. */
export const VIDEO_BITRATES: Record<VideoQuality, number> = {
  standard: 6_000_000,
  high: 12_000_000,
  ultra: 25_000_000,
}

export const VIDEO_QUALITY_LABELS: Record<VideoQuality, string> = {
  standard: 'Standard',
  high: 'High',
  ultra: 'Ultra',
}

export const VIDEO_FPS_OPTIONS: readonly VideoFps[] = [24, 30, 50]

/**
 * Candidate MediaRecorder MIME types, best first. MP4/H.264 plays everywhere
 * (WhatsApp, Instagram, PowerPoint) but only recent Chromium/Safari can record
 * it; WebM/VP9 is the universal Chromium/Firefox fallback.
 */
const MP4_CANDIDATES = (withAudio: boolean) =>
  withAudio
    ? ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4']
    : ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4']

const WEBM_CANDIDATES = (withAudio: boolean) =>
  withAudio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']

/**
 * Picks the first MIME type the browser can record for the requested format.
 * `auto` prefers MP4 and falls back to WebM. Returns null when nothing works.
 */
export function pickVideoMimeType(
  preference: VideoFormatPreference,
  withAudio: boolean,
  isTypeSupported: (type: string) => boolean,
): string | null {
  const order =
    preference === 'webm'
      ? [...WEBM_CANDIDATES(withAudio), ...MP4_CANDIDATES(withAudio)]
      : [...MP4_CANDIDATES(withAudio), ...WEBM_CANDIDATES(withAudio)]
  return order.find((type) => isTypeSupported(type)) ?? null
}

export function videoExtensionFor(mimeType: string): 'mp4' | 'webm' {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm'
}

/** `pascal_2026-09-27_15-42-08.mp4` — sortable, filesystem-safe. */
export function videoFileName(mimeType: string, date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `pascal_${stamp}.${videoExtensionFor(mimeType)}`
}

/** `mm:ss`, or `h:mm:ss` past an hour. */
export function formatRecordingTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/**
 * Orbit speed for the cinematic turntable, in radians/second.
 * `slow` completes a full turn in 60 s, `normal` in 30 s, `fast` in 15 s.
 */
export type OrbitSpeed = 'off' | 'slow' | 'normal' | 'fast'
export const ORBIT_SECONDS_PER_TURN: Record<Exclude<OrbitSpeed, 'off'>, number> = {
  slow: 60,
  normal: 30,
  fast: 15,
}
export function orbitRadiansPerSecond(speed: OrbitSpeed): number {
  if (speed === 'off') return 0
  return (2 * Math.PI) / ORBIT_SECONDS_PER_TURN[speed]
}
