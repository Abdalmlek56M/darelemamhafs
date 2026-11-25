import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { BellRing, CalendarClock, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import Modal from './Modal'
import Field from './Field'
import type { Notice } from '../../domain/types'
import { playNotificationSound, readNotificationSound, readNotificationDuration } from '../../lib/notificationSounds'

type Repeat = 'once' | 'daily' | 'weekly' | 'monthly'
type Reminder = { id: string; title: string; category: string; dueAt: string; repeat: Repeat; note: string; enabled: boolean }
type Props = { permission: NotificationPermission; onEnableNotifications: () => void | Promise<void>; notify: (tone: Notice['tone'], text: string) => void }
const storageKey = 'dar-personal-reminders-v1'
const categories = ['شخصي','دراسة','حلقة وتحفيظ','متابعة إدارية','مالي']
function readSaved(): Reminder[] { try { const value = JSON.parse(localStorage.getItem(storageKey) || '[]'); return Array.isArray(value) ? value.filter(item => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.dueAt === 'string') : [] } catch { return [] } }
function localInputDate(value = new Date(Date.now()+60*60*1000)) { const pad=(n:number)=>String(n).padStart(2,'0'); return `${value.getFullYear()}-${pad(value.getMonth()+1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}` }
function nextOccurrence(current: Date, repeat: Exclude<Repeat,'once'>, now: number) { const result=new Date(current); const advance=()=>{ if(repeat==='daily')result.setDate(result.getDate()+1); else if(repeat==='weekly')result.setDate(result.getDate()+7); else if(repeat==='monthly'){ const day=result.getDate(); result.setDate(1); result.setMonth(result.getMonth()+1); const last=new Date(result.getFullYear(),result.getMonth()+1,0).getDate(); result.setDate(Math.min(day,last)) } }; do { advance() } while(result.getTime()<=now && result.getTime()>0); return result.toISOString() }
function formatDue(value: string) { const date=new Date(value); return Number.isNaN(date.getTime())?'موعد غير صالح':new Intl.DateTimeFormat('ar-EG-u-nu-latn',{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Africa/Cairo'}).format(date) }
export default function PersonalReminderCenter({ permission, onEnableNotifications, notify }: Props) {
  const [reminders,setReminders]=useState<Reminder[]>(readSaved)
  const [open,setOpen]=useState(false)
  const [title,setTitle]=useState('')
  const [category,setCategory]=useState(categories[0])
  const [dueAt,setDueAt]=useState(localInputDate())
  const [repeat,setRepeat]=useState<Repeat>('once')
  const [note,setNote]=useState('')
  const [clock,setClock]=useState(Date.now())
  useEffect(()=>{ try{localStorage.setItem(storageKey,JSON.stringify(reminders))}catch{notify('error','تعذر حفظ التذكيرات على هذا الجهاز.')} },[reminders,notify])
  useEffect(()=>{const timer=window.setInterval(()=>setClock(Date.now()),15000);return()=>window.clearInterval(timer)},[])
  useEffect(()=>{
    const now=Date.now(); const due=reminders.filter(item=>item.enabled && new Date(item.dueAt).getTime()<=now && Number.isFinite(new Date(item.dueAt).getTime()))
    if(!due.length)return
    for(const item of due){
      const key=`dar-personal-fired:${item.id}:${item.dueAt}`
      if(!localStorage.getItem(key)){
        localStorage.setItem(key,'1')
        const body=[item.category,item.note].filter(Boolean).join(' · ') || 'حان موعد التذكير الذي حددته.'
        if(permission==='granted' && typeof Notification!=='undefined') { try { const notification=new Notification(`تذكير شخصي: ${item.title}`,{body,tag:key}); notification.onclick=()=>window.focus(); playNotificationSound(readNotificationSound(), readNotificationDuration()) } catch { notify('info',`حان موعد تذكيرك: ${item.title} · ${body}`); playNotificationSound(readNotificationSound(), readNotificationDuration()) } }
        else { notify('info',`حان موعد تذكيرك: ${item.title} · ${body}`); playNotificationSound(readNotificationSound(), readNotificationDuration()) }
      }
    }
    setReminders(old=>old.map(item=>{const match=due.find(entry=>entry.id===item.id && entry.dueAt===item.dueAt);if(!match)return item;if(item.repeat==='once')return {...item,enabled:false};return {...item,dueAt:nextOccurrence(new Date(item.dueAt),item.repeat,now)}}))
  },[clock,permission,reminders,notify])
  const sorted=useMemo(()=>[...reminders].sort((a,b)=>new Date(a.dueAt).getTime()-new Date(b.dueAt).getTime()),[reminders])
  const save=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();const date=new Date(dueAt);if(!title.trim()||!Number.isFinite(date.getTime())||date.getTime()<=Date.now()){notify('error','اكتب عنوانًا وحدد موعدًا في المستقبل.');return}setReminders(old=>[{id:crypto.randomUUID(),title:title.trim(),category,dueAt:date.toISOString(),repeat,note:note.trim(),enabled:true},...old]);setTitle('');setNote('');setDueAt(localInputDate());setRepeat('once');setOpen(false);notify('success','تم حفظ التذكير على هذا الجهاز.')}
  return <><button type="button" className="icon-button reminder-center-button" title="التنبيهات والتذكيرات الشخصية" aria-label="التنبيهات والتذكيرات الشخصية" onClick={()=>setOpen(true)}><BellRing size={17}/>{reminders.some(r=>r.enabled)&&<span className="reminder-dot"/>}</button>{open&&<Modal title="التنبيهات والتذكيرات" subtitle="تذكيرات شخصية محفوظة على هذا الجهاز. يلزم بقاء التطبيق مفتوحًا حتى موعد التذكير." wide close={()=>setOpen(false)}>
    <div className="reminder-center-toolbar"><div><strong>{sorted.filter(r=>r.enabled).length} تذكير مفعّل</strong><small>{permission==='granted'?'إشعارات الجهاز مسموح بها':'التنبيه سيظهر داخل التطبيق؛ فعّل إشعارات الجهاز لتحسين التنبيه'}</small></div><button type="button" className="secondary-button" onClick={()=>void onEnableNotifications()}><BellRing size={14}/>{permission==='granted'?'فحص الإشعارات':'تفعيل إشعارات الجهاز'}</button></div>
    <form className="form-grid reminder-create-form" onSubmit={save}><Field label="عنوان التذكير *" wide><input required maxLength={120} value={title} onChange={e=>setTitle(e.target.value)} placeholder="مثال: مراجعة حسابات الشهر"/></Field><Field label="خاص بإيه؟"><select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(item=><option key={item}>{item}</option>)}</select></Field><Field label="التكرار"><select value={repeat} onChange={e=>setRepeat(e.target.value as Repeat)}><option value="once">مرة واحدة</option><option value="daily">يوميًا</option><option value="weekly">أسبوعيًا</option><option value="monthly">شهريًا</option></select></Field><Field label="التاريخ والوقت *" wide><input type="datetime-local" required value={dueAt} onChange={e=>setDueAt(e.target.value)}/></Field><Field label="ملاحظات (اختياري)" wide><textarea rows={2} maxLength={500} value={note} onChange={e=>setNote(e.target.value)} placeholder="تفاصيل تساعدك تفتكر المطلوب"/></Field><div className="wide reminder-form-actions"><button className="primary-button" type="submit"><Plus size={15}/> حفظ التذكير</button></div></form>
    <div className="personal-reminder-list">{sorted.map(item=><article className={`personal-reminder-row ${item.enabled?'':'reminder-disabled'}`} key={item.id}><div className="personal-reminder-icon"><CalendarClock size={17}/></div><div className="personal-reminder-copy"><strong>{item.title}</strong><span>{item.category} · {formatDue(item.dueAt)}{item.repeat!=='once'?` · ${({daily:'يومي',weekly:'أسبوعي',monthly:'شهري'} as Record<string,string>)[item.repeat]}`:''}</span>{item.note&&<small>{item.note}</small>}</div><button type="button" className="small-icon-button" title={item.enabled?'إيقاف التذكير':'تفعيل التذكير'} onClick={()=>setReminders(old=>old.map(r=>r.id===item.id?{...r,enabled:!r.enabled}:r))}>{item.enabled?<ToggleRight size={17}/>:<ToggleLeft size={17}/>}</button><button type="button" className="small-icon-button danger-action" title="حذف التذكير" onClick={()=>setReminders(old=>old.filter(r=>r.id!==item.id))}><Trash2 size={15}/></button></article>)}{sorted.length===0&&<p className="muted-text">لا توجد تذكيرات بعد. أضف أول تذكير من النموذج أعلاه.</p>}</div>
  </Modal>}</>
}