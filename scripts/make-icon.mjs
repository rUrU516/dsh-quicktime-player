#!/usr/bin/env node
/**
 * Writes `icon.svg` from one of the palettes below.
 *
 * The silhouette follows QuickTime Player's mark (same Q ring, disc, diagonal
 * bar and tail), but the disc carries our own colourway — so the shipped file is
 * our artwork, not a copy of Apple's icon.
 *
 *   node scripts/make-icon.mjs            → violet (default)
 *   node scripts/make-icon.mjs teal       → teal
 *   node scripts/make-icon.mjs amber      → amber
 *   node scripts/make-icon.mjs rose       → rose
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PALETTES = {
  violet: { label: '紫罗兰', stops: ['#a78bfa', '#8b5cf6', '#d946ef'] },
  teal: { label: '青绿', stops: ['#5eead4', '#14b8a6', '#0ea5e9'] },
  amber: { label: '琥珀', stops: ['#fcd34d', '#f59e0b', '#ef4444'] },
  rose: { label: '玫红', stops: ['#fda4af', '#f43f5e', '#be123c'] },
}

const name = process.argv[2] ?? 'violet'
const palette = PALETTES[name]
if (!palette) {
  console.error(`unknown palette "${name}"; pick one of: ${Object.keys(PALETTES).join(', ')}`)
  process.exit(1)
}
const [c0, c1, c2, c3] = palette.stops

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="QuickTime Player">
  <!--
    Dark plate, a full ring, and a play triangle inside it. Reads at 16 px and at
    180 px, which is what the sidebar guide and the plugin-store tile need.
    Colourway: ${palette.label} (${name}); regenerate with scripts/make-icon.mjs.
  -->
  <defs>
    <linearGradient id="qtp-plate" x1="0.1" y1="0" x2="0.55" y2="1">
      <stop offset="0" stop-color="#3d3e44"/>
      <stop offset="0.45" stop-color="#1b1c20"/>
      <stop offset="1" stop-color="#0a0b0d"/>
    </linearGradient>
    <linearGradient id="qtp-ring" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${c0}"/>
      <stop offset="0.5" stop-color="${c1}"/>
      <stop offset="1" stop-color="${c2}"/>
    </linearGradient>
  </defs>

  <rect x="6" y="6" width="244" height="244" rx="56" fill="url(#qtp-plate)"/>

  <circle cx="128" cy="128" r="80" fill="none" stroke="url(#qtp-ring)" stroke-width="13"/>
  <path d="M112 96 L166 128 L112 160 Z" fill="#f8f6ff" stroke="#f8f6ff" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
</svg>
`

const target = join(dirname(dirname(fileURLToPath(import.meta.url))), 'icon.svg')
writeFileSync(target, svg, 'utf8')
console.log(`icon.svg ← ${palette.label} (${name})`)
