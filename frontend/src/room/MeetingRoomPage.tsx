import { useCallback, useEffect, useState } from 'react'
import { Clock3, ShieldAlert } from 'lucide-react'
import { ApiError } from '../lib/userMessages'
import { roomApi } from './roomApi'
import type { LiveKitRoomInfo, RoomAccessMode, RoomParticipantRecord, RoomRole } from './roomTypes'
import { useLiveKitRoom } from './useLiveKitRoom'
import MeetingRoomView from './MeetingRoomView'

export default function MeetingRoomPage() {
  const pathParts = window.location.pathname.split('/').filter(Boolean)
  const inviteCode = pathParts[0] === 'room' && pathParts[1] ? pathParts[1] : ''

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [room, setRoom] = useState<LiveKitRoomInfo | null>(null)
  const [role, setRole] = useState<RoomRole>('participant')
  const [admissionStatus, setAdmissionStatus] = useState<string>('pending')
  const [mutedByHost, setMutedByHost] = useState(false)
  const [token, setToken] = useState<string | null>(null)
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null)
  const [dbParticipants, setDbParticipants] = useState<RoomParticipantRecord[]>([])
  const [endedNotice, setEndedNotice] = useState<string | null>(null)

  const requestJoinToken = useCallback(async () => {
    if (!inviteCode) return
    try {
      const res = await roomApi.requestToken(inviteCode)
      setRoom(res.room)
      setRole(res.role)
      setAdmissionStatus(res.admissionStatus)
      setMutedByHost(Boolean(res.mutedByHost))
      if (res.admitted && res.token && res.url) {
        setToken(res.token)
        setLivekitUrl(res.url)
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        window.location.replace(`/login?next=${encodeURIComponent(`/room/${inviteCode}`)}`)
        return
      }
      setError(err instanceof Error ? err.message : 'تعذر الانضمام إلى الغرفة.')
    }
  }, [inviteCode])

  useEffect(() => {
    if (!inviteCode) {
      setError('رابط الغرفة غير صالح.')
      setLoading(false)
      return
    }
    let mounted = true
    const boot = async () => {
      try {
        const meta = await roomApi.getMeta(inviteCode)
        if (!mounted) return
        setRoom(meta.room)
        setRole(meta.role)
        setAdmissionStatus(meta.admissionStatus)
        setMutedByHost(meta.mutedByHost)
        if (!meta.enabled) {
          setError('خدمة الاجتماعات غير مفعّلة حاليًا على الخادم.')
        } else if (meta.room.status === 'ended') {
          setEndedNotice('تم إنهاء هذا الاجتماع.')
        } else {
          await requestJoinToken()
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          window.location.replace(`/login?next=${encodeURIComponent(`/room/${inviteCode}`)}`)
          return
        }
        if (mounted) setError(err instanceof Error ? err.message : 'تعذر تحميل الغرفة.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void boot()
    return () => { mounted = false }
  }, [inviteCode, requestJoinToken])

  // Poll waiting room until host admits
  useEffect(() => {
    if (!room || token || admissionStatus !== 'pending' || room.status !== 'open' || error) return
    const timer = window.setInterval(() => { void requestJoinToken() }, 4000)
    return () => window.clearInterval(timer)
  }, [room, token, admissionStatus, error, requestJoinToken])

  // Host polls participant/waiting list
  const refreshParticipants = useCallback(async () => {
    if (!inviteCode || role !== 'host') return
    try {
      const res = await roomApi.listParticipants(inviteCode)
      setDbParticipants(res.participants)
    } catch { /* ignore polling failure */ }
  }, [inviteCode, role])

  useEffect(() => {
    if (role !== 'host' || !token) return
    void refreshParticipants()
    const timer = window.setInterval(() => { void refreshParticipants() }, 5000)
    return () => window.clearInterval(timer)
  }, [role, token, refreshParticipants])

  const live = useLiveKitRoom({
    inviteCode,
    url: livekitUrl,
    token,
    role,
    onlyHostCanUnmute: Boolean(room?.onlyHostCanUnmute),
    allowStudentScreenshare: Boolean(room?.allowStudentScreenshare),
    isChildren: Boolean(room?.isChildren),
    mutedByHost,
    onRoomEnded: () => setEndedNotice('تم إنهاء الاجتماع من قِبل المضيف.'),
    onRemoved: (msg) => setEndedNotice(msg),
  })

  if (loading) return <div className="auth-screen"><div className="auth-card glass"><p>جارٍ تحميل غرفة الحلقة…</p></div></div>
  if (endedNotice) return <div className="auth-screen"><div className="auth-card glass"><h1>انتهى الاجتماع</h1><p>{endedNotice}</p><a className="primary-button full-width" href="/login">العودة للبوابة</a></div></div>
  if (error) return <div className="auth-screen"><div className="auth-card glass" role="alert"><ShieldAlert size={26} /><h1>تعذر الدخول للغرفة</h1><p>{error}</p><a className="secondary-button full-width" href="/login">العودة</a></div></div>

  if (room && !token && admissionStatus === 'pending') {
    return (
      <div className="auth-screen">
        <div className="auth-card glass">
          <Clock3 size={28} />
          <h1>غرفة الانتظار</h1>
          <p>في انتظار موافقة المعلمة أو المشرفة للدخول إلى «{room.title}»…</p>
          <a className="secondary-button full-width" href="/login">مغادرة</a>
        </div>
      </div>
    )
  }

  if (!room) return null

  return (
    <MeetingRoomView
      room={room}
      role={role}
      tiles={live.tiles}
      dbParticipants={dbParticipants}
      micOn={live.micOn}
      cameraOn={live.cameraOn}
      screenOn={live.screenOn}
      handRaised={live.handRaised}
      canUnmuteMic={live.canUnmuteMic}
      canUseCamera={live.canUseCamera}
      canShareScreen={live.canShareScreen}
      raisedHands={live.raisedHands}
      chat={live.chat}
      reactions={live.reactions}
      onToggleMic={() => void live.toggleMic()}
      onToggleCamera={() => void live.toggleCamera()}
      onToggleScreenShare={() => void live.toggleScreenShare()}
      onToggleHand={() => void live.toggleHandRaise()}
      onSendReaction={(emoji) => void live.sendReaction(emoji)}
      onSendChat={(text) => live.sendChat(text)}
      onLeave={() => { void live.leaveRoom().finally(() => window.location.assign('/login')) }}
      onEndRoom={role === 'host' ? () => {
        void roomApi.endRoom(inviteCode).then(() => setEndedNotice('تم إنهاء الاجتماع للجميع.')).catch(() => undefined)
      } : undefined}
      onModerate={role === 'host' ? (action, targetUserId) => {
        void roomApi.hostAction(inviteCode, action, targetUserId).then(() => refreshParticipants()).catch(() => undefined)
      } : undefined}
      onUpdateAccess={(patch: { accessMode: RoomAccessMode; waitingRoomEnabled: boolean; allowStudentScreenshare: boolean }) => {
        void roomApi.updateAccess(inviteCode, patch).then(setRoom).catch(() => undefined)
      }}
    />
  )
}
