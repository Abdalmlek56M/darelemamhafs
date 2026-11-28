import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Trash2 } from 'lucide-react'
import type { RoomRole, WhiteboardStroke } from './roomTypes'

type Props = {
  role: RoomRole
  strokes: WhiteboardStroke[]
  onAddStroke: (stroke: WhiteboardStroke) => void
  onClear: () => void
}

const COLORS = ['#38bdf8', '#facc15', '#4ade80', '#f87171', '#ffffff']

export default function RoomWhiteboard({ role, strokes, onAddStroke, onClear }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const draftRef = useRef<number[]>([])
  const [drawing, setDrawing] = useState(false)
  const [color, setColor] = useState(COLORS[0])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const s of strokes) {
      if (s.points.length < 4) continue
      ctx.strokeStyle = s.color
      ctx.lineWidth = s.width
      ctx.beginPath()
      ctx.moveTo(s.points[0], s.points[1])
      for (let i = 2; i < s.points.length; i += 2) {
        ctx.lineTo(s.points[i], s.points[i + 1])
      }
      ctx.stroke()
    }
  }, [strokes])

  const toCanvasPoint = (e: PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * e.currentTarget.width)
    const y = Math.round(((e.clientY - rect.top) / Math.max(1, rect.height)) * e.currentTarget.height)
    return [x, y]
  }

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (role !== 'host') return
    const [x, y] = toCanvasPoint(e)
    draftRef.current = [x, y]
    setDrawing(true)
  }

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing || role !== 'host') return
    const [x, y] = toCanvasPoint(e)
    const pts = draftRef.current
    const prevX = pts[pts.length - 2] ?? x
    const prevY = pts[pts.length - 1] ?? y
    // Throttle points cleanly (~4px distance) to keep LiveKit data packets tiny.
    if (Math.hypot(x - prevX, y - prevY) < 4) return
    pts.push(x, y)
    const ctx = canvasRef.current?.getContext('2d')
    if (ctx) {
      ctx.strokeStyle = color
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.moveTo(prevX, prevY)
      ctx.lineTo(x, y)
      ctx.stroke()
    }
  }

  const finishStroke = () => {
    if (!drawing) return
    setDrawing(false)
    if (draftRef.current.length >= 4) {
      onAddStroke({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        points: draftRef.current,
        color,
        width: 3,
      })
    }
    draftRef.current = []
  }

  return (
    <section className="room-whiteboard-card" aria-label="السبورة المشتركة">
      <div className="room-whiteboard-head">
        <strong>السبورة المشتركة</strong>
        {role === 'host' && (
          <div className="room-wb-tools">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`لون ${c}`}
                className={`room-wb-color ${color === c ? 'active' : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setColor(c)}
              />
            ))}
            <button type="button" className="secondary-button compact-button" onClick={onClear}>
              <Trash2 size={14} /> مسح السبورة
            </button>
          </div>
        )}
      </div>
      <canvas
        ref={canvasRef}
        width={900}
        height={450}
        className="room-whiteboard-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerLeave={finishStroke}
      />
    </section>
  )
}
