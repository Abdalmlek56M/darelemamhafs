import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'

function Modal({title,subtitle,wide=false,level=0,close,children}:{title:string;subtitle?:string;wide?:boolean;level?:number;close:()=>void;children:ReactNode}) { const brandName = localStorage.getItem('dar-brand-name') || 'دار الإمام حفص للقرآن والتجويد'; return <motion.div style={{zIndex:50+level*10}} className="modal-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={e=>{if(e.target===e.currentTarget)close()}}><motion.section className={`student-modal glass ${wide?'modal-wide':''}`} role="dialog" aria-modal="true" initial={{opacity:0,y:15,scale:.98}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:10,scale:.98}}><div className="modal-heading"><div><span className="eyebrow">{brandName}</span><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div><button className="small-icon-button close-modal" onClick={close} aria-label="إغلاق"><X size={18}/></button></div>{children}</motion.section></motion.div> }

export default Modal
