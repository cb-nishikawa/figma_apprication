import * as esbuild from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const dist = join(root, 'dist')
const watch = process.argv.includes('--watch')

await mkdir(dist, { recursive: true })

async function buildUiHtml() {
  const [html, css, js] = await Promise.all([
    readFile(join(root, 'src/ui/ui.html'), 'utf8'),
    readFile(join(root, 'src/ui/ui.css'), 'utf8'),
    readFile(join(dist, 'ui.js'), 'utf8'),
  ])

  const out = html
    .replace('<!-- inject:css -->', `<style>\n${css}\n</style>`)
    .replace('<!-- inject:js -->', `<script>\n${js}\n</script>`)

  await writeFile(join(dist, 'ui.html'), out, 'utf8')
}

/** Rebuild ui.html after ui.js changes; also watch html/css in watch mode. */
function uiHtmlPlugin() {
  return {
    name: 'ui-html',
    setup(build) {
      build.onEnd(async (result) => {
        if (result.errors.length > 0) {
          return
        }
        try {
          await buildUiHtml()
          console.log('ui.html updated')
        } catch (error) {
          console.error('failed to build ui.html', error)
        }
      })
    },
  }
}

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2017',
  format: 'iife',
  logLevel: 'info',
}

const codeCtx = await esbuild.context({
  ...shared,
  entryPoints: [join(root, 'src/code.ts')],
  outfile: join(dist, 'code.js'),
})

const uiCtx = await esbuild.context({
  ...shared,
  entryPoints: [join(root, 'src/ui/ui.ts')],
  outfile: join(dist, 'ui.js'),
  plugins: [uiHtmlPlugin()],
})

if (watch) {
  await Promise.all([codeCtx.watch(), uiCtx.watch()])

  // Also rebuild when ui.html / ui.css change (esbuild only watches JS deps).
  const { watch: fsWatch } = await import('node:fs')
  for (const file of ['src/ui/ui.html', 'src/ui/ui.css']) {
    fsWatch(join(root, file), async () => {
      try {
        await buildUiHtml()
        console.log(`${file} changed → ui.html updated`)
      } catch (error) {
        console.error(error)
      }
    })
  }

  console.log('watching…')
} else {
  await Promise.all([codeCtx.rebuild(), uiCtx.rebuild()])
  await Promise.all([codeCtx.dispose(), uiCtx.dispose()])
  console.log('build complete')
}
