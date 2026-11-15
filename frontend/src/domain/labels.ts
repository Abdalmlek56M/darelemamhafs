import type { StudentStatus, TeacherStatus, CollectionRow } from './types'

export const statusLabels: Record<StudentStatus, string> = { active: 'نشط', paused: 'موقوف إداريًا', withdrawn: 'منسحب', archived: 'مؤرشف' }
export const teacherStatusLabels: Record<TeacherStatus, string> = { active: 'نشطة', inactive: 'غير نشطة', archived: 'مؤرشفة' }
export const payLabels: Record<CollectionRow['paymentStatus'], string> = { 'not-set': 'لم يُحدد', unpaid: 'لم يدفع', partial: 'دفع جزئيًا', paid: 'دافع بالكامل' }
