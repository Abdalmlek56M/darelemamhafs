import { motion } from 'framer-motion'
import { BellRing, ImagePlus, MonitorCog, Play, UserRound, VolumeX } from 'lucide-react'
import SystemAdminView from '../SystemAdminView'
import type { DarApplicationContext } from '../application/useDarApplication'
import { notificationSoundOptions, notificationDurationOptions, type NotificationSound, type NotificationDuration } from '../lib/notificationSounds'

type Props = { ctx: DarApplicationContext }

export default function SystemPage({ ctx }: Props) {
  const session = ctx.session
  if (!session) return null

  return <motion.section key="system" className="students-page" initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-5}}>
    <section className="desktop-preferences-panel glass">
      <div className="system-panel-heading"><div><span className="eyebrow">التنبيهات والحساب</span><h3>تفضيلات التنبيهات والحساب</h3><p>نغمة التنبيهات وصورة الحساب. تُحفظ تفضيلات الصوت على هذا الجهاز.</p></div><span className="system-heading-icon"><MonitorCog size={20}/></span></div>
      <div className="desktop-preferences-grid">
        <div className="desktop-preference-item">
          <div className="desktop-preference-copy"><strong><BellRing size={16}/> صوت التنبيهات</strong><p>اختر نغمة ومدة الرنين. التنبيه يكرر الصوت للمدة المختارة ثم يتوقف تلقائيًا.</p><small>الصوت مولّد محليًا دون ملفات خارجية. زر التجربة يشغّل عينة قصيرة فقط.</small></div>
          <div className="desktop-sound-controls desktop-sound-controls-stacked"><label className="form-field"><span>نغمة التنبيه</span><select value={ctx.notificationSound} onChange={event => ctx.setNotificationSound(event.target.value as NotificationSound)}>{notificationSoundOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>{notificationSoundOptions.find(option => option.value === ctx.notificationSound)?.description}</small></label><label className="form-field"><span>مدة تكرار الرنين</span><select value={ctx.notificationDuration} onChange={event => ctx.setNotificationDuration(Number(event.target.value) as NotificationDuration)}>{notificationDurationOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><button type="button" className="secondary-button desktop-setting-action" onClick={ctx.previewNotificationSound}><Play size={14}/> تجربة الصوت</button><button type="button" className="secondary-button desktop-setting-action" onClick={ctx.stopNotificationAudio}><VolumeX size={14}/> إيقاف الصوت</button></div>
        </div>
        <div className="desktop-preference-item account-settings-item">
          <div className="desktop-preference-copy"><strong><UserRound size={16}/> الحساب الحالي</strong><p>بيانات الحساب وصورته الشخصية.</p></div>
          <div className="account-settings-profile"><span className="account-settings-avatar">{ctx.avatarAvailable&&<img src={`/api/auth/profile/avatar?v=${ctx.avatarVersion}`} alt="" onError={()=>ctx.setAvatarAvailable(false)} onLoad={()=>ctx.setAvatarAvailable(true)}/>} {!ctx.avatarAvailable&&session.displayName.slice(0,1)}</span><div><strong>{session.displayName}</strong><small>@{session.username}</small></div></div>
          <input ref={ctx.avatarInputRef} className="visually-hidden-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={ctx.uploadAvatar}/>
          <button type="button" className="secondary-button desktop-setting-action" onClick={()=>ctx.avatarInputRef.current?.click()}><ImagePlus size={15}/> تغيير صورة الحساب</button>
        </div>
      </div>
    </section>
    <SystemAdminView permissions={session.permissionCodes} branding={ctx.branding} onBrandingSaved={ctx.saveBranding} notify={ctx.notifySystem} reportData={{ circles: ctx.circles, teachers: ctx.teachers, students: ctx.students, currentMonth: ctx.currentMonthValue }}/>
  </motion.section>
}
