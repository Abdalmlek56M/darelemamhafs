import { CalendarCheck2, Link2, Video } from 'lucide-react'
import ResponsiveTable from '../../components/common/ResponsiveTable'
import Empty from '../../components/common/EmptyState'
import type { MeetCircleSetting } from '../types'

type Props = {
  circles: MeetCircleSetting[]
  scoped: boolean
  canManage: boolean
  busyId: string | null
  onToggle: (circle: MeetCircleSetting, autoRecord: boolean, autoLink: boolean) => void
}

function Toggle({ checked, disabled, label, onChange }: {
  checked: boolean
  disabled: boolean
  label: string
  onChange: (next: boolean) => void
}) {
  return <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    className={'meet-switch' + (checked ? ' is-on' : '')}
    disabled={disabled}
    onClick={() => onChange(!checked)}
  >
    <span className="meet-switch-thumb" />
  </button>
}

/**
 * The owner's recording scope: only selected circles are recorded automatically.
 * Circle selection is the default; a single occurrence can still be forced or excluded
 * from the events tab (meet_events.recording_mode).
 */
export default function RecordingScopePanel({ circles, scoped, canManage, busyId, onToggle }: Props) {
  const selected = circles.filter((circle) => circle.autoRecord).length

  return <section className="panel glass meet-scope-panel">
    <div className="meet-scope-head">
      <div>
        <h2>نطاق التسجيل — الحلقات المختارة</h2>
        <p>التسجيل التلقائي يعمل فقط للحلقات المفعّلة هنا. الربط التلقائي يربط الحدث بالحلقة عندما يظهر اسمها في عنوان الحدث، دون تجاوز الربط اليدوي.</p>
      </div>
      <div className="meet-scope-count">
        <Video size={15} /> <strong>{selected}</strong> من {circles.length} حلقة
        {scoped && <span className="meet-scope-scope"><CalendarCheck2 size={13} /> ضمن نطاقك</span>}
      </div>
    </div>

    <ResponsiveTable
      rows={circles}
      rowKey={(circle) => circle.circleId}
      caption="نطاق تسجيل الحلقات"
      tableClassName="students-table"
      empty={<Empty icon={<Link2 size={24} />} title="لا توجد حلقات ظاهرة" text="أنشئ حلقات أولًا من صفحة الحلقات، ثم اختَر ما يُسجَّل منها." />}
      columns={[
        {
          key: 'name',
          header: 'الحلقة',
          primary: true,
          render: (circle) => <span className="meet-circle-name">
            {circle.name}
            {!circle.isActive && <span className="status-pill status-archived">موقوفة</span>}
          </span>,
        },
        {
          key: 'upcoming',
          header: 'أحداث مرتبطة قادمة',
          render: (circle) => circle.upcomingLinkedEvents,
        },
        {
          key: 'record',
          header: 'التسجيل التلقائي',
          render: (circle) => <Toggle
            checked={circle.autoRecord}
            disabled={!canManage || busyId === circle.circleId}
            label={`التسجيل التلقائي لحلقة ${circle.name}`}
            onChange={(next) => onToggle(circle, next, circle.autoLink)}
          />,
        },
        {
          key: 'link',
          header: 'الربط التلقائي',
          render: (circle) => <Toggle
            checked={circle.autoLink}
            disabled={!canManage || busyId === circle.circleId}
            label={`الربط التلقائي لحلقة ${circle.name}`}
            onChange={(next) => onToggle(circle, circle.autoRecord, next)}
          />,
        },
      ]}
    />

    <p className="meet-scope-note">
      لا يُحذف أي ملف تسجيل تلقائيًا. بعد انتهاء الحلقة يُرفَع ملف MP4 إلى Google Drive (مقيّد لحساب الدار)، وتبقى مشاهدة الملف من النظام؛
      والحذف يحتاج ضغطتين يدويتين من صفحة التسجيلات.
    </p>
  </section>
}
