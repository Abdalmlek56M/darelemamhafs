import TeacherAppView from './TeacherAppView'
import { useTeacherAppState } from './useTeacherAppState'

type Props = { mode: 'teacher' | 'supervisor' }

export default function TeacherApp({ mode }: Props) {
  return <TeacherAppView {...useTeacherAppState(mode)} />
}
