import {
  Copy, Hand, MessageSquare, Mic, MicOff, MonitorUp, MoreHorizontal,
  PencilLine, Users, Video, VideoOff, X,
} from 'lucide-react'
import type { LiveKitRoomInfo, RoomAccessMode, RoomRole } from './roomTypes'

const REACTIONS = ['👍', '❤️', '🤲', '👏']

type Props = {
  room: LiveKitRoomInfo
  role: RoomRole
  micOn: boolean
  cameraOn: boolean
  screenOn: boolean
  handRaised: boolean
  hostMuted: boolean
  canUnmuteMic: boolean
  canUseCamera: boolean
  canShareScreen: boolean
  whiteboardOpen: boolean
  whiteboardHostActive: boolean
  panelTab: 'participants' | 'chat' | null
  participantCount: number
  chatCount: number
  moreOpen: boolean
  copied: boolean
  onToggleMic: () => void
  onToggleCamera: () => void
  onToggleScreenShare: () => void
  onToggleHand: () => void
  onToggleWhiteboard?: () => void
  onTogglePanel: (tab: 'participants' | 'chat') => void
  onToggleMore: () => void
  onCloseMore: () => void
  onSendReaction: (emoji: string) => void
  onCopyInvite: () => void
  onUpdateAccess?: (patch: { accessMode: RoomAccessMode; waitingRoomEnabled: boolean; allowStudentScreenshare: boolean }) => void
}

export default function RoomControlsBar({
  room, role, micOn, cameraOn, screenOn, handRaised, hostMuted,
  canUnmuteMic, canUseCamera, canShareScreen,
  whiteboardOpen, whiteboardHostActive, panelTab, participantCount, chatCount,
  moreOpen, copied,
  onToggleMic, onToggleCamera, onToggleScreenShare, onToggleHand,
  onToggleWhiteboard, onTogglePanel, onToggleMore, onCloseMore,
  onSendReaction, onCopyInvite, onUpdateAccess,
}: Props) {
  return (
    <>
      <footer className="room-controls" aria-label="أدوات التحكم">
        <button
          type="button"
          className={`room-ctrl-btn ${micOn ? 'primary-button' : `secondary-button${hostMuted ? ' room-mic-muted-host' : ''}`}`}
          disabled={!micOn && !canUnmuteMic}
          aria-pressed={micOn}
          data-muted-by-host={hostMuted ? 'true' : 'false'}
          title={hostMuted ? 'المعلمة كتمت صوتك' : !canUnmuteMic ? 'فقط المعلمة أو المشرفة يمكنها السماح بالصوت' : micOn ? 'كتم الميكروفون' : 'فتح الميكروفون'}
          onClick={onToggleMic}
        >
          {micOn ? <Mic size={18} /> : <MicOff size={18} />}
          <span>{micOn ? 'كتم' : hostMuted ? 'الميكروفون (مكتوم)' : 'الميكروفون'}</span>
        </button>

        <button
          type="button"
          className={`room-ctrl-btn ${cameraOn ? 'primary-button' : 'secondary-button'}`}
          disabled={!cameraOn && !canUseCamera}
          aria-pressed={cameraOn}
          onClick={onToggleCamera}
        >
          {cameraOn ? <Video size={18} /> : <VideoOff size={18} />}
          <span>{cameraOn ? 'إيقاف الكاميرا' : 'الكاميرا'}</span>
        </button>

        {canShareScreen && (
          <button
            type="button"
            className={`room-ctrl-btn room-desktop-only ${screenOn ? 'primary-button' : 'secondary-button'}`}
            aria-pressed={screenOn}
            onClick={onToggleScreenShare}
          >
            <MonitorUp size={18} />
            <span>{screenOn ? 'إيقاف الشاشة' : 'مشاركة الشاشة'}</span>
          </button>
        )}

        <button
          type="button"
          className={`room-ctrl-btn ${handRaised ? 'primary-button' : 'secondary-button'}`}
          aria-pressed={handRaised}
          onClick={onToggleHand}
        >
          <Hand size={18} />
          <span>{handRaised ? 'خفض اليد' : 'رفع اليد'}</span>
        </button>

        {onToggleWhiteboard && (
          <button
            type="button"
            className={`room-ctrl-btn room-desktop-only ${whiteboardOpen ? 'primary-button' : 'secondary-button'}`}
            aria-pressed={whiteboardOpen}
            onClick={onToggleWhiteboard}
          >
            <PencilLine size={18} />
            <span>السبورة</span>
          </button>
        )}

        <button
          type="button"
          className={`room-ctrl-btn room-desktop-only ${panelTab === 'participants' ? 'primary-button' : 'secondary-button'}`}
          onClick={() => onTogglePanel('participants')}
        >
          <Users size={18} />
          <span>المشاركون ({participantCount})</span>
        </button>

        <button
          type="button"
          className={`room-ctrl-btn room-desktop-only ${panelTab === 'chat' ? 'primary-button' : 'secondary-button'}`}
          onClick={() => onTogglePanel('chat')}
        >
          <MessageSquare size={18} />
          <span>المحادثة ({chatCount})</span>
        </button>

        <button
          type="button"
          className={`room-ctrl-btn ${moreOpen ? 'primary-button' : 'secondary-button'}`}
          aria-expanded={moreOpen}
          aria-label="المزيد"
          onClick={onToggleMore}
        >
          <MoreHorizontal size={18} />
          <span>المزيد</span>
          {whiteboardHostActive && !whiteboardOpen && <span className="room-dot-badge" aria-hidden="true" />}
        </button>
      </footer>

      {moreOpen && (
        <div className="room-sheet-backdrop" onClick={onCloseMore}>
          <div className="room-more-sheet glass" role="dialog" aria-label="المزيد من الأدوات" onClick={(e) => e.stopPropagation()}>
            <div className="room-sheet-head">
              <strong>أدوات إضافية</strong>
              <button type="button" className="icon-button" aria-label="إغلاق القائمة" onClick={onCloseMore}><X size={18} /></button>
            </div>

            <div className="room-more-grid">
              {canShareScreen && (
                <button type="button" className={screenOn ? 'primary-button' : 'secondary-button'} onClick={() => { onToggleScreenShare(); onCloseMore() }}>
                  <MonitorUp size={18} /> {screenOn ? 'إيقاف مشاركة الشاشة' : 'مشاركة الشاشة'}
                </button>
              )}
              {onToggleWhiteboard && (
                <button type="button" className={whiteboardOpen ? 'primary-button' : 'secondary-button'} onClick={() => { onToggleWhiteboard(); onCloseMore() }}>
                  <PencilLine size={18} /> {whiteboardOpen ? 'إخفاء السبورة' : 'فتح السبورة'}
                </button>
              )}
              <button type="button" className="secondary-button" onClick={() => { onTogglePanel('participants'); onCloseMore() }}>
                <Users size={18} /> المشاركون ({participantCount})
              </button>
              <button type="button" className="secondary-button" onClick={() => { onTogglePanel('chat'); onCloseMore() }}>
                <MessageSquare size={18} /> المحادثة ({chatCount})
              </button>
              <button type="button" className="secondary-button" onClick={onCopyInvite}>
                <Copy size={18} /> {copied ? 'تم نسخ الرابط' : 'نسخ رابط الدعوة'}
              </button>
            </div>

            <div className="room-more-reactions" aria-label="تفاعلات سريعة">
              <span>تفاعل سريع:</span>
              <div className="room-reactions-bar">
                {REACTIONS.map((emoji) => (
                  <button key={emoji} type="button" className="secondary-button room-reaction-btn" onClick={() => { onSendReaction(emoji); onCloseMore() }}>
                    {emoji}
                  </button>
                ))}
              </div>
            </div>

            {role === 'host' && !room.isChildren && onUpdateAccess && (
              <div className="room-more-access">
                <strong>إعدادات الدخول</strong>
                <label className="room-field">
                  <span>نوع الدخول</span>
                  <select
                    className="room-select"
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
                <label className="room-toggle-row">
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
                <label className="room-toggle-row">
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
          </div>
        </div>
      )}
    </>
  )
}
