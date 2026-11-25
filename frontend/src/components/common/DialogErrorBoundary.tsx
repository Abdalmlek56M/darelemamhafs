import { Component, type ErrorInfo, type ReactNode } from 'react'
import ErrorFallback from './ErrorFallback'
import { reportUiError } from '../../lib/errorReporting'

type Props = { children: ReactNode; page: string; onHome?: () => void }
type State = { error: unknown }

export default class DialogErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    reportUiError({ scope: 'dialog', page: this.props.page, componentStack: info.componentStack })
  }

  private retry = () => this.setState({ error: null })
  private home = () => { if (this.props.onHome) this.props.onHome(); else window.location.assign('/management') }

  render() {
    if (this.state.error) {
      return <div style={{ position: 'fixed', inset: 0, zIndex: 120, display: 'grid', placeItems: 'center', background: 'rgba(0,0,0,.45)', padding: 20 }}><ErrorFallback compact onRetry={this.retry} onHome={this.home} /></div>
    }
    return this.props.children
  }
}
