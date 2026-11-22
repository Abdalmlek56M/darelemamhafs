import { CalendarDays, ExternalLink, Link2, Search, Unlink, Video } from 'lucide-react'
import ResponsiveTable from '../../components/common/ResponsiveTable'
import Empty from '../../components/common/EmptyState'
import { cairoDateTime, cairoTime, eventBadgeClass, eventStatusLabel, filterLabels, recordingLabel } from '../format'
import type { MeetEvent, MeetFilter, MeetRecordingMode } from '../types'

type Props = {
  events: MeetEvent[]
  total: number
  page: number
  pageSize: number
  filter: MeetFilter
  search: string
  from: string
  to: string
  loading: boolean
  canManage: boolean
  busyId: string | null
  onFilter: (filter: MeetFilter) => void
  onSearch: (value: string) => void
  onFrom: (value: string) => void
  onTo: (value: string) => void
  onPage: (page: number) => void
  onLink: (event: MeetEvent) => void
  onUnlink: (event: MeetEvent) => void
  onMode: (event: MeetEvent, mode: MeetRecordingMode) => void
}

const filters: MeetFilter[] = ['all', 'linked', 'unlinked', 'recording', 'cancelled']

export default function CalendarEventsPanel(props: Props) {
  const {
    events, total, page, pageSize, filter, search, from, to, loading, canManage, busyId,
    onFilter, onSearch, onFrom, onTo, onPage, onLink, onUnlink, onMode,
  } = props
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  return <section className="panel glass meet-events-panel">
    <div className="meet-filters">
      <div className="meet-filter-group" role="group" aria-label="تصفية الأحداث">
        {filters.map((item) => <button
          key={item}
          type="button"
          className={'meet-filter' + (filter === item ? ' is-active' : '')}
          aria-pressed={filter === item}
          onClick={() => onFilter(item)}
        >{filterLabels[item]}</button>)}
      </div>
      <div className="meet-filter-dates">
        <label>من <input type="date" value={from} onChange={(event) => onFrom(event.target.value)} /></label>
        <label>إلى <input type="date" value={to} onChange={(event) => onTo(event.target.value)} /></label>
      </div>
      <label className="meet-search">
        <Search size={15} />
        <input type="search" placeholder="ابحث في عنوان الحدث" value={search} onChange={(event) => onSearch(event.target.value)} />
      </label>
    </div>

    <ResponsiveTable
      rows={events}
      rowKey={(event) => event.id}
      caption="أحداث تقويم Google"
      loading={loading}
      tableClassName="students-table wide-table"
      empty={<Empty icon={<CalendarDays size={24} />} title="لا توجد أحداث في هذا النطاق" text="وسّع مدى التاريخ أو شغّل مزامنة كاملة، أو تأكد أن الأحداث في تقويم حساب الدار." />}
      columns={[
        {
          key: 'summary',
          header: 'الحدث',
          primary: true,
          render: (event) => <div className="meet-event-cell">
            <strong>{event.summary ?? 'حدث بدون عنوان'}</strong>
            <span className="meet-event-meta">
              <span className={eventBadgeClass(event)}>{eventStatusLabel(event)}</span>
              {event.isRecurring && <span className="status-pill status-archived">متكرر</span>}
              {event.meetLink
                ? <a className="text-link" href={event.meetLink} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Meet</a>
                : <span className="meet-muted">بلا رابط Meet</span>}
            </span>
          </div>,
        },
        {
          key: 'time',
          header: 'الموعد',
          render: (event) => <div className="meet-time-cell">
            <span>{cairoDateTime(event.startsAt)}</span>
            <small className="meet-muted">حتى {cairoTime(event.endsAt)}</small>
          </div>,
        },
        {
          key: 'circle',
          header: 'الحلقة',
          render: (event) => {
            if (event.circleId) return <div className="meet-circle-cell">
              <strong>{event.circleName}</strong>
              {event.linkedAutomatically && <small className="meet-muted">ربط تلقائي</small>}
            </div>
            if (event.suggestedCircleId && canManage) return <button type="button" className="meet-suggestion" onClick={() => onLink(event)}>
              <Link2 size={13} /> اقتراح: {event.suggestedCircleName} ({event.suggestedConfidence}%)
            </button>
            return <span className="meet-muted">غير مرتبطة</span>
          },
        },
        {
          key: 'recording',
          header: 'التسجيل',
          render: (event) => <div className="meet-recording-cell">
            <span className={event.recordingEligible ? 'status-pill status-active' : 'status-pill status-archived'}>
              {recordingLabel(event)}
            </span>
            {canManage && <select
              aria-label="قاعدة التسجيل لهذا الحدث"
              value={event.recordingMode}
              disabled={busyId === event.id}
              onChange={(changeEvent) => onMode(event, changeEvent.target.value as MeetRecordingMode)}
            >
              <option value="inherit">حسب الحلقة</option>
              <option value="force">تسجيل دائمًا</option>
              <option value="exclude">عدم التسجيل</option>
            </select>}
          </div>,
        },
      ]}
      actions={canManage ? (event) => <>
        <button type="button" className="secondary-button" onClick={() => onLink(event)} disabled={busyId === event.id}>
          <Video size={15} /> {event.circleId ? 'تغيير الربط' : 'ربط بحلقة'}
        </button>
        {event.circleId && <button type="button" className="small-icon-button" title="فك الربط" onClick={() => onUnlink(event)} disabled={busyId === event.id}>
          <Unlink size={15} />
        </button>}
      </> : undefined}
    />

    <div className="meet-pagination">
      <span className="meet-muted">{total} حدث · صفحة {page} من {pageCount}</span>
      <div className="meet-pagination-buttons">
        <button type="button" className="secondary-button" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>السابق</button>
        <button type="button" className="secondary-button" disabled={page >= pageCount || loading} onClick={() => onPage(page + 1)}>التالي</button>
      </div>
    </div>
  </section>
}
