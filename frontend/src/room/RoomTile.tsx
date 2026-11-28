import { useEffect, useRef } from 'react'
import { Hand, Mic, MicOff } from 'lucide-react'
import type { Track } from 'livekit-client'
import type { LiveParticipantTile } from './roomTypes'

export function MediaElement({
  track,
  kind,
  fit = 'cover',
}: {
  track: Track
  kind: 'video' | 'audio'
  fit?: 'cover' | 'contain'
}) {
  const ref = useRef<HTMLMediaElement | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    track.attach(el)
    return () => { track.detach(el) }
  }, [track])
  return kind === 'video'
    ? <video ref={(el) => { ref.current = el }} autoPlay playsInline muted style={{ objectFit: fit }} />
    : <audio ref={(el) => { ref.current = el }} autoPlay />
}

type TileProps = {
  tile: LiveParticipantTile
  handRaised: boolean
  compact?: boolean
}

export default function RoomTile({ tile, handRaised, compact = false }: TileProps) {
  return (
    <article className={`room-tile${compact ? ' is-compact' : ''}`}>
      {tile.videoTrack
        ? <MediaElement track={tile.videoTrack} kind="video" />
        : <div className="room-tile-avatar">{tile.name.slice(0, 1)}</div>}
      {tile.audioTrack && <MediaElement track={tile.audioTrack} kind="audio" />}
      <div className="room-tile-footer">
        <span className="room-tile-name">
          {tile.name}{tile.isLocal ? ' (أنت)' : ''}
          {handRaised && <Hand size={13} className="room-hand-icon" aria-label="يد مرفوعة" />}
        </span>
        <span aria-hidden="true">{tile.micEnabled ? <Mic size={14} /> : <MicOff size={14} />}</span>
      </div>
    </article>
  )
}
