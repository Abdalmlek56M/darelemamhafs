import { DisconnectReason, Track, type Participant } from 'livekit-client'
import type { LiveParticipantTile } from './roomTypes'

export type DisconnectOutcome =
  | { kind: 'ended' }
  | { kind: 'removed'; message: string }
  | { kind: 'local' }

export const HOST_MUTED_NOTICE = 'المعلمة كتمت صوتك'
export const REMOVED_FROM_ROOM_MESSAGE = 'تمت إزالتك من الغرفة'

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

export function formatPublishError(
  kind: 'microphone' | 'camera' | 'screen',
  err: unknown,
  hostMuted: boolean,
): string {
  if (kind === 'microphone' && hostMuted) return HOST_MUTED_NOTICE
  const raw = err instanceof Error ? err.message : String(err ?? '')
  const lowered = raw.toLowerCase()
  if (kind === 'microphone' && (lowered.includes('permission') || lowered.includes('publish'))) {
    return HOST_MUTED_NOTICE
  }
  if (kind === 'microphone') return raw ? `تعذر تشغيل الميكروفون: ${raw}` : 'تعذر تشغيل الميكروفون.'
  if (kind === 'camera') return raw ? `تعذر تشغيل الكاميرا: ${raw}` : 'تعذر تشغيل الكاميرا.'
  return raw ? `تعذر مشاركة الشاشة: ${raw}` : 'تعذر مشاركة الشاشة.'
}
