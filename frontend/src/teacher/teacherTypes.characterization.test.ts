import { describe, expectTypeOf, it } from 'vitest'
import type {
  Page, TeacherSession, TodayResponse, Slot, RosterResponse, AttendanceMark, EarningsResponse,
  NotificationsResponse, SubscriptionsResponse,
} from './teacherTypes'
import type { TeacherCalendarResponse, TeacherHistoryResponse } from './teacherCalendarTypes'

// Z1 characterization: the exported type contracts stay identical after splitting the file.
describe('teacherTypes characterization (Z1)', () => {
  it('keeps the core object contracts', () => {
    expectTypeOf<Page>().toEqualTypeOf<'home' | 'live' | 'roster' | 'notifications' | 'supervisor' | 'subscriptions' | 'account' | 'requests' | 'calendar' | 'history'>()
    expectTypeOf<TeacherSession>().toHaveProperty('permissionCodes')
    expectTypeOf<TeacherSession['teacherId']>().toEqualTypeOf<string | null>()
    expectTypeOf<Slot>().toHaveProperty('canStart')
    expectTypeOf<TodayResponse>().toHaveProperty('teacher')
    expectTypeOf<RosterResponse>().toHaveProperty('students')
    expectTypeOf<AttendanceMark>().toHaveProperty('status')
    expectTypeOf<EarningsResponse>().toHaveProperty('sessions')
    expectTypeOf<NotificationsResponse>().toHaveProperty('notifications')
    expectTypeOf<SubscriptionsResponse>().toHaveProperty('students')
    expectTypeOf<TeacherCalendarResponse>().toHaveProperty('days')
    expectTypeOf<TeacherHistoryResponse>().toHaveProperty('sessions')
  })
})
