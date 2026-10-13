/** The pages the web app renders. Anything else is a "not found" page (and a 404 from the server). */
export const APP_ROUTES = ['/', '/success', '/cancel', '/verify'] as const

export type AppRoute = (typeof APP_ROUTES)[number]

/** Normalises a pathname: no trailing slash, '' becomes '/'. */
export function normalisePath(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/, '')
  return trimmed === '' ? '/' : trimmed
}

export function isAppRoute(pathname: string): boolean {
  return (APP_ROUTES as readonly string[]).includes(normalisePath(pathname))
}
