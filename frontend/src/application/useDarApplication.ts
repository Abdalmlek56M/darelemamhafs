import { useDarActionsA } from './useDarActionsA'
import { useDarActionsB } from './useDarActionsB'
import { useDarApplicationState } from './useDarApplicationState'

export default function useDarApplication() {
  const state = useDarApplicationState()
  const actionsA = useDarActionsA(state)
  const actionsB = useDarActionsB(state, actionsA)
  return { ...state, ...actionsA, ...actionsB }
}

export type DarApplicationContext = ReturnType<typeof useDarApplication>
