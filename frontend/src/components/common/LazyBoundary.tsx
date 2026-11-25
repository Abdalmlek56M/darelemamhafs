import { Component, Suspense, useEffect, type ReactNode } from 'react'

type Props = { children: ReactNode; label?: string }
type State = { error: unknown }

const RELOAD_KEY = 'dar:lazy-chunk-reload'
const CHUNK_ERROR = /failed to fetch dynamically imported module|error loading dynamically imported module|loading chunk .* failed|importing a module script failed|chunkloaderror/i

function isChunkError(error: unknown) {
  return CHUNK_ERROR.test(String((error as Error | undefined)?.message ?? error ?? ''))
}

function ClearReloadGuardAfterLoad({ children }: { children: ReactNode }) {
  useEffect(() => {
    try { sessionStorage.removeItem(RELOAD_KEY) } catch { /* storage unavailable */ }
  }, [])
  return <>{children}</>
}

/** Arabic loading/error shell for route-level lazy imports. */
export default class LazyBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(error: unknown) {
    if (!isChunkError(error)) return
    try {
      // An already-open tab may reference chunks removed by a deploy. Reload once; never loop.
      if (sessionStorage.getItem(RELOAD_KEY) === '1') return
      sessionStorage.setItem(RELOAD_KEY, '1')
      window.location.reload()
    } catch { /* private mode / storage unavailable: show the Arabic fallback */ }
  }

  render() {
    if (this.state.error) {
      return (
        <div role="alert" style={{ minHeight: '60vh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center' }}>
          <div style={{ maxWidth: 420, padding: 24, borderRadius: 18, border: '1px solid var(--line, #2b3a50)', background: 'var(--surface, #111b2c)', color: 'var(--text, #e9eef6)', fontFamily: 'inherit' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>تعذر تحميل الصفحة</h2>
            <p style={{ margin: '0 0 16px', color: 'var(--muted, #95a4ba)', lineHeight: 1.8 }}>تأكد من الاتصال بالإنترنت ثم أعد المحاولة.</p>
            <button type="button" className="primary-button" onClick={() => window.location.reload()}>إعادة المحاولة</button>
          </div>
        </div>
      )
    }
    return (
      <Suspense fallback={this.props.label ? <div style={{ minHeight: '50vh', display: 'grid', placeItems: 'center', color: 'var(--muted, #95a4ba)' }}>{this.props.label}</div> : null}>
        <ClearReloadGuardAfterLoad>{this.props.children}</ClearReloadGuardAfterLoad>
      </Suspense>
    )
  }
}
