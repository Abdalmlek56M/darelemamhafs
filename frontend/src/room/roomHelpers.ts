import { DisconnectReason, Track, type Participant } from 'livekit-client'
import type { LiveParticipantTile } from './roomTypes'

export type DisconnectOutcome =
  | { kind: 'ended' }
  | { kind: 'removed'; message: string }
  | { kind: 'local' }

export type PublishKind = 'microphone' | 'camera' | 'screen'
export type ScreenShareSupport = 'ok' | 'insecure' | 'unsupported'

export const HOST_MUTED_NOTICE = 'المعلمة كتمت صوتك'
export const REMOVED_FROM_ROOM_MESSAGE = 'تمت إزالتك من الغرفة'
export const SCREEN_SHARE_INSECURE_NOTICE =
  'مشاركة الشاشة تعمل فقط عبر اتصال آمن (HTTPS). افتح رابط الغرفة بعنوان يبدأ بـ https:// ثم حاول مرة أخرى.'
export const SCREEN_SHARE_UNSUPPORTED_NOTICE =
  'متصفحك لا يدعم مشاركة الشاشة. جرّب متصفح Chrome أو Edge على الحاسوب.'
const SCREEN_SHARE_FAILED_NOTICE = 'تعذرت مشاركة الشاشة. تأكد من السماح بالمشاركة ثم حاول مرة أخرى.'

export function buildTile(p: Participant, isLocal: boolean): LiveParticipantTile {
  let metaRole = 'participant'
  try {
    if (p.metadata) metaRole = JSON.parse(p.metadata).role ?? 'participant'
  } catch { /* ignore invalid metadata */ }
  const camPub = p.getTrackPublication(Track.Source.Camera)
  const micPub = p.getTrackPublication(Track.Source.Microphone)
  const screenPub = p.getTrackPublication(Track.Source.ScreenShare)
  return {
    identity: p.identity,
    name: p.name || p.identity,
    isLocal,
    isHost: metaRole === 'host',
    micEnabled: Boolean(micPub && !micPub.isMuted),
    cameraEnabled: Boolean(camPub && !camPub.isMuted),
    screenEnabled: Boolean(screenPub && !screenPub.isMuted),
    videoTrack: camPub?.track && !camPub.isMuted ? camPub.track : null,
    screenTrack: screenPub?.track && !screenPub.isMuted && screenPub.track.mediaStreamTrack?.readyState !== 'ended'
      ? screenPub.track
      : null,
    audioTrack: !isLocal && micPub?.track && !micPub.isMuted ? micPub.track : null,
  }
}

export function resolveDisconnectOutcome(reason?: DisconnectReason): DisconnectOutcome {
  if (reason === DisconnectReason.PARTICIPANT_REMOVED) {
    return { kind: 'removed', message: REMOVED_FROM_ROOM_MESSAGE }
  }
  if (reason === DisconnectReason.ROOM_DELETED || reason === DisconnectReason.ROOM_CLOSED) {
    return { kind: 'ended' }
  }
  return { kind: 'local' }
}

/** Decides whether getDisplayMedia can work at all (secure page + browser support). */
export function getScreenShareSupport(env?: { secure: boolean; hasApi: boolean }): ScreenShareSupport {
  const secure = env?.secure ?? (typeof window === 'undefined' ? true : window.isSecureContext !== false)
  const hasApi = env?.hasApi
    ?? Boolean(typeof navigator !== 'undefined' && navigator.mediaDevices?.getDisplayMedia)
  if (!secure) return 'insecure'
  return hasApi ? 'ok' : 'unsupported'
}

export function screenShareSupportNotice(support: ScreenShareSupport): string {
  if (support === 'insecure') return SCREEN_SHARE_INSECURE_NOTICE
  if (support === 'unsupported') return SCREEN_SHARE_UNSUPPORTED_NOTICE
  return ''
}

function errorName(err: unknown): string {
  if (err && typeof err === 'object' && 'name' in err) return String((err as { name: unknown }).name)
  return ''
}

/**
 * Maps a failed publish attempt to a friendly Arabic notice.
 * Returns null when the user simply dismissed the browser picker (no message needed).
 */
export function formatPublishError(kind: PublishKind, err: unknown, hostMuted: boolean): string | null {
  const name = errorName(err)
  const lowered = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()

  if (kind === 'screen') {
    if (name === 'NotAllowedError' || name === 'AbortError') return null
    const support = getScreenShareSupport()
    if (support !== 'ok') return screenShareSupportNotice(support)
    if (name === 'NotSupportedError' || name === 'TypeError') return SCREEN_SHARE_UNSUPPORTED_NOTICE
    return SCREEN_SHARE_FAILED_NOTICE
  }

  if (kind === 'microphone') {
    if (hostMuted) return HOST_MUTED_NOTICE
    if (name === 'NotAllowedError') return 'تم رفض إذن الميكروفون. اسمح للمتصفح باستخدام الميكروفون من إعدادات الموقع.'
    if (name === 'NotFoundError') return 'لم يتم العثور على ميكروفون على هذا الجهاز.'
    if (lowered.includes('permission') || lowered.includes('publish')) return HOST_MUTED_NOTICE
    return 'تعذر تشغيل الميكروفون.'
  }

  if (name === 'NotAllowedError') return 'تم رفض إذن الكاميرا. اسمح للمتصفح باستخدام الكاميرا من إعدادات الموقع.'
  if (name === 'NotFoundError') return 'لم يتم العثور على كاميرا على هذا الجهاز.'
  return 'تعذر تشغيل الكاميرا.'
}
