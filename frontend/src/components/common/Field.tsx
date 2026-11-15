import type { ReactNode } from 'react'

function Field({label,wide=false,children}:{label:string;wide?:boolean;children:ReactNode}) { return <label className={`form-field ${wide?'wide':''}`}><span>{label}</span>{children}</label> }

export default Field
