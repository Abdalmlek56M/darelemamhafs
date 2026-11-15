import type { ReactNode } from 'react'

function Empty({icon,title,text}:{icon:ReactNode;title:string;text:string}) { return <div className="empty-state"><span className="empty-icon">{icon}</span><strong>{title}</strong><p>{text}</p></div> }

export default Empty
