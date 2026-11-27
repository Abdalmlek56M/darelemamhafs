import { describe, expect, it } from 'vitest'
import { demoCircleDetail, demoCircles, demoStudentDetail, demoStudents } from './supervisorDemo'

describe('supervisor demo circle ids', () => {
  it('maps each student-circle name to the real demo circle id, never a synthesized index id', () => {
    for (const student of demoStudents) {
      const detail = demoStudentDetail(student.id)
      for (const circle of detail.student.circles) {
        const match = demoCircles.find(item => item.id === circle.id)
        expect(match, `unknown demo circle id ${circle.id} for ${student.id}`).toBeTruthy()
        expect(match?.name).toBe(circle.name)
      }
    }
  })

  it('builds the circle detail roster from the circle id', () => {
    expect(demoCircleDetail('demo-c1').roster).toHaveLength(3)
    expect(demoCircleDetail('demo-c2').roster).toHaveLength(3)
    expect(demoCircleDetail('demo-c1').circle.id).toBe('demo-c1')
  })
})
