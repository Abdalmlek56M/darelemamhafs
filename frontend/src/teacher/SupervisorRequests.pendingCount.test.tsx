// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import SupervisorRequests from './SupervisorRequests'

afterEach(() => { cleanup() })

function pendingButton(): HTMLButtonElement {
  const button = screen.getAllByRole('button').find((item) => item.textContent?.includes('قيد المراجعة'))
  if (!button) throw new Error('pending filter button not found')
  return button as HTMLButtonElement
}

describe('SupervisorRequests pending counter', () => {
  it('keeps a real pending count when the "all" filter is selected instead of the "—" placeholder', async () => {
    render(<SupervisorRequests demo />)
    await waitFor(() => expect(pendingButton().textContent).toContain('(2)'))
    fireEvent.click(screen.getByRole('button', { name: 'الكل' }))
    await waitFor(() => expect(pendingButton().textContent).toContain('(2)'))
    expect(pendingButton().textContent).not.toContain('—')
    expect(document.body.textContent).not.toContain('قيد المراجعة (—)')
  })
})
