import { Component, Suspense, useEffect, type ErrorInfo, type ReactNode } from 'react'
import ErrorFallback from './ErrorFallback'
import { reportUiError } from '../../lib/errorReporting'

type Props = { children: ReactNode; label?: string; page?: string; onHome?: () => void }
type State = { error: unknown; chunk: boolean }

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

/** Arabic route boundary: lazy loading + unexpected render errors. */
export default class LazyBoundary extends Component<Props, State> {
  state: State = { error: null, chunk: false }

  static getDerivedStateFromError(error: unknown): State {
    return { error, chunk: isChunkError(error) }
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    reportUiError({ scope: 'page', page: this.props.page || 'unknown', componentStack: info.componentStack })
    if (!this.state.chunk) return
    try {
      // An already-open tab may reference chunks removed by a deploy. Reload once; never loop.
      if (sessionStorage.getItem(RELOAD_KEY) === '1') return
      sessionStorage.setItem(RELOAD_KEY, '1')
      window.location.reload()
    } catch { /* private mode / storage unavailable: show the Arabic fallback */ }
  }

  private retry = () => {
    if (this.state.chunk) { window.location.reload(); return }
    this.setState({ error: null, chunk: false })
  }
  private home = () => { if (this.props.onHome) this.props.onHome(); else window.location.assign('/') }

  render() {
    if (this.state.error) {
      return <ErrorFallback onRetry={this.retry} onHome={this.home} />
    }
    return (
      <Suspense fallback={this.props.label ? <div style={{ minHeight: '50vh', display: 'grid', placeItems: 'center', color: 'var(--muted, #95a4ba)' }}>{this.props.label}</div> : null}>
        <ClearReloadGuardAfterLoad>{this.props.children}</ClearReloadGuardAfterLoad>
      </Suspense>
    )
  }
}
