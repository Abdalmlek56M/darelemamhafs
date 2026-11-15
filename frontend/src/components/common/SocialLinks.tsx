import { Facebook, Music2, MessageCircle } from 'lucide-react'
import type { Branding } from '../../domain/types'

function SocialLinks({branding,className=''}:{branding:Branding;className?:string}) {
  const links = [branding.facebookUrl ? {label:'Facebook',url:branding.facebookUrl,Icon:Facebook} : null, branding.tiktokUrl ? {label:'TikTok',url:branding.tiktokUrl,Icon:Music2} : null, branding.whatsappUrl ? {label:'WhatsApp',url:branding.whatsappUrl,Icon:MessageCircle} : null].filter(Boolean) as {label:string;url:string;Icon:typeof Facebook}[]
  if (!links.length) return null
  return <nav className={`social-links ${className}`} aria-label="روابط الدار الرسمية">{links.map(link=>{const Icon=link.Icon;return <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" aria-label={link.label} title={link.label}><Icon size={16}/><span>{link.label}</span></a>})}</nav>
}

export default SocialLinks
