// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Track } from 'livekit-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MeetingRoomView from './MeetingRoomView'
import type { LiveKitRoomInfo } from './roomTypes'

afterEach(() => { cleanup() })

const baseRoom: LiveKitRoomInfo = {
  id: 'r-1',
  roomName: 'dar-abc',
  inviteCode: 'abc',
  invitePath: '/room/abc',
  circleId: 'c-1',
  circleName: 'حلقة الأطفال',
  isChildren: true,
  sessionId: null,
  title: 'حلقة الأطفال',
  accessMode: 'private',
  waitingRoomEnabled: true,
  allowStudentScreenshare: false,
  onlyHostCanUnmute: true,
  status: 'open',
  createdAt: '2026-11-28T10:00:00Z',
}

describe('MeetingRoomView', () => {
  it('enforces child-circle restrictions and supports hand raise, More reactions, and chat drawer', () => {
    const onToggleHand = vi.fn()
    const onSendReaction = vi.fn()
    const onSendChat = vi.fn(async () => {})

    render(
      <MeetingRoomView
        room={baseRoom}
        role="participant"
        tiles={[{
          identity: 'u-1',
          name: 'مريم',
          isLocal: true,
          isHost: false,
          micEnabled: false,
          cameraEnabled: false,
          screenEnabled: false,
          videoTrack: null,
          screenTrack: null,
          audioTrack: null,
        }]}
        dbParticipants={[]}
        micOn={false}
        cameraOn={false}
        screenOn={false}
        handRaised={false}
        canUnmuteMic={false}
        canUseCamera={false}
        canShareScreen={false}
        raisedHands={{}}
        chat={[]}
        reactions={[]}
        onToggleMic={vi.fn()}
        onToggleCamera={vi.fn()}
        onToggleScreenShare={vi.fn()}
        onToggleHand={onToggleHand}
        onSendReaction={onSendReaction}
        onSendChat={onSendChat}
        onLeave={vi.fn()}
      />,
    )

    expect(screen.getByText(/حلقة أطفال/)).toBeTruthy()
    expect((screen.getByRole('button', { name: /الميكروفون/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /الكاميرا/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: /مشاركة الشاشة/ })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /رفع اليد/ }))
    expect(onToggleHand).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /المزيد/ }))
    fireEvent.click(screen.getByRole('button', { name: '👍' }))
    expect(onSendReaction).toHaveBeenCalledWith('👍')

    fireEvent.click(screen.getByRole('button', { name: /المحادثة/ }))
    fireEvent.change(screen.getByPlaceholderText('اكتب رسالة…'), { target: { value: 'السلام عليكم' } })
    fireEvent.click(screen.getByRole('button', { name: 'إرسال' }))
    expect(onSendChat).toHaveBeenCalledWith('السلام عليكم')
  })

  it('renders host controls in Participants sheet for admit/deny, mute, remove, ban, and end meeting', () => {
    const onModerate = vi.fn()
    const onEndRoom = vi.fn()

    render(
      <MeetingRoomView
        room={baseRoom}
        role="host"
        tiles={[
          { identity: 'h-1', name: 'المعلمة', isLocal: true, isHost: true, micEnabled: true, cameraEnabled: false, screenEnabled: false, videoTrack: null, screenTrack: null, audioTrack: null },
          { identity: 's-1', name: 'سارة', isLocal: false, isHost: false, micEnabled: true, cameraEnabled: false, screenEnabled: false, videoTrack: null, screenTrack: null, audioTrack: null },
        ]}
        dbParticipants={[
          { userId: 's-1', username: 's1', displayName: 'سارة', role: 'participant', admissionStatus: 'admitted', mutedByHost: false, firstJoinedAt: null, lastJoinedAt: null, lastLeftAt: null, attendedSeconds: 60, attendedMinutes: 1, isConnected: true },
          { userId: 'w-1', username: 'w1', displayName: 'زائرة منتظرة', role: 'participant', admissionStatus: 'pending', mutedByHost: false, firstJoinedAt: null, lastJoinedAt: null, lastLeftAt: null, attendedSeconds: 0, attendedMinutes: 0, isConnected: false },
        ]}
        micOn={true}
        cameraOn={false}
        screenOn={false}
        handRaised={false}
        canUnmuteMic={true}
        canUseCamera={true}
        canShareScreen={true}
        raisedHands={{}}
        chat={[]}
        reactions={[]}
        onToggleMic={vi.fn()}
        onToggleCamera={vi.fn()}
        onToggleScreenShare={vi.fn()}
        onToggleHand={vi.fn()}
        onSendReaction={vi.fn()}
        onSendChat={vi.fn(async () => {})}
        onLeave={vi.fn()}
        onModerate={onModerate}
        onEndRoom={onEndRoom}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /المشاركون/ }))

    fireEvent.click(screen.getByTitle('قبول'))
    expect(onModerate).toHaveBeenCalledWith('admit', 'w-1')

    fireEvent.click(screen.getByTitle('رفض'))
    expect(onModerate).toHaveBeenCalledWith('deny', 'w-1')

    fireEvent.click(screen.getByTitle('كتم الصوت'))
    expect(onModerate).toHaveBeenCalledWith('mute', 's-1')

    fireEvent.click(screen.getByTitle('إزالة'))
    expect(onModerate).toHaveBeenCalledWith('remove', 's-1')

    fireEvent.click(screen.getByTitle('حظر'))
    expect(onModerate).toHaveBeenCalledWith('ban', 's-1')

    fireEvent.click(screen.getByRole('button', { name: 'إنهاء للجميع' }))
    const dialog = screen.getByRole('alertdialog')
    expect(onEndRoom).not.toHaveBeenCalled()

    // Cancelling keeps the meeting running.
    fireEvent.click(within(dialog).getByRole('button', { name: 'إلغاء' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onEndRoom).not.toHaveBeenCalled()

    // Confirming ends it for everyone.
    fireEvent.click(screen.getByRole('button', { name: 'إنهاء للجميع' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'إنهاء للجميع' }))
    expect(onEndRoom).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('shows host-mute notice, active whiteboard prompt, and screen-share spotlight with fullscreen toggle', () => {
    const fakeScreenTrack = { attach: vi.fn(), detach: vi.fn() } as unknown as Track
    const onToggleWhiteboard = vi.fn()

    const { rerender } = render(
      <MeetingRoomView
        room={{ ...baseRoom, isChildren: false, onlyHostCanUnmute: false }}
        role="participant"
        tiles={[
          { identity: 'h-1', name: 'المعلمة', isLocal: false, isHost: true, micEnabled: true, cameraEnabled: false, screenEnabled: true, videoTrack: null, screenTrack: fakeScreenTrack, audioTrack: null },
          { identity: 'u-1', name: 'مريم', isLocal: true, isHost: false, micEnabled: false, cameraEnabled: false, screenEnabled: false, videoTrack: null, screenTrack: null, audioTrack: null },
        ]}
        dbParticipants={[]}
        micOn={false}
        cameraOn={false}
        screenOn={false}
        handRaised={false}
        canUnmuteMic={false}
        canUseCamera={true}
        canShareScreen={false}
        raisedHands={{}}
        chat={[]}
        reactions={[]}
        hostMuted={true}
        notice="المعلمة كتمت صوتك"
        whiteboardOpen={false}
        whiteboardHostActive={true}
        onToggleWhiteboard={onToggleWhiteboard}
        onToggleMic={vi.fn()}
        onToggleCamera={vi.fn()}
        onToggleScreenShare={vi.fn()}
        onToggleHand={vi.fn()}
        onSendReaction={vi.fn()}
        onSendChat={vi.fn(async () => {})}
        onLeave={vi.fn()}
      />,
    )

    expect(screen.getByText('المعلمة كتمت صوتك')).toBeTruthy()
    const micButton = screen.getByRole('button', { name: /الميكروفون \(مكتوم\)/ }) as HTMLButtonElement
    expect(micButton.disabled).toBe(true)
    expect(micButton.dataset.mutedByHost).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'فتح السبورة' }))
    expect(onToggleWhiteboard).toHaveBeenCalledTimes(1)

    expect(screen.getByText('شاشة المعلمة')).toBeTruthy()
    const fsBtn = screen.getByRole('button', { name: 'ملء الشاشة' })
    fireEvent.click(fsBtn)
    expect(screen.getByRole('button', { name: 'إنهاء ملء الشاشة' })).toBeTruthy()

    rerender(
      <MeetingRoomView
        room={{ ...baseRoom, isChildren: false, onlyHostCanUnmute: false }}
        role="participant"
        tiles={[{ identity: 'u-1', name: 'مريم', isLocal: true, isHost: false, micEnabled: false, cameraEnabled: false, screenEnabled: false, videoTrack: null, screenTrack: null, audioTrack: null }]}
        dbParticipants={[]}
        micOn={false}
        cameraOn={false}
        screenOn={false}
        handRaised={false}
        canUnmuteMic={true}
        canUseCamera={true}
        canShareScreen={false}
        raisedHands={{}}
        chat={[]}
        reactions={[]}
        onToggleMic={vi.fn()}
        onToggleCamera={vi.fn()}
        onToggleScreenShare={vi.fn()}
        onToggleHand={vi.fn()}
        onSendReaction={vi.fn()}
        onSendChat={vi.fn(async () => {})}
        onLeave={vi.fn()}
      />,
    )
    expect(screen.queryByText('شاشة المعلمة')).toBeNull()
  })

  const commonProps = {
    dbParticipants: [],
    micOn: false,
    cameraOn: false,
    screenOn: false,
    handRaised: false,
    canUnmuteMic: true,
    canUseCamera: true,
    canShareScreen: false,
    raisedHands: {},
    chat: [],
    reactions: [],
    onToggleMic: vi.fn(),
    onToggleCamera: vi.fn(),
    onToggleScreenShare: vi.fn(),
    onToggleHand: vi.fn(),
    onSendReaction: vi.fn(),
    onSendChat: vi.fn(async () => {}),
    onLeave: vi.fn(),
  }

  it('lets viewers switch between the shared screen and the whiteboard while both are active', () => {
    const fakeScreenTrack = { attach: vi.fn(), detach: vi.fn() } as unknown as Track
    render(
      <MeetingRoomView
        {...commonProps}
        room={{ ...baseRoom, isChildren: false, onlyHostCanUnmute: false }}
        role="participant"
        tiles={[
          { identity: 'h-1', name: 'المعلمة', isLocal: false, isHost: true, micEnabled: true, cameraEnabled: false, screenEnabled: true, videoTrack: null, screenTrack: fakeScreenTrack, audioTrack: null },
          { identity: 'u-1', name: 'مريم', isLocal: true, isHost: false, micEnabled: false, cameraEnabled: false, screenEnabled: false, videoTrack: null, screenTrack: null, audioTrack: null },
        ]}
        whiteboardOpen
        whiteboardHostActive
        onToggleWhiteboard={vi.fn()}
        whiteboardSlot={<div data-testid="wb-slot">السبورة</div>}
      />,
    )

    expect(screen.getByRole('tablist', { name: 'عرض المحتوى' })).toBeTruthy()
    expect(screen.getByTestId('wb-slot')).toBeTruthy()
    expect(screen.queryByText('شاشة المعلمة')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /الشاشة المشتركة/ }))
    expect(screen.getByText('شاشة المعلمة')).toBeTruthy()
    expect(screen.queryByTestId('wb-slot')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: /السبورة/ }))
    expect(screen.getByTestId('wb-slot')).toBeTruthy()
    expect(screen.queryByText('شاشة المعلمة')).toBeNull()
  })

  it('shows an Arabic enable-audio button when playback is blocked and calls onStartAudio', () => {
    const onStartAudio = vi.fn()
    render(
      <MeetingRoomView
        {...commonProps}
        room={{ ...baseRoom, isChildren: false, onlyHostCanUnmute: false }}
        role="participant"
        tiles={[]}
        audioBlocked
        onStartAudio={onStartAudio}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'اضغط لتفعيل الصوت' }))
    expect(onStartAudio).toHaveBeenCalledTimes(1)
  })

  it('truncates long participant names inside a dedicated label so the mic icon never overlaps', () => {
    render(
      <MeetingRoomView
        {...commonProps}
        room={{ ...baseRoom, isChildren: false, onlyHostCanUnmute: false }}
        role="participant"
        tiles={[{ identity: 'u-1', name: 'مريم أحمد عبد الرحمن السيد المحمدي الأنصاري', isLocal: false, isHost: false, micEnabled: false, cameraEnabled: false, screenEnabled: false, videoTrack: null, screenTrack: null, audioTrack: null }]}
      />,
    )

    const label = document.querySelector('.room-tile-label')
    expect(label?.getAttribute('title')).toContain('الأنصاري')
    expect(label?.closest('.room-tile-name')).toBeTruthy()
    expect(document.querySelector('.room-tile-mic')).toBeTruthy()
  })
})
