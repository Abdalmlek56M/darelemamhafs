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
})
