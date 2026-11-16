import { useCallback, useEffect, useRef, useState } from 'react'
import type { Gate, Notice, ScheduleSlot } from '../domain/types'
import { localDateString, remainingLabel, sessionDateTime } from '../lib/dates'
import {
  playNotificationSound,
  readNotificationSound,
  saveNotificationSound,
  readNotificationDuration,
  saveNotificationDuration,
  stopNotificationSound as stopNotificationAudio,
  type NotificationSound,
  type NotificationDuration,
} from '../lib/notificationSounds'

type ScheduleNotificationsOptions = {
  gate: Gate
  scheduleSlots: ScheduleSlot[]
  setToast: (notice: Notice) => void
}

/**
 * Owns the local clock, class-reminder preferences, and the once-per-session
 * alert dispatcher for schedule slots. Preferences stay on the device; nothing
 * here is persisted to the API.
 */
export default function useScheduleNotifications({ gate, scheduleSlots, setToast }: ScheduleNotificationsOptions) {
  const [clockNow, setClockNow] = useState(Date.now())
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() =>
    typeof Notification === 'undefined' ? 'denied' : Notification.permission,
  )
  const [scheduleNotificationsEnabled, setScheduleNotificationsEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem('dar-schedule-notifications-enabled') !== 'false' } catch { return true }
  })
  const [notificationSound, setNotificationSound] = useState<NotificationSound>(() => readNotificationSound())
  const [notificationDuration, setNotificationDuration] = useState<NotificationDuration>(() => readNotificationDuration())
  const [disabledScheduleAlerts, setDisabledScheduleAlerts] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem('dar-disabled-class-alerts') || '[]')
      return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
    } catch { return [] }
  })
  const firedClassAlertsRef = useRef<Set<string>>(new Set())

  useEffect(() => { saveNotificationSound(notificationSound) }, [notificationSound])
  useEffect(() => { saveNotificationDuration(notificationDuration) }, [notificationDuration])
  useEffect(() => {
    try { localStorage.setItem('dar-schedule-notifications-enabled', String(scheduleNotificationsEnabled)) } catch { /* Local reminder toggle is a device preference. */ }
  }, [scheduleNotificationsEnabled])
  useEffect(() => {
    try { localStorage.setItem('dar-disabled-class-alerts', JSON.stringify(disabledScheduleAlerts)) } catch { /* Alert preferences are local-only convenience settings. */ }
  }, [disabledScheduleAlerts])

  const isScheduleAlertEnabled = useCallback(
    (slotId: string) => !disabledScheduleAlerts.includes(slotId),
    [disabledScheduleAlerts],
  )
  const setScheduleAlertEnabled = useCallback((slotId: string, enabled: boolean) => {
    setDisabledScheduleAlerts(current =>
      enabled ? current.filter(id => id !== slotId) : (current.includes(slotId) ? current : [...current, slotId]),
    )
  }, [])
  const previewNotificationSound = useCallback(() => {
    const played = playNotificationSound(notificationSound, notificationDuration)
    setToast({
      tone: played ? 'success' : 'info',
      text: played
        ? `تم تشغيل عينة الصوت لمدة ${notificationDuration} ${notificationDuration === 10 ? 'ثوانٍ' : 'ثانية'}.`
        : 'تعذر تشغيل الصوت. جرّب الضغط على زر المعاينة مرة أخرى وتأكد من مستوى الصوت.',
    })
  }, [notificationSound, notificationDuration, setToast])
  const stopNotificationAudioNow = useCallback(() => { stopNotificationAudio() }, [])

  const enableNotifications = useCallback(async () => {
    if (typeof Notification === 'undefined') {
      setToast({ tone: 'error', text: 'هذا المتصفح لا يدعم إشعارات النظام.' })
      return
    }
    try {
      const permission = await Notification.requestPermission()
      setNotificationPermission(permission)
      setToast({
        tone: permission === 'granted' ? 'success' : 'info',
        text: permission === 'granted'
          ? 'تم السماح بإشعارات النظام. يمكنك إيقاف تذكيرات المواعيد من هذا الزر.'
          : 'لم يتم السماح بإشعارات النظام؛ يمكنك إبقاء التنبيهات داخل التطبيق.',
      })
    } catch {
      setToast({ tone: 'error', text: 'تعذر تفعيل الإشعارات من المتصفح.' })
    }
  }, [setToast])

  const toggleScheduleNotifications = useCallback(async () => {
    if (scheduleNotificationsEnabled) {
      setScheduleNotificationsEnabled(false)
      stopNotificationAudio()
      setToast({ tone: 'info', text: 'تم إيقاف تنبيهات مواعيد الحلقات على هذا الجهاز.' })
      return
    }
    setScheduleNotificationsEnabled(true)
    if (notificationPermission !== 'granted') await enableNotifications()
    else setToast({ tone: 'success', text: 'تم تفعيل تنبيهات مواعيد الحلقات.' })
  }, [scheduleNotificationsEnabled, notificationPermission, enableNotifications, setToast])

  // Update the visible countdown every 30 seconds; second-by-second React renders add work without helping this admin dashboard.
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (gate !== 'ready' || !scheduleSlots.length || !scheduleNotificationsEnabled) return
    const date = localDateString()
    const day = new Date(clockNow).getDay()
    const fireAlert = (title: string, body: string, key: string) => {
      if (firedClassAlertsRef.current.has(key)) return
      try { if (localStorage.getItem(key)) return } catch { /* Fall back to the in-memory key set. */ }
      firedClassAlertsRef.current.add(key)
      try { localStorage.setItem(key, '1') } catch { /* The in-memory key set prevents repeat alerts this session. */ }
      let deliveredAsSystemNotification = false
      if (notificationPermission === 'granted' && typeof Notification !== 'undefined') {
        try { new Notification(title, { body, tag: key }); deliveredAsSystemNotification = true } catch { /* Fall back to the in-app notice. */ }
      }
      if (!deliveredAsSystemNotification) setToast({ tone: 'info', text: `${title} · ${body}` })
      playNotificationSound(notificationSound, notificationDuration)
    }
    for (const slot of scheduleSlots) {
      // Inactive slots are kept for historical attendance; they must not keep firing reminders.
      if (!slot.isActive || !isScheduleAlertEnabled(slot.id) || slot.dayOfWeek !== day) continue
      const target = sessionDateTime(date, slot.startsAt).getTime()
      const minutesRemaining = target - clockNow
      const reminderKey = `dar-class-reminder10:${slot.id}:${date}`
      if (minutesRemaining > 0 && minutesRemaining <= 10 * 60 * 1000) {
        fireAlert(
          `موعد قريب: ${slot.circleName}`,
          `متبقي ${remainingLabel(minutesRemaining)} · المعلمة: ${slot.teacherName || 'لم تحدد'} · مدة الحلقة ${slot.durationMinutes} دقيقة`,
          reminderKey,
        )
      }
      const startedKey = `dar-class-started:${slot.id}:${date}`
      if (minutesRemaining <= 0 && minutesRemaining >= -60_000) {
        fireAlert(
          `حان موعد الحلقة: ${slot.circleName}`,
          `${slot.teacherName || 'لم تحدد معلمة'} · مدة الحلقة ${slot.durationMinutes} دقيقة`,
          startedKey,
        )
      }
    }
  }, [clockNow, gate, scheduleNotificationsEnabled, notificationPermission, scheduleSlots, isScheduleAlertEnabled, notificationSound, notificationDuration, setToast])

  return {
    clockNow,
    setClockNow,
    notificationPermission,
    setNotificationPermission,
    scheduleNotificationsEnabled,
    toggleScheduleNotifications,
    notificationSound,
    setNotificationSound,
    notificationDuration,
    setNotificationDuration,
    previewNotificationSound,
    stopNotificationAudio: stopNotificationAudioNow,
    isScheduleAlertEnabled,
    setScheduleAlertEnabled,
    enableNotifications,
  }
}
