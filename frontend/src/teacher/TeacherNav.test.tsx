// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TeacherNav from './TeacherNav'

const noop = () => undefined

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('TeacherNav live/roster buttons without a running circle', () => {
  it('disables "الحلقة" and "الحضور" and explains why when there is no running circle', () => {
    render(<TeacherNav page="home" unread={0} canTeacher canRequests={false} activeSessionId={null} onNavigate={noop} onOpenRoster={noop} />)
    for (const label of ['الحلقة', 'الحضور']) {
      const button = screen.getByRole('button', { name: new RegExp(label) })
      expect(button.hasAttribute('disabled')).toBe(true)
      expect(button.getAttribute('title')).toBe('لا توجد حلقة جارية')
    }
  })

  it('keeps both buttons enabled and working when a circle is running', () => {
    const onNavigate = vi.fn()
    const onOpenRoster = vi.fn()
    render(<TeacherNav page="home" unread={0} canTeacher canRequests={false} activeSessionId="sess-1" onNavigate={onNavigate} onOpenRoster={onOpenRoster} />)
    const live = screen.getByRole('button', { name: /الحلقة/ })
    const roster = screen.getByRole('button', { name: /^الحضور$/ })
    expect(live.hasAttribute('disabled')).toBe(false)
    expect(roster.hasAttribute('disabled')).toBe(false)
    expect(live.getAttribute('title')).toBeNull()
    fireEvent.click(live)
    fireEvent.click(roster)
    expect(onNavigate).toHaveBeenCalledWith('live')
    expect(onOpenRoster).toHaveBeenCalledWith('sess-1')
  })
})
