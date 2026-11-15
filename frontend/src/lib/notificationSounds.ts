export type NotificationSound = 'bell' | 'chime' | 'gentle' | 'alert' | 'alarm' | 'urgent' | 'classic'
export type NotificationDuration = 10 | 30

export const notificationSoundOptions: { value: NotificationSound; label: string; description: string }[] = [
  { value: 'bell', label: 'جرس هادئ', description: 'نغمتان واضحتان من غير إزعاج' },
  { value: 'chime', label: 'رنين متتابع', description: 'ثلاث نغمات قصيرة' },
  { value: 'gentle', label: 'تنبيه ناعم', description: 'صوت منخفض وهادئ' },
  { value: 'alert', label: 'تنبيه مميز', description: 'نغمتان متكررتان ثم نغمة أعلى' },
  { value: 'alarm', label: 'منبه واضح', description: 'صفارات مرتفعة ومتقطعة للتنبيه' },
  { value: 'urgent', label: 'تنبيه قوي متناوب', description: 'نغمتان عاليتان بالتبادل' },
  { value: 'classic', label: 'منبه تقليدي', description: 'صفارتان متبادلتان بإيقاع واضح ومتكرر' },
]
export const notificationDurationOptions: { value: NotificationDuration; label: string }[] = [
  { value: 10, label: '10 ثوانٍ' },
  { value: 30, label: '30 ثانية' },
]

const storageKey = 'dar-notification-sound'
const durationStorageKey = 'dar-notification-duration'
let audioContext: AudioContext | null = null
let activeOscillators: OscillatorNode[] = []

export function stopNotificationSound() {
  for (const oscillator of activeOscillators) {
    try { oscillator.stop() } catch { /* The tone may have already finished. */ }
  }
  activeOscillators = []
}

export function readNotificationSound(): NotificationSound {
  try {
    const saved = localStorage.getItem(storageKey)
    return notificationSoundOptions.some(option => option.value === saved) ? saved as NotificationSound : 'bell'
  } catch { return 'bell' }
}
export function saveNotificationSound(sound: NotificationSound) {
  try { localStorage.setItem(storageKey, sound) } catch { /* Keep current-session preference if storage is unavailable. */ }
}
export function readNotificationDuration(): NotificationDuration {
  try { return localStorage.getItem(durationStorageKey) === '30' ? 30 : 10 } catch { return 10 }
}
export function saveNotificationDuration(duration: NotificationDuration) {
  try { localStorage.setItem(durationStorageKey, String(duration)) } catch { /* Keep current-session preference if storage is unavailable. */ }
}

/** Generate local tones offline. Alerts repeat for the requested number of seconds. */
export function playNotificationSound(sound: NotificationSound = readNotificationSound(), repeatDurationSeconds = 1): boolean {
  try {
    stopNotificationSound()
    const AudioContextType = window.AudioContext
    if (!AudioContextType) return false
    if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContextType()
    const context = audioContext
    if (context.state === 'suspended') void context.resume().catch(() => undefined)

    const patterns: Record<NotificationSound, { frequency: number; start: number; duration: number; wave: OscillatorType; gain: number }[]> = {
      bell: [
        { frequency: 880, start: 0, duration: 0.27, wave: 'sine', gain: 0.12 },
        { frequency: 660, start: 0.22, duration: 0.32, wave: 'sine', gain: 0.105 },
      ],
      chime: [
        { frequency: 659, start: 0, duration: 0.2, wave: 'sine', gain: 0.085 },
        { frequency: 784, start: 0.17, duration: 0.2, wave: 'sine', gain: 0.09 },
        { frequency: 1046, start: 0.34, duration: 0.34, wave: 'sine', gain: 0.105 },
      ],
      gentle: [
        { frequency: 523, start: 0, duration: 0.32, wave: 'triangle', gain: 0.075 },
        { frequency: 587, start: 0.3, duration: 0.36, wave: 'triangle', gain: 0.07 },
      ],
      alert: [
        { frequency: 880, start: 0, duration: 0.14, wave: 'triangle', gain: 0.13 },
        { frequency: 880, start: 0.22, duration: 0.14, wave: 'triangle', gain: 0.13 },
        { frequency: 1174, start: 0.47, duration: 0.3, wave: 'sine', gain: 0.14 },
      ],
      alarm: [
        { frequency: 1046, start: 0, duration: 0.28, wave: 'square', gain: 0.16 },
        { frequency: 1396, start: 0.34, duration: 0.28, wave: 'square', gain: 0.16 },
      ],
      urgent: [
        { frequency: 880, start: 0, duration: 0.19, wave: 'sawtooth', gain: 0.13 },
        { frequency: 660, start: 0.24, duration: 0.19, wave: 'sawtooth', gain: 0.13 },
        { frequency: 880, start: 0.49, duration: 0.19, wave: 'sawtooth', gain: 0.13 },
      ],
      classic: [
        { frequency: 880, start: 0, duration: 0.24, wave: 'square', gain: 0.15 },
        { frequency: 660, start: 0.28, duration: 0.24, wave: 'square', gain: 0.15 },
        { frequency: 880, start: 0.62, duration: 0.24, wave: 'square', gain: 0.15 },
        { frequency: 660, start: 0.90, duration: 0.24, wave: 'square', gain: 0.15 },
      ],
    }

    const selectedPattern = patterns[sound] ?? patterns.bell
    const cycle = Math.max(...selectedPattern.map(tone => tone.start + tone.duration)) + 0.20
    const totalDuration = Math.max(0.7, Math.min(30, Number(repeatDurationSeconds) || 1))
    const now = context.currentTime + 0.035
    for (let offset = 0; offset < totalDuration; offset += cycle) {
      for (const tone of selectedPattern) {
        const relativeStart = offset + tone.start
        if (relativeStart >= totalDuration) continue
        const toneDuration = Math.min(tone.duration, totalDuration - relativeStart)
        if (toneDuration < 0.025) continue
        const oscillator = context.createOscillator()
        const envelope = context.createGain()
        const start = now + relativeStart
        const end = start + toneDuration
        oscillator.type = tone.wave
        oscillator.frequency.setValueAtTime(tone.frequency, start)
        envelope.gain.setValueAtTime(0.0001, start)
        envelope.gain.exponentialRampToValueAtTime(tone.gain, start + Math.min(0.018, toneDuration / 3))
        envelope.gain.exponentialRampToValueAtTime(0.0001, end)
        oscillator.connect(envelope)
        envelope.connect(context.destination)
        activeOscillators.push(oscillator)
        oscillator.onended = () => { activeOscillators = activeOscillators.filter(active => active !== oscillator) }
        oscillator.start(start)
        oscillator.stop(end + 0.02)
      }
    }
    return true
  } catch { return false }
}
