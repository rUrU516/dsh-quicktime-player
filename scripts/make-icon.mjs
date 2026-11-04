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
  violet: { label: '紫罗兰', stops: ['#e3d2ff', '#9a6bff', '#6a2bf0', '#4a12c0'], bar: '#efe9ff' },
  teal: { label: '青绿', stops: ['#d3fff6', '#4fe3c8', '#0fa88f', '#067a6b'], bar: '#e6fff9' },
  amber: { label: '琥珀', stops: ['#fff3cf', '#ffc457', '#f08a12', '#c25a05'], bar: '#fff4dd' },
  rose: { label: '玫红', stops: ['#ffd9e6', '#ff7aa8', '#e6316e', '#a80d47'], bar: '#ffe6ee' },
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
    Silhouette traced from QuickTime Player's mark (512 px reference, measured):
      plate  220 units square, 49 corner radius
      disc   r 54.5, flush with the ring (no dark gap)
      ring   r 54.5 … 83.5  →  centred 69, stroke 29
      bar    32.5 wide on an axis at -44°, clipped to the disc
      tail   wedge: base 34°–56° at r 88, tapering to a point at r 116
    Colourway: ${palette.label} (${name}) — ours, not Apple's blue.
    Regenerate with scripts/make-icon.mjs.
  -->
  <defs>
    <linearGradient id="qtp-bg" x1="0.1" y1="0" x2="0.55" y2="1">
      <stop offset="0" stop-color="#3f4045"/>
      <stop offset="0.42" stop-color="#1c1d20"/>
      <stop offset="1" stop-color="#0a0b0d"/>
    </linearGradient>
    <linearGradient id="qtp-metal" x1="0.12" y1="0.04" x2="0.82" y2="0.98">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="0.16" stop-color="#eef1f5"/>
      <stop offset="0.40" stop-color="#b6bcc5"/>
      <stop offset="0.60" stop-color="#98a0aa"/>
      <stop offset="0.80" stop-color="#d4d9e0"/>
      <stop offset="1" stop-color="#7f858d"/>
    </linearGradient>
    <radialGradient id="qtp-disc" cx="0.33" cy="0.73" r="0.85">
      <stop offset="0" stop-color="${c0}"/>
      <stop offset="0.2" stop-color="${c1}"/>
      <stop offset="0.55" stop-color="${c2}"/>
      <stop offset="1" stop-color="${c3}"/>
    </radialGradient>
    <clipPath id="qtp-clip"><circle cx="128" cy="128" r="54.5"/></clipPath>
  </defs>

  <rect x="18" y="18" width="220" height="220" rx="49" fill="url(#qtp-bg)"/>

  <!-- Q tail -->
  <path d="M200.9 177.2 L210 210 L177.2 200.9 Z" fill="url(#qtp-metal)" stroke="url(#qtp-metal)" stroke-width="6" stroke-linejoin="round"/>

  <!-- disc -->
  <circle cx="128" cy="128" r="54.5" fill="url(#qtp-disc)"/>

  <!-- the Q's diagonal bar -->
  <g clip-path="url(#qtp-clip)">
    <path d="M144.6 62 L161.6 76 L111.4 194 L94.4 180 Z" transform="rotate(-44 128 128)" fill="${palette.bar}" fill-opacity="0.82"/>
  </g>

  <!-- metal ring -->
  <circle cx="128" cy="128" r="69" fill="none" stroke="url(#qtp-metal)" stroke-width="29"/>

  <!-- seams -->
  <circle cx="128" cy="128" r="55.6" fill="none" stroke="#12002a" stroke-opacity="0.4" stroke-width="2.4"/>
  <circle cx="128" cy="128" r="82.6" fill="none" stroke="#000000" stroke-opacity="0.34" stroke-width="2"/>

  <!-- specular sweep -->
  <path d="M70.5 88.5a69 69 0 0 1 46.5-33.2" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="7" stroke-linecap="round"/>
</svg>
`

const target = join(dirname(dirname(fileURLToPath(import.meta.url))), 'icon.svg')
writeFileSync(target, svg, 'utf8')
console.log(`icon.svg ← ${palette.label} (${name})`)
