import { useState, type FormEvent } from 'react'
import { Ban, Check, Hand, Mic, MicOff, Send, Shield, UserMinus, X } from 'lucide-react'
import type { LiveParticipantTile, RoomChatMessage, RoomParticipantRecord, RoomRole } from './roomTypes'

type Props = {
  tab: 'participants' | 'chat'
  onTabChange: (tab: 'participants' | 'chat') => void
  onClose: () => void
  role: RoomRole
  onlyHostCanUnmute: boolean
  tiles: LiveParticipantTile[]
  dbParticipants: RoomParticipantRecord[]
  raisedHands: Record<string, boolean>
  chat: RoomChatMessage[]
  onSendChat: (text: string) => Promise<void>
  onModerate?: (action: 'mute' | 'unmute' | 'remove' | 'ban' | 'admit' | 'deny', userId: string) => void
}

export default function RoomSidePanel({
  tab, onTabChange, onClose, role, tiles, dbParticipants, raisedHands, chat, onSendChat, onModerate,
}: Props) {
  const [draft, setDraft] = useState('')
  const waiting = dbParticipants.filter((p) => p.admissionStatus === 'pending')
  const byUserId = new Map(dbParticipants.map((p) => [p.userId, p]))

  const submitChat = (e: FormEvent) => {
    e.preventDefault()
    if (!draft.trim()) return
    void onSendChat(draft)
    setDraft('')
  }

  return (
    <aside className="room-side-panel glass" aria-label={tab === 'participants' ? 'قائمة المشاركين' : 'المحادثة'}>
      <div className="room-side-tabs">
        <button type="button" className={tab === 'participants' ? 'active' : ''} onClick={() => onTabChange('participants')}>
          المشاركون ({tiles.length})
        </button>
        <button type="button" className={tab === 'chat' ? 'active' : ''} onClick={() => onTabChange('chat')}>
          المحادثة ({chat.length})
        </button>
        <button type="button" className="icon-button" aria-label="إغلاق اللوحة" onClick={onClose}><X size={16} /></button>
      </div>

      {tab === 'participants' ? (
        <div className="room-participants-list">
          {role === 'host' && waiting.length > 0 && (
            <div className="room-waiting-box">
              <strong>غرفة الانتظار ({waiting.length})</strong>
              {waiting.map((w) => (
                <div className="room-participant-row" key={w.userId}>
                  <span>{w.displayName}</span>
                  <div className="room-row-actions">
                    <button type="button" className="small-icon-button" title="قبول" onClick={() => onModerate?.('admit', w.userId)}><Check size={14} /></button>
                    <button type="button" className="small-icon-button danger-action" title="رفض" onClick={() => onModerate?.('deny', w.userId)}><X size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tiles.map((tile) => {
            const dbRec = byUserId.get(tile.identity)
            return (
              <div className="room-participant-row" key={tile.identity}>
                <div className="room-participant-info">
                  <strong>{tile.name}{tile.isLocal ? ' (أنت)' : ''}</strong>
                  <small>
                    {tile.isHost && <Shield size={12} />}
                    {raisedHands[tile.identity] && <Hand size={12} className="room-hand-icon" />}
                    {tile.micEnabled ? <Mic size={12} /> : <MicOff size={12} />}
                  </small>
                </div>
                {role === 'host' && !tile.isLocal && !tile.isHost && onModerate && (
                  <div className="room-row-actions">
                    <button
                      type="button"
                      className="small-icon-button"
                      title={dbRec?.mutedByHost ? 'السماح بالصوت' : 'كتم الصوت'}
                      onClick={() => onModerate(dbRec?.mutedByHost ? 'unmute' : 'mute', tile.identity)}
                    >
                      {dbRec?.mutedByHost ? <Mic size={14} /> : <MicOff size={14} />}
                    </button>
                    <button type="button" className="small-icon-button" title="إزالة" onClick={() => onModerate('remove', tile.identity)}><UserMinus size={14} /></button>
                    <button type="button" className="small-icon-button danger-action" title="حظر" onClick={() => onModerate('ban', tile.identity)}><Ban size={14} /></button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="room-chat-wrap">
          <div className="room-chat-messages">
            {chat.length === 0 && <p className="muted-text">لا توجد رسائل بعد.</p>}
            {chat.map((msg) => (
              <div className="room-chat-item" key={msg.id}>
                <strong>{msg.senderName}</strong>
                <p>{msg.text}</p>
              </div>
            ))}
          </div>
          <form className="room-chat-form" onSubmit={submitChat}>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="اكتب رسالة…" maxLength={500} />
            <button type="submit" className="primary-button compact-button" aria-label="إرسال"><Send size={15} /></button>
          </form>
        </div>
      )}
    </aside>
  )
}
