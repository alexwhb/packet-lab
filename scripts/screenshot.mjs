#!/usr/bin/env node
// Screenshots a page at each OSI layer, for comparing the app against the design.
//
//   node scripts/screenshot.mjs <url-or-file> <out-dir> [width] [prefix]
//
// Clicks each layer row in the "Network layers" nav (by its visible layer name) and saves
// <out-dir>/<prefix>-L<n>-<width>.png. Works for both the design bundle
// (docs/design/packet-lab.bundle.html) and the running app (http://localhost:7340).
import { chromium } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const [target, outDir = 'screenshots', widthArg = '1440', prefix = 'shot'] = process.argv.slice(2)
if (!target) {
  console.error('usage: node scripts/screenshot.mjs <url-or-file> <out-dir> [width] [prefix]')
  process.exit(1)
}
const width = Number(widthArg)
const url = /^https?:/.test(target) ? target : pathToFileURL(resolve(target)).href
mkdirSync(outDir, { recursive: true })

const LAYERS = [
  [7, 'Application'],
  [6, 'Presentation'],
  [5, 'Session'],
  [4, 'Transport'],
  [3, 'Network'],
  [2, 'Data Link'],
  [1, 'Physical'],
]

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
await page.goto(url, { waitUntil: 'networkidle' })
await page.waitForSelector('nav[aria-label="Network layers"] button', { timeout: 15000 })
await page.waitForTimeout(400)

for (const [n, name] of LAYERS) {
  const nav = page.locator('nav[aria-label="Network layers"]')
  await nav.locator('button', { hasText: name }).first().click()
  await page.waitForTimeout(650) // segment width transitions are 0.5 s
  const file = `${outDir}/${prefix}-L${n}-${width}.png`
  await page.screenshot({ path: file, fullPage: true })
  console.log(file)
}
await browser.close()
