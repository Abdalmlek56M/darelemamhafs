import { useEffect, useRef, useState } from 'react'
import {
  LogOut, Maximize2, Minimize2, MonitorUp, PencilLine, PhoneOff, ShieldAlert, Volume2,
} from 'lucide-react'
import type {
  LiveKitRoomInfo, LiveParticipantTile, RoomAccessMode,
  RoomChatMessage, RoomParticipantRecord, RoomReaction, RoomRole,
} from './roomTypes'
import RoomSidePanel from './RoomSidePanel'
import RoomTile, { MediaElement } from './RoomTile'
import RoomControlsBar from './RoomControlsBar'
import RoomConfirmDialog from './RoomConfirmDialog'
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
  whiteboardHostActive?: boolean
  onToggleWhiteboard?: () => void
  whiteboardSlot?: React.ReactNode
  hostMuted?: boolean
  notice?: string | null
  audioBlocked?: boolean
  onStartAudio?: () => void
}

type MainView = 'screen' | 'whiteboard'

export default function MeetingRoomView({
  room, role, tiles, dbParticipants, micOn, cameraOn, screenOn, handRaised,
  canUnmuteMic, canUseCamera, canShareScreen, raisedHands, chat, reactions,
  onToggleMic, onToggleCamera, onToggleScreenShare, onToggleHand,
  onSendReaction, onSendChat, onLeave, onEndRoom, onModerate, onUpdateAccess,
  whiteboardOpen = false, whiteboardHostActive = false, onToggleWhiteboard, whiteboardSlot,
  hostMuted = false, notice = null, audioBlocked = false, onStartAudio,
}: Props) {
  const [panelTab, setPanelTab] = useState<'participants' | 'chat' | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [mainView, setMainView] = useState<MainView>('screen')
  const [confirmEnd, setConfirmEnd] = useState(false)
  const spotlightRef = useRef<HTMLDivElement | null>(null)

  const screenTile = tiles.find((t) => Boolean(t.screenTrack)) ?? null
  const screenTrack = screenTile?.screenTrack ?? null
  const hasScreen = Boolean(screenTrack)
  const hasBoard = whiteboardOpen
  const screenKey = screenTile?.identity ?? null

  // A new screen share takes the stage; opening the whiteboard takes it back (board effect runs last).
  useEffect(() => { if (screenKey) setMainView('screen') }, [screenKey])
  useEffect(() => { if (hasBoard) setMainView('whiteboard') }, [hasBoard])

  const showBoard = hasBoard && (!hasScreen || mainView === 'whiteboard')
  const showScreen = hasScreen && !showBoard

  useEffect(() => {
    if (!showScreen && fullscreen) {
      setFullscreen(false)
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    }
  }, [showScreen, fullscreen])

  useEffect(() => {
    const onFsChange = () => {
      if (!document.fullscreenElement) setFullscreen(false)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const toggleFullscreen = async () => {
    if (fullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
      setFullscreen(false)
      return
    }
    setFullscreen(true)
    const el = spotlightRef.current
    if (el?.requestFullscreen) {
      await el.requestFullscreen().catch(() => undefined)
    }
  }

  const copyInvite = () => {
    const url = `${window.location.origin}/room/${room.inviteCode}`
    void navigator.clipboard?.writeText(url)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const strip = (
    <div className="room-strip" aria-label="المشاركون">
      {tiles.map((tile) => (
        <RoomTile key={tile.identity} tile={tile} handRaised={Boolean(raisedHands[tile.identity])} compact />
      ))}
    </div>
  )

  return (
    <div className="room-shell">
      <header className="room-topbar">
        <div className="room-title-group">
          <h1>{room.title}</h1>
          {room.isChildren && (
            <span className="status-pill"><ShieldAlert size={13} /> حلقة أطفال</span>
          )}
        </div>
        <div className="room-top-actions">
          <button type="button" className="secondary-button compact-button" onClick={onLeave}>
            <LogOut size={15} /> مغادرة
          </button>
          {role === 'host' && onEndRoom && (
            <>
              <span className="room-top-divider" aria-hidden="true" />
              <button type="button" className="room-end-btn" onClick={() => setConfirmEnd(true)}>
                <PhoneOff size={15} /> إنهاء للجميع
              </button>
            </>
          )}
        </div>
      </header>

      {audioBlocked && onStartAudio && (
        <div className="room-audio-banner" role="alert">
          <span>المتصفح منع تشغيل الصوت تلقائيًا.</span>
          <button type="button" className="primary-button compact-button" onClick={onStartAudio}>
            <Volume2 size={15} /> اضغط لتفعيل الصوت
          </button>
        </div>
      )}

      {(hostMuted || notice) && (
        <div className="room-notice-banner" role="status" aria-live="polite">
          {notice ?? 'المعلمة كتمت صوتك'}
        </div>
      )}

      {whiteboardHostActive && !whiteboardOpen && onToggleWhiteboard && (
        <div className="room-wb-prompt" role="status">
          <span>السبورة المشتركة مفتوحة الآن</span>
          <button type="button" className="primary-button compact-button" onClick={onToggleWhiteboard}>
            فتح السبورة
          </button>
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
        <div className="room-main-area">
          {hasScreen && hasBoard && (
            <div className="room-view-switch" role="tablist" aria-label="عرض المحتوى">
              <button type="button" role="tab" aria-selected={showScreen} className={showScreen ? 'active' : ''} onClick={() => setMainView('screen')}>
                <MonitorUp size={15} /> الشاشة المشتركة
              </button>
              <button type="button" role="tab" aria-selected={showBoard} className={showBoard ? 'active' : ''} onClick={() => setMainView('whiteboard')}>
                <PencilLine size={15} /> السبورة
              </button>
            </div>
          )}

          {showBoard ? (
            <>
              <div className="room-board-stage">{whiteboardSlot}</div>
              {strip}
            </>
          ) : showScreen && screenTile && screenTrack ? (
            <>
              <div ref={spotlightRef} className={`room-spotlight${fullscreen ? ' is-fullscreen' : ''}`}>
                <MediaElement track={screenTrack} kind="video" fit="contain" />
                <div className="room-spotlight-bar">
                  <span>شاشة {screenTile.name}</span>
                  <button
                    type="button"
                    className="secondary-button compact-button"
                    aria-label={fullscreen ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
                    onClick={() => void toggleFullscreen()}
                  >
                    {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                    <span>{fullscreen ? 'تصغير' : 'ملء الشاشة'}</span>
                  </button>
                </div>
              </div>
              {strip}
            </>
          ) : (
            <div className="room-stage">
              {tiles.map((tile) => (
                <RoomTile key={tile.identity} tile={tile} handRaised={Boolean(raisedHands[tile.identity])} />
              ))}
            </div>
          )}
        </div>

        {panelTab && (
          <>
            <div className="room-side-overlay" onClick={() => setPanelTab(null)} aria-hidden="true" />
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
          </>
        )}
      </div>

      <RoomControlsBar
        room={room}
        role={role}
        micOn={micOn}
        cameraOn={cameraOn}
        screenOn={screenOn}
        handRaised={handRaised}
        hostMuted={hostMuted}
        canUnmuteMic={canUnmuteMic}
        canUseCamera={canUseCamera}
        canShareScreen={canShareScreen}
        whiteboardOpen={whiteboardOpen}
        whiteboardHostActive={whiteboardHostActive}
        panelTab={panelTab}
        participantCount={tiles.length}
        chatCount={chat.length}
        moreOpen={moreOpen}
        copied={copied}
        onToggleMic={onToggleMic}
        onToggleCamera={onToggleCamera}
        onToggleScreenShare={onToggleScreenShare}
        onToggleHand={onToggleHand}
        onToggleWhiteboard={onToggleWhiteboard}
        onTogglePanel={(tab) => setPanelTab((cur) => (cur === tab ? null : tab))}
        onToggleMore={() => setMoreOpen((v) => !v)}
        onCloseMore={() => setMoreOpen(false)}
        onSendReaction={onSendReaction}
        onCopyInvite={copyInvite}
        onUpdateAccess={onUpdateAccess}
      />

      {confirmEnd && (
        <RoomConfirmDialog
          title="إنهاء الاجتماع للجميع؟"
          message="سيتم إخراج جميع المشاركين وإغلاق الغرفة نهائيًا. لا يمكن التراجع عن هذا الإجراء."
          confirmLabel="إنهاء للجميع"
          onCancel={() => setConfirmEnd(false)}
          onConfirm={() => { setConfirmEnd(false); onEndRoom?.() }}
        />
      )}
    </div>
  )
}
