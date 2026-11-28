import { useCallback, useEffect, useRef, useState } from 'react'
import { ConnectionState, Room, RoomEvent, Track, type Participant } from 'livekit-client'
import type {
  LiveParticipantTile,
  RoomChatMessage,
  RoomDataPacket,
  RoomReaction,
  RoomRole,
  WhiteboardStroke,
} from './roomTypes'
import { roomApi } from './roomApi'

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

function buildTile(p: Participant, isLocal: boolean): LiveParticipantTile {
  let metaRole = 'participant'
  try {
    if (p.metadata) metaRole = JSON.parse(p.metadata).role ?? 'participant'
  } catch { /* ignore invalid metadata */ }
  const camPub = p.getTrackPublication(Track.Source.Camera)
  const micPub = p.getTrackPublication(Track.Source.Microphone)
  const screenPub = p.getTrackPublication(Track.Source.ScreenShare)
  const audioPub = p.getTrackPublication(Track.Source.Microphone)
  return {
    identity: p.identity,
    name: p.name || p.identity,
    isLocal,
    isHost: metaRole === 'host',
    micEnabled: Boolean(micPub && !micPub.isMuted),
    cameraEnabled: Boolean(camPub && !camPub.isMuted),
    screenEnabled: Boolean(screenPub && !screenPub.isMuted),
    videoTrack: camPub?.track && !camPub.isMuted ? camPub.track : null,
    screenTrack: screenPub?.track && !screenPub.isMuted ? screenPub.track : null,
    audioTrack: !isLocal && audioPub?.track && !audioPub.isMuted ? audioPub.track : null,
  }
}

export function useLiveKitRoom(options: Options) {
  const roomRef = useRef<Room | null>(null)
  const [connected, setConnected] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tiles, setTiles] = useState<LiveParticipantTile[]>([])
  const [micOn, setMicOn] = useState(false)
  const [cameraOn, setCameraOn] = useState(false)
  const [screenOn, setScreenOn] = useState(false)
  const [handRaised, setHandRaised] = useState(false)
  const [raisedHands, setRaisedHands] = useState<Record<string, boolean>>({})
  const [chat, setChat] = useState<RoomChatMessage[]>([])
  const [reactions, setReactions] = useState<RoomReaction[]>([])
  const [strokes, setStrokes] = useState<WhiteboardStroke[]>([])

  const canUnmuteMic = options.role === 'host' || (!options.onlyHostCanUnmute && !options.mutedByHost)
  const canShareScreen = options.role === 'host' || (!options.isChildren && options.allowStudentScreenshare)
  const canUseCamera = options.role === 'host' || !options.isChildren

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

  useEffect(() => {
    if (!options.url || !options.token) return
    let active = true
    const room = new Room({ adaptiveStream: true, dynacast: true })
    roomRef.current = room

    const refresh = () => { if (active) syncParticipants(room) }
    room.on(RoomEvent.ParticipantConnected, refresh)
    room.on(RoomEvent.ParticipantDisconnected, (p) => {
      refresh()
      setRaisedHands((prev) => { const copy = { ...prev }; delete copy[p.identity]; return copy })
    })
    room.on(RoomEvent.TrackSubscribed, refresh)
    room.on(RoomEvent.TrackUnsubscribed, refresh)
    room.on(RoomEvent.TrackMuted, refresh)
    room.on(RoomEvent.TrackUnmuted, refresh)
    room.on(RoomEvent.LocalTrackPublished, refresh)
    room.on(RoomEvent.LocalTrackUnpublished, refresh)
    room.on(RoomEvent.TrackSubscriptionPermissionChanged, refresh)
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
        } else if (packet.type === 'wb-clear') {
          setStrokes([])
        }
      } catch { /* ignore malformed data packets */ }
    })
    room.on(RoomEvent.Disconnected, (reason) => {
      if (!active) return
      setConnected(false)
      void roomApi.attendanceEvent(options.inviteCode, 'leave').catch(() => undefined)
      if (String(reason ?? '').toLowerCase().includes('deleted')) options.onRoomEnded()
      else if (String(reason ?? '').toLowerCase().includes('removed')) options.onRemoved('تمت إزالتك من الغرفة بواسطة المضيف.')
    })

    const connect = async () => {
      setConnecting(true)
      setError(null)
      try {
        await room.connect(options.url!, options.token!)
        if (!active) { await room.disconnect(); return }
        // Rules: camera and microphone are always auto-muted on join.
        await room.localParticipant.setMicrophoneEnabled(false).catch(() => undefined)
        await room.localParticipant.setCameraEnabled(false).catch(() => undefined)
        setConnected(true)
        syncParticipants(room)
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
      if (room.state === ConnectionState.Connected) {
        void roomApi.attendanceEvent(options.inviteCode, 'leave').catch(() => undefined)
      }
      void room.disconnect()
      roomRef.current = null
    }
  }, [options.inviteCode, options.url, options.token, syncParticipants])

  const toggleMic = async () => {
    const room = roomRef.current
    if (!room) return
    if (!micOn && !canUnmuteMic) return
    await room.localParticipant.setMicrophoneEnabled(!micOn)
    syncParticipants(room)
  }

  const toggleCamera = async () => {
    const room = roomRef.current
    if (!room) return
    if (!cameraOn && !canUseCamera) return
    await room.localParticipant.setCameraEnabled(!cameraOn)
    syncParticipants(room)
  }

  const toggleScreenShare = async () => {
    const room = roomRef.current
    if (!room) return
    if (!screenOn && !canShareScreen) return
    await room.localParticipant.setScreenShareEnabled(!screenOn)
    syncParticipants(room)
  }

  const toggleHandRaise = async () => {
    const room = roomRef.current
    if (!room) return
    const next = !handRaised
    setHandRaised(next)
    setRaisedHands((prev) => ({ ...prev, [room.localParticipant.identity]: next }))
    await publishPacket({ type: 'hand', raised: next })
  }

  const sendReaction = async (emoji: string) => {
    const room = roomRef.current
    if (!room) return
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const senderName = room.localParticipant.name || 'أنا'
    setReactions((prev) => [...prev.slice(-4), { id, senderName, emoji }])
    window.setTimeout(() => setReactions((prev) => prev.filter((item) => item.id !== id)), 3000)
    await publishPacket({ type: 'reaction', id, senderName, emoji })
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
    await publishPacket({ type: 'chat', id: msg.id, senderName: msg.senderName, text: msg.text, sentAt: msg.sentAt })
  }

  const addStroke = async (stroke: WhiteboardStroke) => {
    setStrokes((prev) => [...prev.slice(-300), stroke])
    await publishPacket({ type: 'wb-stroke', stroke })
  }

  const clearWhiteboard = async () => {
    setStrokes([])
    await publishPacket({ type: 'wb-clear' })
  }

  const leaveRoom = async () => {
    const room = roomRef.current
    if (room) {
      await roomApi.attendanceEvent(options.inviteCode, 'leave').catch(() => undefined)
      await room.disconnect()
    }
  }

  return {
    connected, connecting, error, tiles,
    micOn, cameraOn, screenOn, handRaised,
    canUnmuteMic, canUseCamera, canShareScreen,
    raisedHands, chat, reactions, strokes,
    toggleMic, toggleCamera, toggleScreenShare,
    toggleHandRaise, sendReaction, sendChat,
    addStroke, clearWhiteboard, leaveRoom,
  }
}
