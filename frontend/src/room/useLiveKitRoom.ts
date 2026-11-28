import { useCallback, useEffect, useRef, useState } from 'react'
import { ConnectionState, DisconnectReason, Room, RoomEvent, Track } from 'livekit-client'
import type { LiveParticipantTile, RoomChatMessage, RoomDataPacket, RoomReaction, RoomRole, WhiteboardStroke } from './roomTypes'
import { roomApi } from './roomApi'
import { buildTile, HOST_MUTED_NOTICE, resolveDisconnectOutcome } from './roomHelpers'
import { useLocalMediaControls } from './useLocalMediaControls'
import { useAudioUnlock } from './useAudioUnlock'

type Options = {
  inviteCode: string
  url: string | null
  token: string | null
  role: RoomRole
  onlyHostCanUnmute: boolean
  allowStudentScreenshare: boolean
  isChildren: boolean
  mutedByHost: boolean
  onRoomEnded: () => void
  onRemoved: (message: string) => void
}

export function useLiveKitRoom(options: Options) {
  const roomRef = useRef<Room | null>(null)
  const localMutePendingRef = useRef(false)
  const strokesRef = useRef<WhiteboardStroke[]>([])
  const whiteboardOpenRef = useRef(false)
  const onRoomEndedRef = useRef(options.onRoomEnded)
  const onRemovedRef = useRef(options.onRemoved)
  onRoomEndedRef.current = options.onRoomEnded
  onRemovedRef.current = options.onRemoved

  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mediaNotice, setMediaNotice] = useState<string | null>(options.mutedByHost ? HOST_MUTED_NOTICE : null)
  const [hostMuted, setHostMuted] = useState(options.mutedByHost)
  const [tiles, setTiles] = useState<LiveParticipantTile[]>([])
  const [micOn, setMicOn] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [screenOn, setScreenOn] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({})
  const [chat, setChat] = useState<RoomChatMessage[]>([])
  const [reactions, setReactions] = useState<RoomReaction[]>([])
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([])
  const [whiteboardOpen, setWhiteboardOpen] = useState(false)
  const [whiteboardHostActive, setWhiteboardHostActive] = useState(false)
  const { audioBlocked, watchAudio, startAudio } = useAudioUnlock(roomRef)

  strokesRef.current = strokes
  whiteboardOpenRef.current = whiteboardOpen

  const canUnmuteMic = options.role === 'host' || (!options.onlyHostCanUnmute && !hostMuted)
  const canShareScreen = options.role === 'host' || (!options.isChildren && options.allowStudentScreenshare)
  const canUseCamera = options.role === 'host' || !options.isChildren

  useEffect(() => {
    setHostMuted(options.mutedByHost)
    if (options.mutedByHost) setMediaNotice(HOST_MUTED_NOTICE)
  }, [options.mutedByHost])

  useEffect(() => {
    const room = roomRef.current
    if (!room || room.state !== ConnectionState.Connected) return
    if (!canUnmuteMic && micOn) {
      localMutePendingRef.current = true
      void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined)
    }
  }, [canUnmuteMic, micOn])

  const syncParticipants = useCallback((room: Room) => {
    const next: LiveParticipantTile[] = [buildTile(room.localParticipant, true)]
    for (const remote of room.remoteParticipants.values()) {
      next.push(buildTile(remote, false))
    }
    setTiles(next)
    const micPub = room.localParticipant.getTrackPublication(Track.Source.Microphone)
    const camPub = room.localParticipant.getTrackPublication(Track.Source.Camera)
    const scrPub = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)
    setMicOn(Boolean(micPub && !micPub.isMuted))
    setCameraOn(Boolean(camPub && !camPub.isMuted))
    setScreenOn(Boolean(scrPub && !scrPub.isMuted))
  }, [])

  const publishPacket = useCallback(async (packet: RoomDataPacket) => {
    const room = roomRef.current
    if (!room || room.state !== ConnectionState.Connected) return
    const bytes = new TextEncoder().encode(JSON.stringify(packet))
    await room.localParticipant.publishData(bytes, { reliable: true })
  }, [])

  const applyHostMuteState = useCallback((room: Room, muted: boolean) => {
    setHostMuted(muted)
    if (muted) {
      setMediaNotice(HOST_MUTED_NOTICE)
      setMicOn(false)
      void room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined)
    } else {
      setMediaNotice((prev) => (prev === HOST_MUTED_NOTICE ? null : prev))
    }
    syncParticipants(room)
  }, [syncParticipants])

  useEffect(() => {
    if (!options.url || !options.token) return
    let active = true
    const room = new Room({ adaptiveStream: true, dynacast: true })
    roomRef.current = room

    const refresh = () => { if (active) syncParticipants(room) }
    room.on(RoomEvent.ParticipantConnected, () => {
      refresh()
      if (options.role === 'host' && (whiteboardOpenRef.current || strokesRef.current.length > 0)) {
        void publishPacket({ type: 'wb-sync', open: whiteboardOpenRef.current, strokes: strokesRef.current }).catch(() => undefined)
      }
    })
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      refresh()
      setRaisedHands((prev) => { const copy = { ...prev }; delete copy[p.identity]; return copy })
    })
    room.on(RoomEvent.TrackPublished, refresh)
    room.on(RoomEvent.TrackUnpublished, refresh)
    room.on(RoomEvent.TrackSubscribed, refresh)
    room.on(RoomEvent.TrackUnsubscribed, refresh)
    room.on(RoomEvent.TrackMuted, (pub, participant) => {
      if (!active) return
      if (participant.identity === room.localParticipant.identity && pub.source === Track.Source.Microphone) {
        if (localMutePendingRef.current) {
          localMutePendingRef.current = false
        } else if (options.role !== 'host') {
          setHostMuted(true)
          setMicOn(false)
          setMediaNotice(HOST_MUTED_NOTICE)
        }
      }
      refresh()
    })
    room.on(RoomEvent.TrackUnmuted, refresh)
    room.on(RoomEvent.LocalTrackPublished, refresh)
    room.on(RoomEvent.LocalTrackUnpublished, refresh)
    room.on(RoomEvent.TrackSubscriptionPermissionChanged, refresh)
    const unwatchAudio = watchAudio(room)
    room.on(RoomEvent.ParticipantPermissionsChanged, (permissions, participant) => {
      if (!active || options.role === 'host') return
      if (participant.identity !== room.localParticipant.identity) return
      if (permissions && permissions.canPublish === false) {
        applyHostMuteState(room, true)
      } else if (permissions && permissions.canPublish === true) {
        applyHostMuteState(room, false)
      }
    })
    room.on(RoomEvent.DataReceived, (payload, participant) => {
      try {
        const packet = JSON.parse(new TextDecoder().decode(payload)) as RoomDataPacket
        const sender = participant?.identity ?? 'unknown'
        if (packet.type === 'chat') {
          setChat((prev) => [...prev.slice(-99), { id: packet.id, senderIdentity: sender, senderName: packet.senderName, text: packet.text, sentAt: packet.sentAt }])
        } else if (packet.type === 'hand') {
          setRaisedHands((prev) => ({ ...prev, [sender]: packet.raised }))
        } else if (packet.type === 'reaction') {
          const r: RoomReaction = { id: packet.id, senderName: packet.senderName, emoji: packet.emoji }
          setReactions((prev) => [...prev.slice(-4), r])
          window.setTimeout(() => setReactions((prev) => prev.filter((item) => item.id !== r.id)), 3000)
        } else if (packet.type === 'wb-stroke') {
          setStrokes((prev) => [...prev.slice(-300), packet.stroke])
          setWhiteboardHostActive(true)
          setWhiteboardOpen(true)
        } else if (packet.type === 'wb-clear') {
          setStrokes([])
        } else if (packet.type === 'wb-state') {
          setWhiteboardHostActive(packet.open)
          setWhiteboardOpen(packet.open)
        } else if (packet.type === 'wb-sync-request' && options.role === 'host') {
          void publishPacket({ type: 'wb-sync', open: whiteboardOpenRef.current, strokes: strokesRef.current }).catch(() => undefined)
        } else if (packet.type === 'wb-sync') {
          setStrokes(packet.strokes.slice(-300))
          setWhiteboardHostActive(packet.open)
          if (packet.open) setWhiteboardOpen(true)
        } else if (packet.type === 'host-mute' && packet.targetIdentity === room.localParticipant.identity) {
          applyHostMuteState(room, packet.muted)
        }
      } catch { /* ignore malformed data packets */ }
    })
    room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
      if (!active) return
      setConnected(false)
      setMicOn(false)
      setCameraOn(false)
      setScreenOn(false)
      setTiles([])
      void roomApi.attendanceEvent(options.inviteCode, 'leave').catch(() => undefined)
      const outcome = resolveDisconnectOutcome(reason)
      if (outcome.kind === 'ended') {
        void room.disconnect().catch(() => undefined)
        onRoomEndedRef.current()
      } else if (outcome.kind === 'removed') {
        void room.disconnect().catch(() => undefined)
        onRemovedRef.current(outcome.message)
      }
    })

    const connect = async () => {
      setConnecting(true)
      setError(null)
      try {
        await room.connect(options.url!, options.token!)
        if (!active) { await room.disconnect(); return }
        localMutePendingRef.current = true
        // Rules: camera and microphone are always auto-muted on join.
        await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined)
        await room.localParticipant.setCameraEnabled(false).catch(() => undefined)
        localMutePendingRef.current = false
        setConnected(true)
        syncParticipants(room)
        if (options.role !== 'host') {
          void publishPacket({ type: 'wb-sync-request' }).catch(() => undefined)
        }
        await roomApi.attendanceEvent(options.inviteCode, 'join').catch(() => undefined)
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'تعذر الاتصال بغرفة الاجتماع.')
      } finally {
        if (active) setConnecting(false)
      }
    }
    void connect()

    const heartbeat = window.setInterval(() => {
      if (room.state === ConnectionState.Connected) {
        void roomApi.attendanceEvent(options.inviteCode, 'heartbeat').catch(() => undefined)
      }
    }, 30000)

    return () => {
      active = false
      window.clearInterval(heartbeat)
      unwatchAudio()
      if (room.state === ConnectionState.Connected) {
        void roomApi.attendanceEvent(options.inviteCode, 'leave').catch(() => undefined)
      }
      void room.disconnect()
      roomRef.current = null
    }
  }, [options.inviteCode, options.url, options.token, options.role, applyHostMuteState, publishPacket, syncParticipants, watchAudio])

  const { toggleMic, toggleCamera, toggleScreenShare } = useLocalMediaControls({
    roomRef, localMutePendingRef, micOn, cameraOn, screenOn,
    canUnmuteMic, canUseCamera, canShareScreen, hostMuted,
    setMediaNotice, syncParticipants,
  })

  const toggleHandRaise = async () => {
    const room = roomRef.current
    if (!room) return
    const next = !handRaised
    setHandRaised(next)
    setRaisedHands((prev) => ({ ...prev, [room.localParticipant.identity]: next }))
    await publishPacket({ type: 'hand', raised: next }).catch(() => undefined)
  }

  const sendReaction = async (emoji: string) => {
    const room = roomRef.current
    if (!room) return
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const senderName = room.localParticipant.name || 'أنا'
    setReactions((prev) => [...prev.slice(-4), { id, senderName, emoji }])
    window.setTimeout(() => setReactions((prev) => prev.filter((item) => item.id !== id)), 3000)
    await publishPacket({ type: 'reaction', id, senderName, emoji }).catch(() => undefined)
  }

  const sendChat = async (text: string) => {
    const clean = text.trim()
    const room = roomRef.current
    if (!clean || !room) return
    const msg: RoomChatMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      senderIdentity: room.localParticipant.identity,
      senderName: room.localParticipant.name || 'أنا',
      text: clean,
      sentAt: new Date().toISOString(),
    }
    setChat((prev) => [...prev.slice(-99), msg])
    await publishPacket({ type: 'chat', id: msg.id, senderName: msg.senderName, text: msg.text, sentAt: msg.sentAt }).catch(() => undefined)
  }

  const notifyHostMute = (targetIdentity: string, muted: boolean) =>
    publishPacket({ type: 'host-mute', targetIdentity, muted }).catch(() => undefined)

  const toggleWhiteboard = () => {
    const next = !whiteboardOpenRef.current
    setWhiteboardOpen(next)
    if (options.role === 'host') {
      setWhiteboardHostActive(next)
      void publishPacket({ type: 'wb-state', open: next }).catch(() => undefined)
      if (next && strokesRef.current.length > 0) {
        void publishPacket({ type: 'wb-sync', open: true, strokes: strokesRef.current }).catch(() => undefined)
      }
    }
  }

  const addStroke = async (stroke: WhiteboardStroke) => {
    setStrokes((prev) => [...prev.slice(-300), stroke])
    await publishPacket({ type: 'wb-stroke', stroke }).catch(() => undefined)
  }

  const clearWhiteboard = async () => {
    setStrokes([])
    await publishPacket({ type: 'wb-clear' }).catch(() => undefined)
  }

  const leaveRoom = async () => {
    const room = roomRef.current
    if (room) {
      await roomApi.attendanceEvent(options.inviteCode, 'leave').catch(() => undefined)
      await room.disconnect()
    }
  }

  return {
    connected, connecting, error, mediaNotice, hostMuted, tiles, audioBlocked, startAudio,
    micOn, cameraOn, screenOn, handRaised,
    canUnmuteMic, canUseCamera, canShareScreen,
    raisedHands, chat, reactions, strokes,
    whiteboardOpen, whiteboardHostActive, setWhiteboardOpen, toggleWhiteboard,
    toggleMic, toggleCamera, toggleScreenShare,
    toggleHandRaise, sendReaction, sendChat, notifyHostMute,
    addStroke, clearWhiteboard, leaveRoom,
  }
}
