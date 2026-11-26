/**
 * FINAL 0.12: portals share a browser with the admin SPA, so the API must never guess
 * identity from "whichever cookie exists". Portal routes send an explicit marker; the
 * modular API then uses only the portal session and never falls back to the admin cookie.
 */
export function portalRequestHeaders(pathname: string): Record<string, string> {
  if (pathname === '/teacher' || pathname.startsWith('/teacher/')) return { 'X-Dar-Portal': 'teacher' }
  if (pathname === '/supervisor' || pathname.startsWith('/supervisor/')) return { 'X-Dar-Portal': 'teacher' }
  return {}
}
