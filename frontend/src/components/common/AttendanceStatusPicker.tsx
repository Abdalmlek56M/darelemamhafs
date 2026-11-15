import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

type AttendanceStatus = 'present' | 'absent' | 'excused'
type Value = AttendanceStatus | ''
type Props = { value: Value; onChange: (value: Value) => void; label: string }
const options: { value: Value; label: string; kind: string }[] = [
  { value: '', label: 'لم يُحدد', kind: 'none' },
  { value: 'present', label: 'حاضر', kind: 'present' },
  { value: 'absent', label: 'غائب', kind: 'absent' },
  { value: 'excused', label: 'غائب بعذر', kind: 'excused' },
]
export default function AttendanceStatusPicker({ value, onChange, label }: Props) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<CSSProperties>({})
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const selected = options.find(option => option.value === value) ?? options[0]
  const updatePosition = useCallback(() => {
    const rect = trigger.current?.getBoundingClientRect()
    if (!rect) return
    const estimatedHeight = Math.min(158, window.innerHeight - 16)
    const openAbove = window.innerHeight - rect.bottom < estimatedHeight + 10 && rect.top > estimatedHeight + 10
    const right = Math.max(8, window.innerWidth - rect.right)
    const top = openAbove ? Math.max(8, rect.top - estimatedHeight - 5) : Math.min(window.innerHeight - estimatedHeight - 8, rect.bottom + 5)
    setPosition({ position: 'fixed', right, top, minWidth: Math.max(rect.width, 150), maxHeight: Math.max(120, window.innerHeight - 16) })
  }, [])
  useLayoutEffect(() => { if (open) updatePosition() }, [open, updatePosition])
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (root.current?.contains(target) || menu.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    const onLayoutChange = () => updatePosition()
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onLayoutChange)
    window.addEventListener('scroll', onLayoutChange, true)
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); window.removeEventListener('resize', onLayoutChange); window.removeEventListener('scroll', onLayoutChange, true) }
  }, [open, updatePosition])
  return <div className="attendance-status-picker" ref={root}>
    <button ref={trigger} type="button" className="attendance-status-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)}>
      <span className="attendance-status-trigger-label"><i className={`attendance-status-dot ${selected.kind}`} aria-hidden="true"/><span>{selected.label}</span></span><ChevronDown size={15}/>
    </button>
    {open && createPortal(<div ref={menu} style={position} className="attendance-status-menu" role="listbox" aria-label={label}>
      {options.map(option => <button key={option.value || 'unset'} type="button" role="option" aria-selected={option.value === value} className="attendance-status-option" onClick={() => { onChange(option.value); setOpen(false); trigger.current?.focus() }}>
        <i className={`attendance-status-dot ${option.kind}`} aria-hidden="true"/><span>{option.label}</span>{option.value === value && <Check size={14}/>}
      </button>)}
    </div>, document.body)}
  </div>
}
