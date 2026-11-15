import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { BellRing, CheckCircle2, Database, ImagePlus, MonitorCog, Play, RefreshCw, UserRound, VolumeX } from 'lucide-react'
import SystemAdminView from '../SystemAdminView'
import type { DarApplicationContext } from '../application/useDarApplication'
import { notificationSoundOptions, notificationDurationOptions, type NotificationSound, type NotificationDuration } from '../lib/notificationSounds'
import { getDesktopAutoStartState, setDesktopAutoStartState, type DesktopAutoStartState } from '../services/desktopPreferencesBridge'
import { openDesktopConnectionSettings } from '../services/desktopConnectionBridge'


type Props = { ctx: DarApplicationContext }

export default function SystemPage({ ctx }: Props) {
  const session = ctx.session
  const [autoStart, setAutoStart] = useState<DesktopAutoStartState>({ available: false, enabled: false })
  const [autoStartLoading, setAutoStartLoading] = useState(true)
  const [autoStartSaving, setAutoStartSaving] = useState(false)
  const [connectionOpening, setConnectionOpening] = useState(false)

  useEffect(() => {
    let mounted = true
    void getDesktopAutoStartState().then(result => {
      if (!mounted) return
      setAutoStart(result)
      setAutoStartLoading(false)
    }).catch(() => {
      if (!mounted) return
      setAutoStart({ available: false, enabled: false, error: 'تعذر قراءة إعداد بدء التشغيل على هذا الجهاز.' })
      setAutoStartLoading(false)
    })
    return () => { mounted = false }
  }, [])

  if (!session) return null

  const toggleAutoStart = async () => {
    if (!autoStart.available || autoStartLoading || autoStartSaving) return
    const nextValue = !autoStart.enabled
    if (nextValue && !window.confirm('عند تسجيل الدخول إلى Windows سيحاول التطبيق تشغيل قاعدة البيانات والخادم المحلي ثم فتح لوحة الدار. يجب إبقاء مجلد البرنامج في مكانه، ويتم تشغيل قاعدة البيانات المحلية تلقائيًا دون Docker. هل تفعّل التشغيل التلقائي؟')) return
    setAutoStartSaving(true)
    try {
      const result = await setDesktopAutoStartState(nextValue)
      setAutoStart(result)
      if (result.error) ctx.notifySystem('error', result.error)
      else ctx.notifySystem('success', nextValue ? 'تم تفعيل بدء تشغيل الدار مع Windows.' : 'تم إيقاف بدء التشغيل التلقائي.')
    } finally { setAutoStartSaving(false) }
  }

  const openConnectionSettings = async () => {
    if (connectionOpening) return
    setConnectionOpening(true)
    try {
      const result = await openDesktopConnectionSettings()
      if (!result.available) ctx.notifySystem('error', result.error || 'تعذر فتح إعداد الاتصال.')
      else ctx.notifySystem('success', 'تم فتح نافذة إعداد الاتصال. إذا حفظت عنوانًا جديدًا سيعيد التطبيق فتح العنوان المحدد.')
    } finally { setConnectionOpening(false) }
  }

  return <motion.section key="system" className="students-page" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}}>
    <section className="desktop-preferences-panel glass">
      <div className="system-panel-heading"><div><span className="eyebrow">إعدادات هذا الجهاز</span><h3>تفضيلات التطبيق والتنبيهات</h3><p>تُحفظ هذه الخيارات محليًا على الجهاز، ولا تحتاج إلى حساب سحابي أو خدمة خارجية.</p></div><span className="system-heading-icon"><MonitorCog size={20}/></span></div>
      <div className="desktop-preferences-grid">
        <div className="desktop-preference-item">
          <div className="desktop-preference-copy"><strong><MonitorCog size={16}/> بدء التطبيق مع Windows</strong><p>تشغيل الدار تلقائيًا عند تسجيل الدخول لحساب Windows الحالي.</p><small>{autoStart.available ? (autoStart.enabled ? 'الحالة الحالية: مفعّل' : 'الحالة الحالية: غير مفعّل') : (autoStart.error || 'يتوفر هذا الخيار داخل نسخة Windows Desktop فقط.')}</small></div>
          <button type="button" className={autoStart.enabled ? 'secondary-button desktop-setting-action is-enabled' : 'secondary-button desktop-setting-action'} disabled={!autoStart.available || autoStartLoading || autoStartSaving} onClick={() => void toggleAutoStart()}>{autoStartSaving ? 'جارٍ الحفظ…' : autoStart.enabled ? 'إيقاف التشغيل التلقائي' : 'تفعيل التشغيل التلقائي'}</button>
        </div>
        <div className="desktop-preference-item">
          <div className="desktop-preference-copy"><strong><BellRing size={16}/> صوت تنبيهات الحلقات والتذكيرات</strong><p>اختر نغمة ومدة الرنين. التنبيه يكرر الصوت للمدة المختارة ثم يتوقف تلقائيًا.</p><small>الصوت مولّد محليًا دون ملفات خارجية. زر التجربة يشغّل عينة قصيرة فقط.</small></div>
          <div className="desktop-sound-controls desktop-sound-controls-stacked"><label className="form-field"><span>نغمة التنبيه</span><select value={ctx.notificationSound} onChange={event => ctx.setNotificationSound(event.target.value as NotificationSound)}>{notificationSoundOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{notificationSoundOptions.find(option => option.value === ctx.notificationSound)?.description}</small></label><label className="form-field"><span>مدة تكرار الرنين</span><select value={ctx.notificationDuration} onChange={event => ctx.setNotificationDuration(Number(event.target.value) as NotificationDuration)}>{notificationDurationOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button type="button" className="secondary-button desktop-setting-action" onClick={ctx.previewNotificationSound}><Play size={14}/> تجربة الصوت</button><button type="button" className="secondary-button desktop-setting-action" onClick={ctx.stopNotificationAudio}><VolumeX size={14}/> إيقاف الصوت</button></div>
        </div>
        <div className="desktop-preference-item account-settings-item">
          <div className="desktop-preference-copy"><strong><UserRound size={16}/> الحساب الحالي</strong><p>بيانات الحساب وصورته الشخصية. تغيير الصورة من هنا بدلًا من الشريط العلوي.</p></div>
          <div className="account-settings-profile"><span className="account-settings-avatar">{ctx.avatarAvailable&&<img src={`/api/auth/profile/avatar?v=${ctx.avatarVersion}`} alt="" onError={()=>ctx.setAvatarAvailable(false)} onLoad={()=>ctx.setAvatarAvailable(true)}/>} {!ctx.avatarAvailable&&session.displayName.slice(0,1)}</span><div><strong>{session.displayName}</strong><small>@{session.username}</small></div></div>
          <input ref={ctx.avatarInputRef} className="visually-hidden-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={ctx.uploadAvatar}/>
          <button type="button" className="secondary-button desktop-setting-action" onClick={()=>ctx.avatarInputRef.current?.click()}><ImagePlus size={15}/> تغيير صورة الحساب</button>
        </div>
        <div className="desktop-preference-item">
          <div className="desktop-preference-copy"><strong><Database size={16}/> اتصال قاعدة البيانات</strong><p>حالة الاتصال المحلي بخادم الدار وقاعدة البيانات. أدوات الاتصال المتقدمة موجودة هنا في الإعدادات.</p><small className={`connection-state-label ${ctx.health==='connected'?'is-connected':ctx.health==='checking'?'is-checking':'is-down'}`}>{ctx.health==='connected'?'قاعدة البيانات متصلة':ctx.health==='checking'?'جارٍ فحص الاتصال':'الاتصال غير متاح'}</small></div>
          <div className="desktop-connection-actions"><button type="button" className="secondary-button desktop-setting-action" onClick={()=>void ctx.checkHealth()}><RefreshCw size={14}/> فحص الاتصال</button>{ctx.has('settings.manage')&&<button type="button" className="secondary-button desktop-setting-action" disabled={connectionOpening} onClick={()=>void openConnectionSettings()}>{connectionOpening?'جارٍ الفتح…':'إعداد الاتصال'}</button>}</div>
        </div>
      </div>
      <div className="desktop-preferences-note"><CheckCircle2 size={15}/><span>التطبيق والبيانات محليان على جهازك. تعمل قاعدة PostgreSQL محليًا داخل مجلد بيانات مستقل، ولا تحتاج إلى Docker أو Hosting أو اتصال بالإنترنت بعد اكتمال التجهيز الأول.</span></div>
    </section>
    <SystemAdminView permissions={session.permissionCodes} branding={ctx.branding} onBrandingSaved={ctx.saveBranding} notify={ctx.notifySystem} reportData={{ circles: ctx.circles, teachers: ctx.teachers, students: ctx.students, currentMonth: ctx.currentMonthValue }}/>
  </motion.section>
}
