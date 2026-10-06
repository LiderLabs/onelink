// Runs one committed browser check with Playwright's bundled Chromium.
//
//   node scripts/browser/run-check.mjs scripts/browser/profile-photo-image-check.js
//
// `playwright run-code` does not exist in the installed CLI (it ships `open` and
// `codegen`, not a script runner), so this is the runner instead: it launches
// Chromium, hands the check a fresh page, and reports pass/fail with a non-zero
// exit. Each check file still holds a single `export default async (page) => …`
// function, exactly as the plan describes, so swapping runners later means
// swapping this file rather than rewriting every check.
//
// Headed by default, headless with `HEADLESS=1`: a headed window is the honest
// way to watch a crop drag that a script claims is draggable, and headless is
// what CI would want —Same assertions, both modes — so one command covers
// both watching the flow and rerunning it unattended.
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const [scriptPath] = process.argv.slice(2)
if (!scriptPath) {
  console.error('usage: node scripts/browser/run-check.mjs <check-file>')
  process.exit(2)
}

const { default: run } = await import(pathToFileURL(resolve(scriptPath)).href)

const browser = await chromium.launch({ headless: process.env.HEADLESS === '1' })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

page.on('pageerror', (error) => {
  console.error(`[pageerror] ${error.message}`)
})

try {
  await run(page)
  console.log(`PASS ${scriptPath}`)
} catch (error) {
  console.error(`FAIL ${scriptPath}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  await browser.close()
}
