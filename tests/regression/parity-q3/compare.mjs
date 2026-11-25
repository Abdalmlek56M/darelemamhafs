function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    const result = {}
    for (const key of Object.keys(value).sort()) result[key] = stable(value[key])
    return result
  }
  return value
}

export function stableJson(value) {
  return JSON.stringify(stable(value))
}

function responseForComparison(response) {
  const body = response.json && typeof response.json === 'object' ? { ...response.json } : response.json
  if (body && typeof body === 'object') {
    delete body.id
    delete body.attendanceId
    delete body.reviewedAt
    delete body.traceId
  }
  return body
}

function pushDifference(differences, field, legacy, current) {
  if (stableJson(legacy) !== stableJson(current)) differences.push({ field, legacy: stable(legacy), new: stable(current) })
}

export function compareReview(testCase, legacy, current) {
  const differences = []
  pushDifference(differences, 'httpStatus', legacy.status, current.status)
  pushDifference(differences, 'response', responseForComparison(legacy), responseForComparison(current))
  pushDifference(differences, 'dbState', legacy.state, current.state)
  return {
    name: testCase.name,
    kind: 'review',
    legacyHttp: legacy.status,
    newHttp: current.status,
    differences,
    knownDifference: Boolean(testCase.knownDifference)
  }
}

export function compareAdjust(testCase, legacy, current) {
  const differences = []
  // The two direct-adjust contracts are intentionally different; compare the DB effect only.
  pushDifference(differences, 'dbState', legacy.state, current.state)
  return {
    name: testCase.name,
    kind: 'adjust',
    legacyHttp: legacy.status,
    newHttp: current.status,
    differences,
    contractDifference: true,
    knownDifference: false
  }
}

export function summarize(results) {
  const mismatches = results.filter(result => result.differences.length > 0)
  return {
    scenarios: results.length,
    passed: results.length - mismatches.length,
    mismatches: mismatches.length,
    knownDifferences: mismatches.filter(result => result.knownDifference).length,
    results
  }
}
