import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, AlertCircle, Bell, X } from 'lucide-react'
import type { Notice } from '../../domain/types'

function ToastView({toast,clear}:{toast:Notice|null;clear:()=>void}) { if(!toast)return null;return <AnimatePresence><motion.div className={`toast toast-${toast.tone}`} role="status" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:8}}>{toast.tone==='success'?<CheckCircle2 size={18}/>:toast.tone==='error'?<AlertCircle size={18}/>:<Bell size={18}/>}<span>{toast.text}</span><button onClick={clear} aria-label="إغلاق التنبيه"><X size={15}/></button></motion.div></AnimatePresence> }

export default ToastView
