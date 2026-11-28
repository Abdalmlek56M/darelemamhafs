// @vitest-environment jsdom
// Uses the real livekit-client Room so an SDK change to the audio events breaks these tests.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DisconnectReason, Room, RoomEvent } from 'livekit-client'
import { useAudioUnlock } from './useAudioUnlock'

// What the SDK calls internally when `<audio>.play()` resolves or rejects.
type SdkPlayback = {
  handleAudioPlaybackFailed: (e: Error) => void
  handleAudioPlaybackStarted: () => void
}

const blockPlayback = (room: Room) => act(() => {
  (room as unknown as SdkPlayback).handleAudioPlaybackFailed(new DOMException('blocked', 'NotAllowedError'))
})
const allowPlayback = (room: Room) => act(() => {
  (room as unknown as SdkPlayback).handleAudioPlaybackStarted()
})

function setup(room: Room | null = new Room()) {
  const hook = renderHook(() => useAudioUnlock({ current: room }))
  let unwatch = () => {}
  if (room) act(() => { unwatch = hook.result.current.watchAudio(room) })
  return { room: room as Room, result: hook.result, unwatch: () => act(() => unwatch()) }
}

describe('useAudioUnlock', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('starts unblocked and follows the SDK playback status', () => {
    const { room, result } = setup()
    expect(result.current.audioBlocked).toBe(false)

    blockPlayback(room)
    expect(result.current.audioBlocked).toBe(true)

    allowPlayback(room)
    expect(result.current.audioBlocked).toBe(false)
  })

  it('clears the flag when startAudio unlocks playback', async () => {
    const { room, result } = setup()
    const start = vi.spyOn(room, 'startAudio').mockImplementation(async () => {
      (room as unknown as SdkPlayback).handleAudioPlaybackStarted()
    })
    blockPlayback(room)

    await act(async () => { await result.current.startAudio() })

    expect(start).toHaveBeenCalledTimes(1)
    expect(result.current.audioBlocked).toBe(false)
  })

  it('keeps the banner when the browser still refuses playback', async () => {
    const { room, result } = setup()
    vi.spyOn(room, 'startAudio').mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
    blockPlayback(room)

    await act(async () => { await result.current.startAudio() })

    expect(result.current.audioBlocked).toBe(true)
  })

  it('resets after disconnect', () => {
    const { room, result } = setup()
    blockPlayback(room)

    act(() => { room.emit(RoomEvent.Disconnected, DisconnectReason.CLIENT_INITIATED) })

    expect(result.current.audioBlocked).toBe(false)
  })

  it('stops listening and resets once unwatched', () => {
    const { room, result, unwatch } = setup()
    blockPlayback(room)

    unwatch()

    expect(result.current.audioBlocked).toBe(false)
    expect(room.listenerCount(RoomEvent.AudioPlaybackStatusChanged)).toBe(0)
  })

  it('does nothing when there is no room', async () => {
    const { result } = setup(null)
    await act(async () => { await result.current.startAudio() })
    expect(result.current.audioBlocked).toBe(false)
  })
})
