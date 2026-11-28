// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MeetingRoomView from './MeetingRoomView'
import type { LiveKitRoomInfo } from './roomTypes'

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

describe('MeetingRoomView (Mission 3)', () => {
  it('enforces child-circle restrictions for student participants and supports hand raise, reactions, and chat', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '👍' }))
    expect(onSendReaction).toHaveBeenCalledWith('👍')

    fireEvent.click(screen.getByRole('button', { name: 'المحادثة' }))
    fireEvent.change(screen.getByPlaceholderText('اكتب رسالة…'), { target: { value: 'السلام عليكم' } })
    fireEvent.click(screen.getByRole('button', { name: 'إرسال' }))
    expect(onSendChat).toHaveBeenCalledWith('السلام عليكم')
  })
})
