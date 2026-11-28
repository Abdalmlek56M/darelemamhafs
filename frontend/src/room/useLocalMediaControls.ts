import type { RefObject } from 'react'
import type { Room } from 'livekit-client'
import {
  formatPublishError,
  getScreenShareSupport,
  HOST_MUTED_NOTICE,
  screenShareSupportNotice,
  type PublishKind,
} from './roomHelpers'

type Params = {
  roomRef: RefObject<Room | null>
  localMutePendingRef: RefObject<boolean>
  micOn: boolean
  cameraOn: boolean
  screenOn: boolean
  canUnmuteMic: boolean
  canUseCamera: boolean
  canShareScreen: boolean
  hostMuted: boolean
  setMediaNotice: (notice: string | null) => void
  syncParticipants: (room: Room) => void
}

/** Mic / camera / screen-share toggles with friendly, never-silent error handling. */
export function useLocalMediaControls(p: Params) {
  const toggleMedia = async (
    kind: PublishKind,
    currentOn: boolean,
    canEnable: boolean,
    blockedNotice: string,
    apply: (next: boolean) => Promise<unknown>,
  ) => {
    const room = p.roomRef.current
    if (!room) return
    if (!currentOn && !canEnable) {
      p.setMediaNotice(blockedNotice)
      return
    }
    const next = !currentOn
    if (kind === 'microphone' && !next) p.localMutePendingRef.current = true
    try {
      await apply(next)
      if (next) p.setMediaNotice(null)
    } catch (err) {
      const notice = formatPublishError(kind, err, p.hostMuted)
      if (notice) p.setMediaNotice(notice)
    } finally {
      if (kind === 'microphone' && !next) p.localMutePendingRef.current = false
      p.syncParticipants(room)
    }
  }

  const toggleMic = () => toggleMedia(
    'microphone',
    p.micOn,
    p.canUnmuteMic,
    p.hostMuted ? HOST_MUTED_NOTICE : 'فقط المعلمة أو المشرفة يمكنها السماح بالصوت',
    (next) => p.roomRef.current!.localParticipant.setMicrophoneEnabled(next),
  )

  const toggleCamera = () => toggleMedia(
    'camera',
    p.cameraOn,
    p.canUseCamera,
    'الكاميرا غير متاحة للمشاركين في هذه الحلقة.',
    (next) => p.roomRef.current!.localParticipant.setCameraEnabled(next),
  )

  const toggleScreenShare = () => {
    const support = getScreenShareSupport()
    return toggleMedia(
      'screen',
      p.screenOn,
      p.canShareScreen && support === 'ok',
      p.canShareScreen ? screenShareSupportNotice(support) : 'مشاركة الشاشة غير متاحة للمشاركين في هذه الحلقة.',
      (next) => p.roomRef.current!.localParticipant.setScreenShareEnabled(next),
    )
  }

  return { toggleMic, toggleCamera, toggleScreenShare }
}
