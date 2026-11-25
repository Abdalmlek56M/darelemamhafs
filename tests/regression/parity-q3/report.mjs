export function renderReport({ summary, gaps, metadata, untested }) {
  const lines = []
  lines.push('# Q-3 backend parity report')
  lines.push('')
  lines.push('- commit: `' + (metadata.commit || 'unknown') + '`')
  lines.push('- generated: `' + metadata.generatedAt + '`')
  lines.push('- database: `' + metadata.database + '` (disposable)')
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push('| Metric | Value |')
  lines.push('|---|---:|')
  lines.push('| Scenarios executed | ' + summary.scenarios + ' |')
  lines.push('| Matching | ' + summary.passed + ' |')
  lines.push('| Mismatches | ' + summary.mismatches + ' |')
  lines.push('| Known/expected differences | ' + summary.knownDifferences + ' |')
  lines.push('')
  lines.push('## Scenario results')
  lines.push('')
  lines.push('| Scenario | Legacy HTTP | New HTTP | Differences |')
  lines.push('|---|---:|---:|---|')
  for (const result of summary.results) {
    lines.push('| ' + result.name + ' | ' + result.legacyHttp + ' | ' + result.newHttp + ' | ' + (result.differences.length ? result.differences.map(d => d.field).join(', ') : 'none') + ' |')
  }
  lines.push('')
  lines.push('## Differences (not fixed)')
  lines.push('')
  if (summary.mismatches === 0) {
    lines.push('No differences.')
  } else {
    for (const result of summary.results.filter(item => item.differences.length > 0)) {
      lines.push('### ' + result.name)
      lines.push('')
      lines.push('Legacy HTTP ' + result.legacyHttp + ' / New HTTP ' + result.newHttp + (result.knownDifference ? ' (known difference)' : ''))
      lines.push('')
      for (const difference of result.differences) {
        lines.push('- **' + difference.field + '**')
        lines.push('  - legacy: `' + JSON.stringify(difference.legacy) + '`')
        lines.push('  - new: `' + JSON.stringify(difference.new) + '`')
      }
      lines.push('')
    }
  }
  lines.push('## Not comparable / gaps')
  lines.push('')
  for (const gap of gaps) lines.push('- **' + gap.name + '**: ' + gap.reason)
  lines.push('')
  lines.push('## Not tested')
  lines.push('')
  for (const item of untested) lines.push('- ' + item)
  lines.push('')
  return lines.join('\n')
}
