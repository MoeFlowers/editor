import { describe, expect, it } from 'bun:test'
import {
  formatRecordingTime,
  orbitRadiansPerSecond,
  pickVideoMimeType,
  videoExtensionFor,
  videoFileName,
} from './video-recorder'

const supports =
  (...types: string[]) =>
  (type: string) =>
    types.includes(type)

describe('pickVideoMimeType', () => {
  it('prefers H.264 MP4 in auto mode when the browser can record it', () => {
    const pick = pickVideoMimeType(
      'auto',
      false,
      supports('video/mp4;codecs=avc1.640028', 'video/webm;codecs=vp9'),
    )
    expect(pick).toBe('video/mp4;codecs=avc1.640028')
  })

  it('falls back to WebM when MP4 is unavailable', () => {
    expect(pickVideoMimeType('auto', false, supports('video/webm;codecs=vp8'))).toBe(
      'video/webm;codecs=vp8',
    )
  })

  it('prefers WebM when asked, and asks for an audio codec with narration', () => {
    const pick = pickVideoMimeType(
      'webm',
      true,
      supports('video/mp4;codecs=avc1,mp4a.40.2', 'video/webm;codecs=vp9,opus'),
    )
    expect(pick).toBe('video/webm;codecs=vp9,opus')
  })

  it('returns null when nothing is recordable', () => {
    expect(pickVideoMimeType('auto', false, () => false)).toBeNull()
  })
})

describe('file naming', () => {
  it('maps MIME types to extensions', () => {
    expect(videoExtensionFor('video/mp4;codecs=avc1')).toBe('mp4')
    expect(videoExtensionFor('video/webm;codecs=vp9')).toBe('webm')
  })

  it('builds a sortable, filesystem-safe name', () => {
    const name = videoFileName('video/mp4', new Date(2026, 8, 7, 5, 4, 3))
    expect(name).toBe('pascal_2026-09-07_05-04-03.mp4')
  })
})

describe('formatRecordingTime', () => {
  it('formats minutes and hours', () => {
    expect(formatRecordingTime(0)).toBe('00:00')
    expect(formatRecordingTime(65_400)).toBe('01:05')
    expect(formatRecordingTime(3_725_000)).toBe('1:02:05')
  })
})

describe('orbitRadiansPerSecond', () => {
  it('turns a full circle in the preset duration', () => {
    expect(orbitRadiansPerSecond('off')).toBe(0)
    expect(orbitRadiansPerSecond('normal') * 30).toBeCloseTo(2 * Math.PI)
  })
})
