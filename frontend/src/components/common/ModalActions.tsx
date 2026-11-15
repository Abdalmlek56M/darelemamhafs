import { RefreshCw, CheckCircle2 } from 'lucide-react'

function ModalActions({saving,onCancel,saveLabel}:{saving:boolean;onCancel:()=>void;saveLabel:string}) { return <div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel} disabled={saving}>إلغاء</button><button type="submit" className="primary-button" disabled={saving}>{saving?<RefreshCw size={15} className="spin"/>:<CheckCircle2 size={15}/>} {saving?'جارٍ الحفظ…':saveLabel}</button></div> }

export default ModalActions
