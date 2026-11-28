import { useEffect, useRef, useState } from 'react'
import {
  Copy, Hand, LogOut, MessageSquare, Mic, MicOff, MonitorUp,
  PencilLine, PhoneOff, ShieldAlert, Users, Video, VideoOff,
} from 'lucide-react'
import type { Track } from 'livekit-client'
import type {
  LiveKitRoomInfo, LiveParticipantTile, RoomAccessMode,
  RoomChatMessage, RoomParticipantRecord, RoomReaction, RoomRole,
} from './roomTypes'
import RoomSidePanel from './RoomSidePanel'
import './room.css'

type Props = {
  room: LiveKitRoomInfo
  role: RoomRole
  tiles: LiveParticipantTile[]
  dbParticipants: RoomParticipantRecord[]
  micOn: boolean
  cameraOn: boolean
  screenOn: boolean
  handRaised: boolean
  canUnmuteMic: boolean
  canUseCamera: boolean
  canShareScreen: boolean
  raisedHands: Record<string, boolean>
  chat: RoomChatMessage[]
  reactions: RoomReaction[]
  onToggleMic: () => void
  onToggleCamera: () => void
  onToggleScreenShare: () => void
  onToggleHand: () => void
  onSendReaction: (emoji: string) => void
  onSendChat: (text: string) => Promise<void>
  onLeave: () => void
  onEndRoom?: () => void
  onModerate?: (action: 'mute' | 'unmute' | 'remove' | 'ban' | 'admit' | 'deny', userId: string) => void
  onUpdateAccess?: (patch: { accessMode: RoomAccessMode; waitingRoomEnabled: boolean; allowStudentScreenshare: boolean }) => void
  whiteboardOpen?: boolean
  onToggleWhiteboard?: () => void
  whiteboardSlot?: React.ReactNode
}

function MediaElement({ track, kind }: { track: Track; kind: 'video' | 'audio' }) {
  const ref = useRef<HTMLMediaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => { track.detach(el) }
  }, [track])
  return kind === 'video'
    ? <video ref={(el) => { ref.current = el }} autoPlay playsInline muted />
    : <audio ref={(el) => { ref.current = el }} autoPlay />
}

const REACTIONS = ['👍', '❤️', '🤲', '👏']

export default function MeetingRoomView({
  room, role, tiles, dbParticipants, micOn, cameraOn, screenOn, handRaised,
  canUnmuteMic, canUseCamera, canShareScreen, raisedHands, chat, reactions,
  onToggleMic, onToggleCamera, onToggleScreenShare, onToggleHand,
  onSendReaction, onSendChat, onLeave, onEndRoom, onModerate, onUpdateAccess,
  whiteboardOpen, onToggleWhiteboard, whiteboardSlot,
}: Props) {
  const [panelTab, setPanelTab] = useState<'participants' | 'chat' | null>('participants')
  const [copied, setCopied] = useState(false)

  const copyInvite = () => {
    const url = `${window.location.origin}/room/${room.inviteCode}`
    void navigator.clipboard?.writeText(url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="room-shell">
      <header className="room-topbar">
        <div className="room-title-group">
          <h1>{room.title}</h1>
          {room.isChildren && <span className="status-pill"><ShieldAlert size={13} /> حلقة أطفال (وضع آمن)</span>}
          <span className="status-pill">{room.accessMode === 'public' ? 'رابط عام بحساب' : 'أعضاء الحلقة فقط'}</span>
        </div>
        <div className="room-top-actions">
          <button type="button" className="secondary-button compact-button" onClick={copyInvite}>
            <Copy size={14} /> {copied ? 'تم النسخ' : 'نسخ رابط الدعوة'}
          </button>
          {role === 'host' && onEndRoom && (
            <button type="button" className="secondary-button compact-button danger-action" onClick={onEndRoom}>
              <PhoneOff size={14} /> إنهاء للجميع
            </button>
          )}
          <button type="button" className="secondary-button compact-button" onClick={onLeave}>
            <LogOut size={14} /> مغادرة
          </button>
        </div>
      </header>

      {role === 'host' && !room.isChildren && onUpdateAccess && (
        <div className="room-access-bar">
          <label>
            نوع الدخول:{' '}
            <select
              value={room.accessMode}
              onChange={(e) => onUpdateAccess({
                accessMode: e.target.value as RoomAccessMode,
                waitingRoomEnabled: room.waitingRoomEnabled,
                allowStudentScreenshare: room.allowStudentScreenshare,
              })}
            >
              <option value="private">أعضاء الحلقة فقط</option>
              <option value="public">عام (يتطلب حسابًا)</option>
            </select>
          </label>
          <label className="lock-toggle-row">
            <input
              type="checkbox"
              checked={room.waitingRoomEnabled}
              onChange={(e) => onUpdateAccess({
                accessMode: room.accessMode,
                waitingRoomEnabled: e.target.checked,
                allowStudentScreenshare: room.allowStudentScreenshare,
              })}
            />
            <span>غرفة الانتظار</span>
          </label>
          <label className="lock-toggle-row">
            <input
              type="checkbox"
              checked={room.allowStudentScreenshare}
              onChange={(e) => onUpdateAccess({
                accessMode: room.accessMode,
                waitingRoomEnabled: room.waitingRoomEnabled,
                allowStudentScreenshare: e.target.checked,
              })}
            />
            <span>السماح بمشاركة الشاشة للطلاب</span>
          </label>
        </div>
      )}

      {reactions.length > 0 && (
        <div className="room-reaction-toast-row" aria-live="polite">
          {reactions.map((r) => (
            <span className="room-reaction-pill" key={r.id}>{r.emoji} {r.senderName}</span>
          ))}
        </div>
      )}

      <div className="room-body">
        <div className="room-stage">
          {whiteboardOpen && whiteboardSlot}
          {tiles.map((tile) => (
            <article className="room-tile" key={tile.identity}>
              {tile.screenTrack ? <MediaElement track={tile.screenTrack} kind="video" />
                : tile.videoTrack ? <MediaElement track={tile.videoTrack} kind="video" />
                : <div className="room-tile-avatar">{tile.name.slice(0, 1)}</div>}
              {tile.audioTrack && <MediaElement track={tile.audioTrack} kind="audio" />}
              <div className="room-tile-footer">
                <span>
                  {tile.name}{tile.isLocal ? ' (أنت)' : ''}
                  {raisedHands[tile.identity] && <> <Hand size={13} className="room-hand-icon" /></>}
                </span>
                <span>{tile.micEnabled ? <Mic size={14} /> : <MicOff size={14} />}</span>
              </div>
            </article>
          ))}
        </div>

        {panelTab && (
          <RoomSidePanel
            tab={panelTab}
            onTabChange={setPanelTab}
            onClose={() => setPanelTab(null)}
            role={role}
            onlyHostCanUnmute={room.onlyHostCanUnmute}
            tiles={tiles}
            dbParticipants={dbParticipants}
            raisedHands={raisedHands}
            chat={chat}
            onSendChat={onSendChat}
            onModerate={onModerate}
          />
        )}
      </div>

      <footer className="room-controls">
        <button
          type="button"
          className={micOn ? 'primary-button compact-button' : 'secondary-button compact-button'}
          disabled={!micOn && !canUnmuteMic}
          title={!canUnmuteMic ? 'فقط المعلمة أو المشرفة يمكنها السماح بالصوت' : micOn ? 'كتم الميكروفون' : 'فتح الميكروفون'}
          onClick={onToggleMic}
        >
          {micOn ? <Mic size={16} /> : <MicOff size={16} />} {micOn ? 'كتم' : 'الميكروفون'}
        </button>

        <button
          type="button"
          className={cameraOn ? 'primary-button compact-button' : 'secondary-button compact-button'}
          disabled={!cameraOn && !canUseCamera}
          onClick={onToggleCamera}
        >
          {cameraOn ? <Video size={16} /> : <VideoOff size={16} />} {cameraOn ? 'إيقاف الكاميرا' : 'الكاميرا'}
        </button>

        {canShareScreen && (
          <button
            type="button"
            className={screenOn ? 'primary-button compact-button' : 'secondary-button compact-button'}
            onClick={onToggleScreenShare}
          >
            <MonitorUp size={16} /> {screenOn ? 'إيقاف الشاشة' : 'مشاركة الشاشة'}
          </button>
        )}

        <button
          type="button"
          className={handRaised ? 'primary-button compact-button' : 'secondary-button compact-button'}
          onClick={onToggleHand}
        >
          <Hand size={16} /> {handRaised ? 'خفض اليد' : 'رفع اليد'}
        </button>

        <div className="room-reactions-bar" aria-label="تفاعلات سريعة">
          {REACTIONS.map((emoji) => (
            <button key={emoji} type="button" className="secondary-button compact-button" onClick={() => onSendReaction(emoji)}>
              {emoji}
            </button>
          ))}
        </div>

        {onToggleWhiteboard && (
          <button type="button" className={whiteboardOpen ? 'primary-button compact-button' : 'secondary-button compact-button'} onClick={onToggleWhiteboard}>
            <PencilLine size={16} /> السبورة
          </button>
        )}

        <button type="button" className="secondary-button compact-button" onClick={() => setPanelTab(panelTab === 'participants' ? null : 'participants')}>
          <Users size={16} /> المشاركون
        </button>
        <button type="button" className="secondary-button compact-button" onClick={() => setPanelTab(panelTab === 'chat' ? null : 'chat')}>
          <MessageSquare size={16} /> المحادثة
        </button>
      </footer>
    </div>
  )
}
