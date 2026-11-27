import { describe, expectTypeOf, it } from 'vitest'
import type {
  Page, TeacherSession, TodayResponse, Slot, RosterResponse, AttendanceMark, EarningsResponse,
  NotificationsResponse, SubscriptionsResponse, TeacherCalendarResponse, TeacherHistoryResponse,
} from './teacherTypes'

// Z1 characterization: the exported type contracts stay identical after splitting the file.
describe('teacherTypes characterization (Z1)', () => {
  it('keeps the core object contracts', () => {
    expectTypeOf<Page>().toEqualTypeOf<'home' | 'live' | 'roster' | 'notifications' | 'supervisor' | 'subscriptions' | 'account' | 'requests' | 'calendar' | 'history'>()
    expectTypeOf<TeacherSession>().toHaveProperty('permissionCodes')
    expectTypeOf<TeacherSession['teacherId']>().toEqualTypeOf<string | null>()
    expectTypeOf<Slot>().toHaveProperty('canStart')
    expectTypeOf<TodayResponse>().toHaveProperty('teacher')
    expectTypeOf<RosterResponse>().toBeObject()
    expectTypeOf<AttendanceMark>().toHaveProperty('status')
    expectTypeOf<EarningsResponse>().toBeObject()
    expectTypeOf<NotificationsResponse>().toBeObject()
    expectTypeOf<SubscriptionsResponse>().toBeObject()
    expectTypeOf<TeacherCalendarResponse>().toBeObject()
    expectTypeOf<TeacherHistoryResponse>().toBeObject()
  })
})
