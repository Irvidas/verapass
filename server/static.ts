import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'
import { isAppRoute } from '../shared/routes.js'

/**
 * Serves the built web app from `root` (normally ./dist). The app's own pages answer 200;
 * any other path gets the same page, which renders "not found", with a real 404 status,
 * so search engines do not index made-up URLs as copies of the home page.
 */
export function mountStatic(app: Hono, root: string): void {
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8')
  app.use('/*', serveStatic({ root }))
  app.get('*', (c) => c.html(indexHtml, isAppRoute(c.req.path) ? 200 : 404))
}
