import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// The API server port. Playwright runs its own API on a separate port so it never talks to your dev server.
const apiPort = process.env.API_PORT ?? '8787'
const api = { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: false } }

/**
 * Link previews and search: SITE_URL (for example https://verapass.example) makes the Open Graph
 * image and the canonical URL absolute, and adds sitemap.xml. Without it, previews still get a
 * relative image and robots.txt.
 */
function siteMeta(siteUrl: string | undefined): Plugin {
  const base = siteUrl?.replace(/\/$/, '') ?? ''
  return {
    name: 'verapass-site-meta',
    transformIndexHtml(html) {
      const withBase = html.replaceAll('%SITE_URL%', base)
      if (!base) return withBase
      return withBase.replace(
        '<meta property="og:type"',
        `<link rel="canonical" href="${base}/" />\n    <meta property="og:url" content="${base}/" />\n    <meta property="og:type"`,
      )
    },
    generateBundle() {
      const sitemapLine = base ? `\nSitemap: ${base}/sitemap.xml\n` : '\n'
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /success\nDisallow: /cancel\n${sitemapLine}` })
      if (base) {
        // The public pages (shared/routes.ts lists all of them; /success and /cancel are not for search).
        const urls = ['/', '/verify'].map((r) => `  <url><loc>${base}${r}</loc></url>`).join('\n')
        this.emitFile({
          type: 'asset',
          fileName: 'sitemap.xml',
          source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
        })
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), siteMeta(env.SITE_URL || undefined)],
    server: { port: 5173, proxy: api },
    preview: { port: 4173, proxy: api },
    build: {
      target: 'es2022',
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes('node_modules/gsap') || id.includes('node_modules/lenis')) return 'motion'
            if (id.includes('node_modules/react')) return 'react'
            return undefined
          },
        },
      },
    },
  }
})
