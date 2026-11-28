// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MembersPage from './MembersPage'
import type { DarApplicationContext } from '../application/useDarApplication'
import type { AdminUser, Student, Teacher } from '../domain/types'

const mockStudents: Student[] = [
  {
    id: 's-1',
    studentCode: 'ST-001',
    fullName: 'مريم أحمد',
    ageYears: 10,
    phone: '01011111111',
    guardianName: 'أحمد علي',
    guardianPhone: '01022222222',
    joinedOn: '2026-01-01',
    status: 'active',
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    circleNames: 'حلقة الفجر',
    currentMonthDue: 100,
    currentMonthPaid: 100,
    currentMonthPaymentStatus: 'paid',
  },
  {
    id: 's-2',
    studentCode: 'ST-002',
    fullName: 'يوسف أحمد',
    ageYears: 8,
    phone: null,
    guardianName: 'أحمد علي',
    guardianPhone: '01022222222',
    joinedOn: '2026-01-02',
    status: 'active',
    notes: null,
    createdAt: '2026-01-02T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    circleNames: 'حلقة النور',
    currentMonthDue: 100,
    currentMonthPaid: 0,
    currentMonthPaymentStatus: 'unpaid',
  },
]

const mockTeachers: Teacher[] = [
  {
    id: 't-1',
    teacherCode: 'TR-001',
    fullName: 'أ. فاطمة حسن',
    phone: '01033333333',
    hourlyRate: 120,
    status: 'active',
    notes: null,
    circleNames: 'حلقة الفجر',
    circleCount: 1,
  },
]

const mockUsers: AdminUser[] = [
  {
    id: 'u-1',
    username: 'sup_noura',
    displayName: 'نورة المشرفة',
    isActive: true,
    isLocked: false,
    teacherId: null,
    lockReason: null,
    permissionCodes: ['supervisor.portal', 'supervisor.live'],
    scopeCircleIds: [],
    scopeTeacherIds: [],
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 'u-2',
    username: 'admin_only',
    displayName: 'مدير النظام',
    isActive: true,
    isLocked: false,
    teacherId: null,
    lockReason: null,
    permissionCodes: ['users.manage'],
    scopeCircleIds: [],
    scopeTeacherIds: [],
    createdAt: '2026-01-01T00:00:00Z',
  },
]

vi.mock('../services/apiClient', () => ({
  requestPage: vi.fn(async (url: string) => {
    if (url.startsWith('/api/students')) {
      return { data: mockStudents, meta: { page: 1, pageSize: 100, total: 2, truncated: false } }
    }
    if (url.startsWith('/api/teachers')) {
      return { data: mockTeachers, meta: { page: 1, pageSize: 100, total: 1, truncated: false } }
    }
    if (url.startsWith('/api/admin/users')) {
      return { data: mockUsers, meta: { page: 1, pageSize: 100, total: 2, truncated: false } }
    }
    return { data: [], meta: { page: 1, pageSize: 100, total: 0, truncated: false } }
  }),
}))

function createCtx() {
  return {
    has: () => true,
    openHistory: vi.fn(),
    openTeacherDetails: vi.fn(),
    openUserEdit: vi.fn(),
  } as unknown as DarApplicationContext
}

describe('MembersPage unified directory', () => {
  it('lists students, deduplicated guardians, teachers, and supervisors with type filter, search, and profile links', async () => {
    const ctx = createCtx()
    render(<MembersPage ctx={ctx} />)

    await waitFor(() => {
      expect(screen.getAllByText('مريم أحمد').length).toBeGreaterThan(0)
    })

    // 2 students + 1 deduplicated guardian + 1 teacher + 1 supervisor (admin_only excluded) = 5
    expect(screen.getByText('5 عضو')).toBeTruthy()
    expect(screen.getAllByText('أحمد علي').length).toBeGreaterThan(0)
    expect(screen.getAllByText('أ. فاطمة حسن').length).toBeGreaterThan(0)
    expect(screen.getAllByText('نورة المشرفة').length).toBeGreaterThan(0)
    expect(screen.queryByText('مدير النظام')).toBeNull()

    // Filter by supervisor and open profile
    fireEvent.click(screen.getByRole('button', { name: 'المشرفات' }))
    expect(screen.getByText('1 عضو')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'فتح الملف' })[0])
    expect(ctx.openUserEdit).toHaveBeenCalledWith(mockUsers[0])

    // Filter by teacher and open profile
    fireEvent.click(screen.getByRole('button', { name: 'المعلمات' }))
    expect(screen.getByText('1 عضو')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'فتح الملف' })[0])
    expect(ctx.openTeacherDetails).toHaveBeenCalledWith(mockTeachers[0])

    // Filter by all and search
    fireEvent.click(screen.getByRole('button', { name: 'الكل' }))
    fireEvent.change(screen.getByPlaceholderText('ابحث بالاسم أو الكود أو الهاتف…'), { target: { value: 'يوسف' } })
    fireEvent.click(screen.getByRole('button', { name: 'بحث' }))

    await waitFor(() => {
      expect(screen.getAllByText('يوسف أحمد').length).toBeGreaterThan(0)
    })
  })
})
