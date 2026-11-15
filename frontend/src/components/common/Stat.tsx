import type { ReactNode } from 'react'
import { motion } from 'framer-motion'

function Stat({icon,label,value,note}:{icon:ReactNode;label:string;value:string;note:string}) { return <motion.article className="stat-card glass" whileHover={{y:-3}}><div className="stat-top"><span className="stat-icon">{icon}</span><span className="stat-dash">{value}</span></div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><p>{note}</p></motion.article> }

export default Stat
