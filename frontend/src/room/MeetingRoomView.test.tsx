// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

    fireEvent.click(screen.getByRole('button', { name: /إنهاء/ }))
    expect(onEndRoom).toHaveBeenCalledTimes(1)
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
})
