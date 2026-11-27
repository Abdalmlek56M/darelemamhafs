/** FINAL 1.18: validate a Meet link before any browser/display work and only allow Google Meet hosts. */

export type MeetLinkValidation =
  | { ok: true; url: string }
  | { ok: false; reason: 'missing' | 'invalid' | 'unsupported_host' }

export function validateMeetLink(raw: string | null | undefined): MeetLinkValidation {
  if (raw === null || raw === undefined || raw.trim().length === 0) return { ok: false, reason: 'missing' }
  let parsed: URL
  try {
    parsed = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'invalid' }
  if (parsed.hostname.toLowerCase() !== 'meet.google.com') return { ok: false, reason: 'unsupported_host' }
  if (parsed.pathname.length <= 1) return { ok: false, reason: 'invalid' }
  if (parsed.username || parsed.password) return { ok: false, reason: 'invalid' }
  return { ok: true, url: parsed.toString() }
}

export function isAllowedMeetHost(input: string | null | undefined): boolean {
  if (!input) return false
  try {
    return new URL(input).hostname.toLowerCase() === 'meet.google.com'
  } catch {
    return false
  }
}
