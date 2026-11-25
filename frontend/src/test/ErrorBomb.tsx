import { useEffect, useState } from 'react'

type Props = { scope: 'app' | 'page' | 'dialog' }

/** ZZ-TEST-only component. It must never be present in a production build. */
export default function ErrorBomb({ scope }: Props) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    const listener = (event: Event) => {
      if ((event as CustomEvent<string>).detail === scope) setArmed(true)
    }
    window.addEventListener('dar:zz-error', listener)
    return () => window.removeEventListener('dar:zz-error', listener)
  }, [scope])
  if (armed) throw new Error('ZZ intentional UI error')
  return null
}
