import { BookOpen, Clock3, GraduationCap } from 'lucide-react'
import { weekDays } from '../domain/defaults'
import type { ScheduleSlot } from '../domain/types'
import { formatTime12 } from '../lib/dates'

type Props = {
  slots: ScheduleSlot[]
}

export default function WeeklyScheduleView({ slots }: Props) {
  const activeSlots = slots.filter((slot) => slot.isActive && slot.circleIsActive !== false)

  return (
    <div className="panel glass weekly-schedule-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">الجدول الأسبوعي</span>
          <h3>عرض الأسبوع للحلقات والحصص</h3>
        </div>
        <span className="data-note">{activeSlots.length} حصة أسبوعية نشطة</span>
      </div>
      <div className="weekly-schedule-grid" role="region" aria-label="الجدول الأسبوعي للحلقات">
        {weekDays.map((dayName, dayIndex) => {
          const daySlots = activeSlots
            .filter((slot) => slot.dayOfWeek === dayIndex)
            .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.circleName.localeCompare(b.circleName, 'ar'))
          return (
            <section className="weekly-day-col" key={dayName} aria-label={dayName}>
              <header className="weekly-day-head">
                <strong>{dayName}</strong>
                <span>{daySlots.length}</span>
              </header>
              <div className="weekly-day-slots">
                {daySlots.length === 0 ? (
                  <p className="muted-text weekly-day-empty">لا توجد حصص</p>
                ) : (
                  daySlots.map((slot) => (
                    <article className="weekly-slot-card" key={slot.id}>
                      <strong><BookOpen size={13} /> {slot.circleName}</strong>
                      <small><GraduationCap size={13} /> {slot.teacherName || 'لم تحدد معلمة'}</small>
                      <small><Clock3 size={13} /> {formatTime12(slot.startsAt)} · {slot.durationMinutes} د</small>
                    </article>
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
