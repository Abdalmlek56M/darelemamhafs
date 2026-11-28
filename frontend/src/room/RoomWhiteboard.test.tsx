// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import RoomWhiteboard from './RoomWhiteboard'

describe('RoomWhiteboard (Mission 6)', () => {
  it('allows host to clear whiteboard while hiding clear control for student participants', () => {
    const onClear = vi.fn()
    const { rerender } = render(
      <RoomWhiteboard role="host" strokes={[]} onAddStroke={vi.fn()} onClear={onClear} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /مسح السبورة/ }))
    expect(onClear).toHaveBeenCalledTimes(1)

    rerender(<RoomWhiteboard role="participant" strokes={[]} onAddStroke={vi.fn()} onClear={onClear} />)
    expect(screen.queryByRole('button', { name: /مسح السبورة/ })).toBeNull()
  })

  it('keeps the close button in the same tools row as the colors and clear action', () => {
    const onClose = vi.fn()
    render(<RoomWhiteboard role="host" strokes={[]} onAddStroke={vi.fn()} onClear={vi.fn()} onClose={onClose} />)

    const close = screen.getByRole('button', { name: 'إغلاق السبورة' })
    const tools = close.closest('.room-wb-tools')
    expect(tools).toBeTruthy()
    expect(tools?.querySelectorAll('.room-wb-color').length).toBe(5)
    expect(tools?.querySelector('.room-wb-clear')).toBeTruthy()
    expect(tools?.closest('.room-whiteboard-head')).toBeTruthy()

    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
