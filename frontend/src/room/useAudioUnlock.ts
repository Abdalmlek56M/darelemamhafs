import { useCallback, useState, type RefObject } from 'react'
import { RoomEvent, type Room } from 'livekit-client'

// Browsers may block remote audio until a user gesture. This hook mirrors the SDK's
// playback status and resumes playback when the user presses the enable-audio button.
export function useAudioUnlock(roomRef: RefObject<Room | null>) {
  const [audioBlocked, setAudioBlocked] = useState(false)

  /** Must run before `room.connect()`: the SDK may report "blocked" while connecting. */
  const watchAudio = useCallback((room: Room) => {
    const sync = () => setAudioBlocked(!room.canPlaybackAudio)
    const reset = () => setAudioBlocked(false)
    room.on(RoomEvent.AudioPlaybackStatusChanged, sync)
    room.on(RoomEvent.Disconnected, reset)
    return () => {
      room.off(RoomEvent.AudioPlaybackStatusChanged, sync)
      room.off(RoomEvent.Disconnected, reset)
      reset()
    }
  }, [])

  /** Call directly from a click handler so the browser still counts it as a user gesture. */
  const startAudio = useCallback(async () => {
    const room = roomRef.current
    if (!room) return
    try { await room.startAudio() } catch { /* still blocked: the banner stays visible */ }
    setAudioBlocked(!room.canPlaybackAudio)
  }, [roomRef])

  return { audioBlocked, watchAudio, startAudio }
}
