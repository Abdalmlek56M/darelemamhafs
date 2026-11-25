import { spawnSync } from 'node:child_process'

export function connectionEnv(connectionString) {
  const env = { ...process.env }
  for (const part of connectionString.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const key = part.slice(0, i).trim().toLowerCase()
    const value = part.slice(i + 1).trim()
    if (key === 'host') env.PGHOST = value
    if (key === 'port') env.PGPORT = value
    if (key === 'database') env.PGDATABASE = value
    if (key === 'username') env.PGUSER = value
    if (key === 'password') env.PGPASSWORD = value
  }
  return env
}

export function psql(connectionString, statement) {
  const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', statement], {
    env: connectionEnv(connectionString), encoding: 'utf8'
  })
  if (result.status !== 0) throw new Error('psql failed: ' + (result.stderr || '').trim())
  return (result.stdout || '').trim()
}

export const q = value => "'" + String(value).replaceAll("'", "''") + "'"
