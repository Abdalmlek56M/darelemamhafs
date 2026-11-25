import { Component, type ErrorInfo, type ReactNode } from 'react'
import ErrorFallback from './ErrorFallback'
import { reportUiError } from '../../lib/errorReporting'

type Props = { children: ReactNode; page: string; onHome?: () => void; homeHref?: string }
type State = { error: unknown }

export default class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  componentDidCatch(_error: unknown, info: ErrorInfo) {
    reportUiError({ scope: 'app', page: this.props.page, componentStack: info.componentStack })
  }

  private retry = () => this.setState({ error: null })
  private home = () => {
    if (this.props.onHome) this.props.onHome()
    else window.location.assign(this.props.homeHref || '/')
  }

  render() {
    if (this.state.error) return <ErrorFallback fullPage onRetry={this.retry} onHome={this.home} />
    return this.props.children
  }
}
