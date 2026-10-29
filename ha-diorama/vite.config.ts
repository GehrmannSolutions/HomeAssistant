import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// dist is bind mounted into Home Assistant, which serves card.js to the
// browser while a build is writing it. A browser that fetches halfway
// through gets a truncated module: it throws on load, the custom elements
// are never registered, and Home Assistant says the element does not exist
// until the page is reloaded. So the build writes into a staging folder
// inside dist and renames each file into place, which is one atomic step on
// the same filesystem. A reader sees the old file or the new one, never
// half of either.
const STAGING = '.staging'

// The version from package.json, baked into the card so the console says
// which one is loaded. The release workflow raises it before building.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }

function atomicOutput(): Plugin {
  let dist = ''
  return {
    name: 'atomic-output',
    apply: 'build',
    configResolved(config) {
      dist = config.build.outDir.replace(new RegExp(`[/\\\\]${STAGING}$`), '')
    },
    closeBundle() {
      const from = join(dist, STAGING)
      let names: string[] = []
      try {
        names = readdirSync(from)
      } catch {
        return
      }
      mkdirSync(dist, { recursive: true })
      for (const name of names) renameSync(join(from, name), join(dist, name))
      rmSync(from, { recursive: true, force: true })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] }), atomicOutput()],
  define: { 'process.env.NODE_ENV': '"production"', __CARD_VERSION__: JSON.stringify(version) },
  server: {
    port: 5173,
    strictPort: true,
    cors: true,
    // Absolute asset URLs so fonts resolve when the module is loaded from Home Assistant.
    origin: 'http://localhost:5173',
  },
  build: {
    lib: {
      entry: 'src/main.tsx',
      formats: ['es'],
      fileName: () => 'card.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
    // Fonts are base64-inlined into the CSS so everything ships in card.js.
    assetsInlineLimit: Infinity,
    copyPublicDir: false,
    // The staging folder is the build's own, so emptying it is safe. dist
    // itself is never emptied: it is a live mount.
    outDir: `dist/${STAGING}`,
    emptyOutDir: true,
  },
})
