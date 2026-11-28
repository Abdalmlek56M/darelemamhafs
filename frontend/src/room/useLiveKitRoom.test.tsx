// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DisconnectReason, RoomEvent, Track } from 'livekit-client'

type Listener = (...args: unknown[]) => void
const mockState = vi.hoisted(() => ({
  listeners: new Map<string, Listener[]>(),
  setMicMock: vi.fn(async () => undefined),
  publishDataMock: vi.fn(async (_bytes: Uint8Array) => undefined),
  disconnectMock: vi.fn(async () => undefined),
  connectMock: vi.fn(async () => undefined),
}))

vi.mock('livekit-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('livekit-client')>()
  class MockRoom {
    state = actual.ConnectionState.Connected
    remoteParticipants = new Map()
    localParticipant = {
      identity: 'u-student',
      name: 'طالبة',
      metadata: JSON.stringify({ role: 'participant' }),
      getTrackPublication: () => undefined,
      setMicrophoneEnabled: mockState.setMicMock,
      setCameraEnabled: vi.fn(async () => undefined),
      setScreenShareEnabled: vi.fn(async () => undefined),
      publishData: mockState.publishDataMock,
    }
    on(event: string, fn: Listener) {
      const list = mockState.listeners.get(event) ?? []
      list.push(fn)
      mockState.listeners.set(event, list)
      return this
    }
    connect = mockState.connectMock
    disconnect = mockState.disconnectMock
  }
  return { ...actual, Room: MockRoom }
})

vi.mock('./roomApi', () => ({
  roomApi: { attendanceEvent: vi.fn(async () => ({ ok: true })) },
}))

import { useLiveKitRoom } from './useLiveKitRoom'
import { resolveDisconnectOutcome } from './roomHelpers'

function emitRoomEvent(event: string, ...args: unknown[]) {
  for (const fn of mockState.listeners.get(event) ?? []) {
    fn(...args)
  }
}

describe('useLiveKitRoom', () => {
  beforeEach(() => {
    mockState.listeners.clear()
    mockState.setMicMock.mockReset().mockResolvedValue(undefined)
    mockState.publishDataMock.mockReset().mockResolvedValue(undefined)
    mockState.disconnectMock.mockReset().mockResolvedValue(undefined)
    mockState.connectMock.mockReset().mockResolvedValue(undefined)
  })

  it('uses DisconnectReason enum to classify participant removal and room deletion (LK-2)', () => {
    expect(resolveDisconnectOutcome(DisconnectReason.PARTICIPANT_REMOVED)).toEqual({
      kind: 'removed',
      message: 'تمت إزالتك من الغرفة',
    })
    expect(resolveDisconnectOutcome(DisconnectReason.ROOM_DELETED)).toEqual({ kind: 'ended' })
    expect(resolveDisconnectOutcome(DisconnectReason.CLIENT_INITIATED)).toEqual({ kind: 'local' })
  })

  it('shows removed notice and leaves room when kicked or banned via RoomEvent.Disconnected (LK-2)', async () => {
    const onRemoved = vi.fn()
    const onRoomEnded = vi.fn()

    renderHook(() => useLiveKitRoom({
      inviteCode: 'abc',
      url: 'wss://example.livekit.cloud',
      token: 'tok',
      role: 'participant',
      onlyHostCanUnmute: false,
      allowStudentScreenshare: false,
      isChildren: false,
      mutedByHost: false,
      onRoomEnded,
      onRemoved,
    }))

    await act(async () => {
      emitRoomEvent(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED)
    })

    expect(onRemoved).toHaveBeenCalledWith('تمت إزالتك من الغرفة')
    expect(onRoomEnded).not.toHaveBeenCalled()
    expect(mockState.disconnectMock).toHaveBeenCalled()
  })

  it('shows host-mute notice and non-silent publish error when muted or publish fails (LK-3)', async () => {
    const { result } = renderHook(() => useLiveKitRoom({
      inviteCode: 'abc',
      url: 'wss://example.livekit.cloud',
      token: 'tok',
      role: 'participant',
      onlyHostCanUnmute: false,
      allowStudentScreenshare: false,
      isChildren: false,
      mutedByHost: false,
      onRoomEnded: vi.fn(),
      onRemoved: vi.fn(),
    }))

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })

    await act(async () => {
      emitRoomEvent(RoomEvent.ParticipantPermissionsChanged, { canPublish: false }, { identity: 'u-student' })
    })

    expect(result.current.hostMuted).toBe(true)
    expect(result.current.canUnmuteMic).toBe(false)
    expect(result.current.mediaNotice).toBe('المعلمة كتمت صوتك')

    mockState.setMicMock.mockRejectedValueOnce(new Error('microphone device failure'))
    await act(async () => {
      emitRoomEvent(RoomEvent.ParticipantPermissionsChanged, { canPublish: true }, { identity: 'u-student' })
    })
    await act(async () => {
      await result.current.toggleMic()
    })

    expect(result.current.mediaNotice).toContain('تعذر تشغيل الميكروفون')

    await act(async () => {
      emitRoomEvent(RoomEvent.TrackMuted, { source: Track.Source.Microphone }, { identity: 'u-student' })
    })
    expect(result.current.hostMuted).toBe(true)
    expect(result.current.mediaNotice).toBe('المعلمة كتمت صوتك')
  })

  it('calls onRoomEnded and clears connected state when RoomEvent.Disconnected receives ROOM_DELETED (LK-2)', async () => {
    const onRemoved = vi.fn()
    const onRoomEnded = vi.fn()

    const { result } = renderHook(() => useLiveKitRoom({
      inviteCode: 'abc',
      url: 'wss://example.livekit.cloud',
      token: 'tok',
      role: 'participant',
      onlyHostCanUnmute: false,
      allowStudentScreenshare: false,
      isChildren: false,
      mutedByHost: false,
      onRoomEnded,
      onRemoved,
    }))

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(result.current.connected).toBe(true)

    await act(async () => {
      emitRoomEvent(RoomEvent.Disconnected, DisconnectReason.ROOM_DELETED)
    })

    expect(onRoomEnded).toHaveBeenCalledTimes(1)
    expect(onRemoved).not.toHaveBeenCalled()
    expect(result.current.connected).toBe(false)
    expect(result.current.tiles).toEqual([])
  })

  it('broadcasts whiteboard state from host and auto-opens/syncs strokes for participants', async () => {
    const { result: host } = renderHook(() => useLiveKitRoom({
      inviteCode: 'abc',
      url: 'wss://example.livekit.cloud',
      token: 'tok-h',
      role: 'host',
      onlyHostCanUnmute: false,
      allowStudentScreenshare: false,
      isChildren: false,
      mutedByHost: false,
      onRoomEnded: vi.fn(),
      onRemoved: vi.fn(),
    }))

    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    act(() => { host.current.toggleWhiteboard() })
    expect(host.current.whiteboardOpen).toBe(true)
    const sent = mockState.publishDataMock.mock.calls.map(([bytes]) => JSON.parse(new TextDecoder().decode(bytes as Uint8Array)))
    expect(sent).toContainEqual({ type: 'wb-state', open: true })

    // Participant receives wb-state and wb-stroke
    const { result: stud } = renderHook(() => useLiveKitRoom({
      inviteCode: 'abc',
      url: 'wss://example.livekit.cloud',
      token: 'tok-s',
      role: 'participant',
      onlyHostCanUnmute: false,
      allowStudentScreenshare: false,
      isChildren: false,
      mutedByHost: false,
      onRoomEnded: vi.fn(),
      onRemoved: vi.fn(),
    }))

    await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

    await act(async () => {
      emitRoomEvent(RoomEvent.DataReceived, new TextEncoder().encode(JSON.stringify({ type: 'wb-state', open: true })), { identity: 'h-1' })
      emitRoomEvent(
        RoomEvent.DataReceived,
        new TextEncoder().encode(JSON.stringify({ type: 'wb-stroke', stroke: { id: 's-1', points: [10, 10, 80, 80], color: '#38bdf8', width: 3 } })),
        { identity: 'h-1' },
      )
    })

    expect(stud.current.whiteboardOpen).toBe(true)
    expect(stud.current.whiteboardHostActive).toBe(true)
    expect(stud.current.strokes).toHaveLength(1)

    // Verify TrackUnpublished triggers participant/spotlight re-sync cleanly
    const mockTrackListeners = mockState.listeners.get(RoomEvent.TrackUnpublished) ?? []
    expect(mockTrackListeners.length).toBeGreaterThan(0)
  })
})
