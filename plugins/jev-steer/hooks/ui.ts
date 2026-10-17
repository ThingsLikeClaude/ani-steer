import { MARK_PNG, MARK_RATIO } from './logo'
// Vector pills for the desktop band. Drawn as an image, so colors are tints and
// mid-tones that read on both light and dark backgrounds.

export type Tone = 'apply' | 'ask' | 'hold' | 'kind' | 'mark' | 'off'

const TONE: Record<Tone, { fill: string; stroke: string; text: string }> = {
  apply: { fill: 'rgba(52,168,104,0.16)', stroke: 'rgba(52,168,104,0.45)', text: '#3a9d63' },
  ask: { fill: 'rgba(214,150,40,0.16)', stroke: 'rgba(214,150,40,0.45)', text: '#c4892b' },
  hold: { fill: 'rgba(128,128,128,0.08)', stroke: 'rgba(128,128,128,0.35)', text: '#8a8a8a' },
  kind: { fill: 'rgba(212,110,80,0.14)', stroke: 'rgba(212,110,80,0.45)', text: '#c96a4c' },
  mark: { fill: 'rgba(128,128,128,0.0)', stroke: 'rgba(128,128,128,0.0)', text: '#8a8a8a' },
  off: { fill: 'rgba(128,128,128,0.0)', stroke: 'rgba(128,128,128,0.25)', text: '#9a9a9a' },
}

const FONT = "'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Segoe UI', 'Noto Sans KR', sans-serif"
const FONT_ATTR = ` font-family="${FONT}"`

/**
 * The font said once for the whole drawing instead of on every text: every
 * text of a case card names the same font, and those names were about half
 * of its characters, all of it carried to the screen on every redraw.
 */
function lean<T extends { source: string }>(sv: T): T {
  if (!sv.source.includes(FONT_ATTR)) return sv
  const body = sv.source.split(FONT_ATTR).join('')
  const at = body.indexOf('>') + 1
  return { ...sv, source: `${body.slice(0, at)}<style>text{font-family:${FONT}}</style>${body.slice(at)}` }
}
const SIZE = 11
const HEIGHT = 18
const PAD = 6
const GAP = 4

/**
 * Advance width at 11px in the system UI font, per character class. Erring
 * small keeps the pill tight; the text is centred, so any error splits evenly.
 */
/** Text cut to a width at a font size, ending in "…" when it was cut. */
export function fitText(t: string, sz: number, room: number): string {
  if (textWidth(t) * (sz / 11) <= room) return t
  let c = t
  while (c.length > 1 && textWidth(c + '…') * (sz / 11) > room) c = c.slice(0, -1)
  return c + '…'
}

export function textWidth(text: string): number {
  let w = 0
  for (const ch of text) {
    if (/[\uac00-\ud7af\u1100-\u11ff\u3130-\u318f]/.test(ch)) w += 10.1
    else if (/[\u4e00-\u9fff]/.test(ch)) w += 11
    else if (ch === ' ') w += 3.1
    else if (/[0-9]/.test(ch)) w += 6.3
    else if (/[()[\].,:·'"|]/.test(ch)) w += 3.6
    else if (ch === '%') w += 8.6
    else if (/[A-Z]/.test(ch)) w += 7.2
    else w += 6.0
  }
  return Math.ceil(w)
}

/**
 * One hue per kind of feedback, mid-tones that read on light and dark alike.
 * The same hue marks the kind everywhere: band dot, pane rows, summary pills.
 */
export const KIND_COLOR = {
  intent: '#8b7fe0',
  effort: '#4e9be0',
  missed: '#2fa88a',
  autonomy: '#e07a55',
  buried: '#d86c9a',
} as const

export const STATE_COLOR = { hit: '#4ade80', ask: '#f5873a', weigh: '#b57cf6', quiet: '#8a8a8a' } as const

export type Pill = { text: string; tone: Tone; dot?: boolean; color?: string }

function tint(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

export function pillsSvg(pills: readonly Pill[]): { source: string; width: number; height: number } {
  let x = 0
  const parts: string[] = []
  for (const p of pills) {
    const t = p.color ? { fill: tint(p.color, 0.14), stroke: tint(p.color, 0.45), text: p.color } : TONE[p.tone]
    const dotW = p.dot ? 9 : 0
    const w = textWidth(p.text) + PAD * 2 + dotW
    parts.push(
      `<rect x="${x + 0.5}" y="0.5" width="${w - 1}" height="${HEIGHT - 1}" rx="5" fill="${t.fill}" stroke="${t.stroke}"/>`,
    )
    if (p.dot) parts.push(`<circle cx="${x + PAD + 2.5}" cy="${HEIGHT / 2}" r="2.5" fill="${t.text}"/>`)
    const textMid = x + PAD + dotW + (w - PAD * 2 - dotW) / 2
    parts.push(
      `<text x="${textMid}" y="${HEIGHT / 2}" dominant-baseline="central" text-anchor="middle" font-family="${FONT}" font-size="${SIZE}" font-weight="500" fill="${t.text}">${escapeXml(p.text)}</text>`,
    )
    x += w + GAP
  }
  const width = Math.max(1, x - GAP)
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">${parts.join('')}</svg>`,
    width,
    height: HEIGHT,
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── richer desktop pieces ────────────────────────────────────────────────
// Text that must follow the app theme uses classes switched by
// prefers-color-scheme inside the SVG; accents stay mid-tones.

const THEME = `<style>
.t1{fill:#1d1d1f}.t2{fill:#6e6e73}.t3{fill:#a1a1a6}.track{fill:rgba(0,0,0,0.06)}.rule{stroke:rgba(0,0,0,0.08)}.ink{fill:#1d1d1f}.tile{fill:rgba(0,0,0,0.04);stroke:rgba(0,0,0,0.12)}
@media (prefers-color-scheme: dark){.t1{fill:#f2f2f2}.t2{fill:#a8a8ad}.t3{fill:#6e6e73}.track{fill:rgba(255,255,255,0.08)}.rule{stroke:rgba(255,255,255,0.08)}.ink{fill:#f2f2f2}.tile{fill:rgba(255,255,255,0.04);stroke:rgba(255,255,255,0.14)}}
</style>`

export type KindCount = { color: string; n: number; label: string }

/** A segmented bar: one segment per kind, width by count, a track when empty. */
function bar(x: number, y: number, w: number, h: number, counts: readonly KindCount[]): string {
  const total = counts.reduce((s, c) => s + c.n, 0)
  const parts = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" class="track"/>`]
  if (total === 0) return parts.join('')
  const gap = 2
  const live = counts.filter(c => c.n > 0)
  const usable = w - gap * (live.length - 1)
  let cx = x
  for (const c of live) {
    const sw = Math.max(h, (usable * c.n) / total)
    parts.push(`<rect x="${cx}" y="${y}" width="${sw}" height="${h}" rx="${h / 2}" fill="${c.color}"/>`)
    cx += sw + gap
  }
  return parts.join('')
}

/** The band's left mark: the ani wordmark and a mini bar of what it remembers. */
export function markSvg(counts: readonly KindCount[]): { source: string; width: number; height: number } {
  const w = 64
  const h = 18
  const body = [
    THEME,
    `<text x="0" y="${h / 2}" dominant-baseline="central" font-family="${FONT}" font-size="12" font-weight="700" letter-spacing="0.2" class="t1">ani</text>`,
    bar(26, h / 2 - 2.5, 36, 5, counts),
  ].join('')
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`, width: w, height: h }
}

export type Stat = { value: string; label: string; color?: string }

/** The panel's header: title, subtitle, three stats and the kind bar with a legend. */
export function bannerSvg(
  width: number,
  title: string,
  subtitle: string,
  stats: readonly Stat[],
  counts: readonly KindCount[],
): { source: string; width: number; height: number } {
  const h = 192
  // Header as a component: the brand mark, the name large, and what it
  // stands for beneath it. Nothing else competes with the name.
  const cardH = 84
  const nameX = Math.round(44 * MARK_RATIO) + 18
  const parts = [
    THEME,
    markPath(0, 19, 44),
    `<line x1="0" y1="${cardH - 0.5}" x2="${width}" y2="${cardH - 0.5}" class="rule" stroke-width="1"/>`,
    `<text x="${nameX}" y="44" font-family="${FONT}" font-size="34" font-weight="800" letter-spacing="-0.6" class="t1">${escapeXml(title)}</text>`,
    `<text x="${nameX + 2}" y="62" font-family="${FONT}" font-size="12" font-weight="600" letter-spacing="1.2" class="t2">AGENT NEGATIVE INDEX</text>`,
    subtitle ? `<text x="${width - 18}" y="${cardH / 2}" text-anchor="end" dominant-baseline="central" font-family="${FONT}" font-size="12" class="t3">${escapeXml(subtitle)}</text>` : '',
  ]
  const top = cardH + 22
  const col = width / stats.length
  stats.forEach((s, i) => {
    const x = i * col
    parts.push(
      `<text x="${x}" y="${top + 26}" font-family="${FONT}" font-size="28" font-weight="700" ${s.color ? `fill="${s.color}"` : 'class="t1"'}>${escapeXml(s.value)}</text>`,
      `<text x="${x}" y="${top + 45}" font-family="${FONT}" font-size="12" class="t2">${escapeXml(s.label)}</text>`,
    )
  })
  parts.push(bar(0, top + 60, width, 6, counts))
  let lx = 0
  for (const c of counts) {
    if (lx > width - 60) break
    const text = `${c.label} ${c.n}`
    parts.push(
      `<circle cx="${lx + 4}" cy="${top + 81}" r="3.5" fill="${c.color}" ${c.n === 0 ? 'opacity="0.35"' : ''}/>`,
      `<text x="${lx + 11}" y="${top + 81}" dominant-baseline="central" font-family="${FONT}" font-size="11.5" class="${c.n ? 't2' : 't3'}">${escapeXml(text)}</text>`,
    )
    lx += 11 + textWidth(text) * 1.05 + 14
  }
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/** A section heading: clearly above body text, with a dim count on the right. */
export function headingSvg(width: number, title: string, right?: string): { source: string; width: number; height: number } {
  const h = 30
  const parts = [
    THEME,
    `<text x="0" y="21" font-family="${FONT}" font-size="17" font-weight="700" class="t1">${escapeXml(title)}</text>`,
    right ? `<text x="${width}" y="21" text-anchor="end" font-family="${FONT}" font-size="12.5" class="t2">${escapeXml(right)}</text>` : '',
  ]
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/** The brand mark: a minus bar with its top-right corner cut, one ink color. */
/**
 * The brand mark (Memory Knot), drawn in the ink color through its alpha, so
 * it follows the theme with no tile behind it. `h` is the symbol's height.
 */
let markSeq = 0
function markPath(x: number, y: number, h: number): string {
  const id = `ani-m${markSeq++}`
  const w = h * MARK_RATIO
  return [
    `<defs><mask id="${id}"><image href="${MARK_PNG}" x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="none"/></mask></defs>`,
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="ink" mask="url(#${id})"/>`,
  ].join('')
}

// ── type-set blocks: what must be read is large, the rest small ─────────

/** Greedy wrap by estimated width at a font size; never cuts a line short. */
export function wrapLines(text: string, maxWidth: number, size: number): string[] {
  const scale = size / 11
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/(\s+)/)) {
    const next = line + word
    if (line && textWidth(next.trimEnd()) * scale > maxWidth) {
      lines.push(line.trimEnd())
      line = word.trimStart()
    } else line = next
    while (textWidth(line) * scale > maxWidth) {
      let cut = line.length
      while (cut > 1 && textWidth(line.slice(0, cut)) * scale > maxWidth) cut--
      lines.push(line.slice(0, cut))
      line = line.slice(cut)
    }
  }
  if (line.trim()) lines.push(line.trimEnd())
  return lines.length ? lines : ['']
}

const LEAD = 1.45

function textLines(x: number, y: number, lines: readonly string[], size: number, cls: string, weight = 400): string {
  return lines
    .map((l, i) => `<text x="${x}" y="${y + i * size * LEAD}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" class="${cls}">${escapeXml(l)}</text>`)
    .join('')
}

export type CardBlock = {
  color: string
  /** The one line that must be read: what to do next time. */
  title: string
  /** Label/value pairs read second, in a fixed label column. */
  rows: readonly { label: string; value: string }[]
  /** The smallest line: kind, scope, when. */
  meta: string
  isMuted?: boolean
}

/**
 * One remembered correction as a type-set block: a colour rule on the left,
 * the lesson large, intent and cause small in an aligned label column, meta
 * smallest. Nothing is cut: long text wraps and the block grows.
 */
export function cardSvg(width: number, b: CardBlock): { source: string; width: number; height: number } {
  const x0 = 14
  const labelW = 58
  const inner = width - x0
  const titleSize = 14.5
  const rowSize = 11.5
  const metaSize = 10.5
  const titleLines = wrapLines(b.title, inner, titleSize)
  const parts: string[] = [THEME]
  let y = titleSize
  parts.push(textLines(x0, y, titleLines, titleSize, b.isMuted ? 't3' : 't1', 650))
  y += (titleLines.length - 1) * titleSize * LEAD + 8
  for (const r of b.rows) {
    const lines = wrapLines(r.value, inner - labelW, rowSize)
    y += rowSize * LEAD
    parts.push(
      `<text x="${x0}" y="${y}" font-family="${FONT}" font-size="${rowSize - 0.5}" class="t3">${escapeXml(r.label)}</text>`,
      textLines(x0 + labelW, y, lines, rowSize, 't2'),
    )
    y += (lines.length - 1) * rowSize * LEAD
  }
  y += metaSize * LEAD + 4
  parts.push(`<text x="${x0}" y="${y}" font-family="${FONT}" font-size="${metaSize}" class="t3">${escapeXml(b.meta)}</text>`)
  const h = Math.ceil(y + 5)
  parts.splice(1, 0, `<rect x="0" y="1" width="3" height="${h - 2}" rx="1.5" fill="${b.color}" ${b.isMuted ? 'opacity="0.35"' : ''}/>`)
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/**
 * The band's text block: a status line that must be read, and under it the
 * triple in small type. Always two lines tall, so the band never changes height.
 */
export function bandSvg(width: number, color: string | null, head: string, sub: string): { source: string; width: number; height: number } {
  const h = 34
  const x0 = color ? 12 : 0
  const fit = (t: string, size: number) => {
    const lines = wrapLines(t, width - x0, size)
    return lines.length > 1 ? `${lines[0]}…` : lines[0] ?? ''
  }
  const parts = [
    THEME,
    color ? `<rect x="0" y="3" width="3" height="${h - 6}" rx="1.5" fill="${color}"/>` : '',
    `<text x="${x0}" y="14" font-family="${FONT}" font-size="13" font-weight="650" class="t1">${escapeXml(fit(head, 13))}</text>`,
    `<text x="${x0}" y="29" font-family="${FONT}" font-size="11" class="t2">${escapeXml(fit(sub, 11))}</text>`,
  ]
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

export type StatusSeg = { label: string; value: string; hint: string; color?: string }

/**
 * The collapsed band as a status strip: a mini mark, the name, then
 * label/value segments split by hairlines. Each segment carries a <title>, so
 * hovering explains it. An alert, when there is one, takes the right side.
 */
export function statusSvg(
  width: number,
  counts: readonly KindCount[],
  segs: readonly StatusSeg[],
  alert?: { color: string; text: string },
): { source: string; width: number; height: number } {
  const h = 26
  const mid = h / 2
  const parts = [THEME]
  const padL = 12 // the strip sits flush with the band's edge; give the mark room
  parts.push(markPath(padL, mid - 6, 12))
  let x = padL + Math.round(12 * MARK_RATIO) + 7
  parts.push(`<text x="${x}" y="${mid}" dominant-baseline="central" font-family="${FONT}" font-size="12" font-weight="800" class="t1">ani</text>`)
  x += 26
  for (const s of segs) {
    parts.push(`<line x1="${x}" y1="8" x2="${x}" y2="${h - 8}" class="rule" stroke-width="1"/>`)
    x += 10
    const lw = textWidth(s.label) * (11.5 / 11)
    const vw = textWidth(s.value) * (12 / 11) + 2
    parts.push(
      `<g><title>${escapeXml(s.hint)}</title><rect x="${x - 4}" y="3" width="${lw + vw + 12}" height="${h - 6}" fill="transparent"/>`,
      `<text x="${x}" y="${mid}" dominant-baseline="central" font-family="${FONT}" font-size="11.5" class="t2">${escapeXml(s.label)}</text>`,
      `<text x="${x + lw + 5}" y="${mid}" dominant-baseline="central" font-family="${FONT}" font-size="12" font-weight="700" ${s.color ? `fill="${s.color}"` : 'class="t1"'}>${escapeXml(s.value)}</text></g>`,
    )
    x += lw + 5 + vw + 8
  }
  if (alert) {
    const room = width - x - 22
    let text = alert.text
    while (text.length > 1 && textWidth(text) * (12 / 11) > room) text = text.slice(0, -1)
    if (text !== alert.text) text = text.slice(0, -1) + '…'
    if (room > 40) {
      parts.push(
        `<circle cx="${x + 6}" cy="${mid}" r="3.5" fill="${alert.color}"/>`,
        `<text x="${x + 15}" y="${mid}" dominant-baseline="central" font-family="${FONT}" font-size="12" font-weight="600" fill="${alert.color}"><title>${escapeXml(alert.text)}</title>${escapeXml(text)}</text>`,
      )
    }
  }
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/**
 * The status strip, on an 8px grid: [mark ani ●] | message ... inventory.
 * With a lesson to read, it sits on a second line aligned under the message,
 * in a soft tinted block (no border, no tail) led by a "다음엔" tag. Once seen,
 * it settles into the first line as a quiet chip. The re-summarized short
 * form is used, so nothing is cut.
 */
export function leadStripSvg(
  width: number,
  lead: { label: string; quote?: string; color?: string; isQuiet?: boolean },
  isTwoLines: boolean,
  pulse?: Pulse['state'],
  inventory?: string,
): { source: string; width: number; height: number } {
  const padL = 8
  const size = 13
  const markH = 12
  const nameX = padL + Math.round(markH * MARK_RATIO) + 6
  const pulseX = nameX + Math.round(textWidth('ani') * (12.5 / 11)) + 7
  const ruleX = pulseX + 9
  const x0 = ruleX + 10
  const color = lead.color ?? '#8a8a8a'
  const invW = inventory ? textWidth(inventory) * (12 / 11) : 0
  const right = width - 8
  const room = right - (inventory ? invW + 24 : 0) - x0
  const fit = fitText
  const two = isTwoLines && Boolean(lead.quote)
  const top = 10
  // Nothing is cut: a lesson that does not fit wraps inside its block.
  const quoteSize = 13.5
  const quoteLineH = 20
  const tagW0 = textWidth('다음엔') * (11.5 / 11)
  const quoteX = padL + tagW0 + 8
  const fitsOne = (q: string) => textWidth(q) * (quoteSize / 11) <= width - 8 - quoteX
  const quoteLines = two && lead.quote && fitsOne(lead.quote) ? [lead.quote] : []
  const firstQY = top + 21
  const h = two && quoteLines.length ? firstQY + 12 : 20
  const parts = [THEME, markPath(padL, top - markH / 2, markH)]
  parts.push(`<text x="${nameX}" y="${top}" dominant-baseline="central" font-family="${FONT}" font-size="12.5" font-weight="700" class="t1">ani</text>`)
  if (pulse) parts.push(pulseDot(pulseX, top, pulse).replace(/r="3.5"/g, 'r="3"').replace(/values="3.5;8;3.5"/, 'values="3;7;3"'))
  parts.push(`<line x1="${ruleX}" y1="${top - 7}" x2="${ruleX}" y2="${top + 7}" class="rule" stroke-width="1"/>`)
  if (inventory) parts.push(`<text x="${right}" y="${top}" text-anchor="end" dominant-baseline="central" font-family="${FONT}" font-size="12" class="t3">${escapeXml(inventory)}</text>`)

  const tagW = textWidth('다음엔') * (11.5 / 11)
  if (two && quoteLines.length) {
    parts.push(`<text x="${x0}" y="${top}" dominant-baseline="central" font-family="${FONT}" font-size="${size}" font-weight="500" class="t2">${escapeXml(fit(lead.label, size, room))}</text>`)
    const firstY = firstQY
    parts.push(
      `<text x="${padL}" y="${firstY}" dominant-baseline="central" font-family="${FONT}" font-size="11.5" font-weight="700" fill="${color}">다음엔</text>`,
      ...quoteLines.map(
        (l, i) =>
          `<text x="${quoteX}" y="${firstY + i * quoteLineH}" dominant-baseline="central" font-family="${FONT}" font-size="${quoteSize}" font-weight="600" class="t1">${escapeXml(l)}</text>`,
      ),
    )
  } else {
    const labelText = fit(lead.label, size, room)
    parts.push(`<text x="${x0}" y="${top}" dominant-baseline="central" font-family="${FONT}" font-size="${size}" font-weight="${lead.isQuiet ? 400 : 500}" class="${lead.isQuiet ? 't2' : 't1'}">${escapeXml(labelText)}</text>`)
    if (lead.quote) {
      const cx = x0 + textWidth(labelText) * (size / 11) + 12
      const chipRoom = x0 + room - cx - 20 - tagW
      if (textWidth(lead.quote) * (12.5 / 11) <= chipRoom) {
        const body = lead.quote
        const cw = 10 + tagW + 8 + textWidth(body) * (12.5 / 11) + 10
        void cw
        parts.push(
          `<text x="${cx + 4}" y="${top}" dominant-baseline="central" font-family="${FONT}" font-size="11.5" font-weight="700" fill="${color}">다음엔</text>`,
          `<text x="${cx + 4 + tagW + 8}" y="${top}" dominant-baseline="central" font-family="${FONT}" font-size="12.5" font-weight="500" class="t1">${escapeXml(body)}</text>`,
        )
      }
    }
  }
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

export type Pulse = { state: 'live' | 'stale' | 'down' | 'unknown'; text: string }

const PULSE_COLOR: Record<Pulse['state'], string> = { live: '#3a9d63', stale: '#c4892b', down: '#d0574f', unknown: '#8a8a8a' }

/** A heartbeat dot: a live connection beats (a soft ring expanding), others sit still. */
function pulseDot(cx: number, cy: number, state: Pulse['state']): string {
  const c = PULSE_COLOR[state]
  const ring =
    state === 'live'
      ? `<circle cx="${cx}" cy="${cy}" r="3.5" fill="none" stroke="${c}" stroke-width="1.5"><animate attributeName="r" values="3.5;8;3.5" keyTimes="0;0.6;1" dur="1.6s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.8;0;0" keyTimes="0;0.6;1" dur="1.6s" repeatCount="indefinite"/></circle>`
      : ''
  return `${ring}<circle cx="${cx}" cy="${cy}" r="3.5" fill="${c}"/>`
}

/** The panel header: mark and name on the left; Jev's heartbeat and what rides this request on the right. */
export function paneHeaderSvg(width: number, pulse: Pulse, riding: string): { source: string; width: number; height: number } {
  // The mark spans the name and its subtitle; the riding line sits apart below.
  const markH = 50
  const top = 6
  const h = top + markH + 40
  const parts = [THEME, markPath(0, top, markH)]
  const nameX = Math.round(markH * MARK_RATIO) + 16
  parts.push(
    `<text x="${nameX}" y="${top + 31}" font-family="${FONT}" font-size="38" font-weight="800" letter-spacing="-0.8" class="t1">ani</text>`,
    `<text x="${nameX + 2}" y="${top + markH - 1}" font-family="${FONT}" font-size="11.5" font-weight="600" letter-spacing="1.4" class="t3">AGENT NEGATIVE INDEX</text>`,
    `<text x="0" y="${h - 6}" font-family="${FONT}" font-size="15" font-weight="500" class="t2">${escapeXml(riding || '이번 요청에 붙인 규칙 없음')}</text>`,
  )
  const pw = textWidth(pulse.text) * (12.5 / 11)
  parts.push(
    pulseDot(width - pw - 14, top + 18, pulse.state),
    `<text x="${width}" y="${top + 18}" text-anchor="end" dominant-baseline="central" font-family="${FONT}" font-size="12.5" class="t2">${escapeXml(pulse.text)}</text>`,
  )
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/** A hairline between list rows. */
export function ruleSvg(width: number): { source: string; width: number; height: number } {
  const style = '<style>.hl{stroke:rgba(0,0,0,0.12)}@media (prefers-color-scheme: dark){.hl{stroke:rgba(255,255,255,0.12)}}</style>'
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="2" viewBox="0 0 ${width} 2">${style}<line x1="0" y1="1" x2="${width}" y2="1" class="hl" stroke-width="1"/></svg>`, width, height: 2 }
}

export { pulseDot }

export type RowLine = { label?: string; value: string }
export type RowMeta = { text: string; color?: string }

/**
 * One list row, type-set: the title large, supporting lines small with a
 * fixed label column, a meta line smallest. Wraps, never truncates; the
 * hairline is drawn at the bottom so rows breathe evenly.
 */
export function rowSvg(
  width: number,
  r: {
    title: string
    lines?: readonly RowLine[]
    meta?: readonly RowMeta[]
    isMuted?: boolean
    titleColor?: string
    /** Table cells on the title's baseline, at fixed x, so every row lines up. */
    cols?: readonly { x: number; text: string; color?: string; anchor?: 'start' | 'end' }[]
    /** Width the title and detail may use (the rest belongs to the columns). */
    textWidth?: number
  },
): { source: string; width: number; height: number } {
  const tw = r.textWidth ?? width
  const padT = 16
  const padB = 16
  const titleSize = 14.5
  const subSize = 12.5
  const metaSize = 11.5
  const labelW = 64
  const parts: string[] = [THEME]
  let y = padT + titleSize
  const titleLines = wrapLines(r.title, tw, titleSize)
  const titleY = y
  titleLines.forEach((l, i) =>
    parts.push(
      `<text x="0" y="${y + i * titleSize * 1.5}" font-family="${FONT}" font-size="${titleSize}" font-weight="600" ${r.titleColor ? `fill="${r.titleColor}"` : `class="${r.isMuted ? 't3' : 't1'}"`} ${r.isMuted ? 'text-decoration="line-through"' : ''}>${escapeXml(l)}</text>`,
    ),
  )
  y += (titleLines.length - 1) * titleSize * 1.5
  if (r.lines?.length) y += 10
  for (const line of r.lines ?? []) {
    const vx = line.label ? labelW : 0
    const vl = wrapLines(line.value, tw - vx, subSize)
    y += subSize * 1.55
    if (line.label) parts.push(`<text x="0" y="${y}" font-family="${FONT}" font-size="${subSize - 0.5}" class="t3">${escapeXml(line.label)}</text>`)
    vl.forEach((l, i) => parts.push(`<text x="${vx}" y="${y + i * subSize * 1.55}" font-family="${FONT}" font-size="${subSize}" class="t2">${escapeXml(l)}</text>`))
    y += (vl.length - 1) * subSize * 1.55
  }
  if (r.meta?.length) {
    y += 10 + metaSize
    let x = INSET
    r.meta.forEach((m, i) => {
      if (i > 0) {
        parts.push(`<text x="${x + 6}" y="${y}" font-family="${FONT}" font-size="${metaSize}" class="t3">·</text>`)
        x += 18
      }
      parts.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${metaSize}" font-weight="${m.color ? 600 : 400}" ${m.color ? `fill="${m.color}"` : 'class="t3"'}>${escapeXml(m.text)}</text>`)
      x += textWidth(m.text) * (metaSize / 11)
    })
  }
  for (const c of r.cols ?? []) {
    parts.push(
      `<text x="${c.x}" y="${titleY}" text-anchor="${c.anchor ?? 'start'}" font-family="${FONT}" font-size="12.5" font-weight="${c.color ? 600 : 400}" ${c.color ? `fill="${c.color}"` : 'class="t2"'}>${escapeXml(c.text)}</text>`,
    )
  }
  const h = Math.ceil(y + padB)
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/** A table's column header: small, dim labels at the same x as the row cells. */
export function tableHeadSvg(width: number, cols: readonly { x: number; text: string; anchor?: 'start' | 'end' }[]): { source: string; width: number; height: number } {
  const h = 30
  const parts = [THEME]
  for (const c of cols) parts.push(`<text x="${c.x === 0 ? INSET : c.x}" y="20" text-anchor="${c.anchor ?? 'start'}" font-family="${FONT}" font-size="11.5" font-weight="600" letter-spacing="0.2" class="t3">${escapeXml(c.text)}</text>`)
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/** A section label inside a tab: small caps-like weight, count dim beside it. */
export function sectionSvg(width: number, title: string, count?: string): { source: string; width: number; height: number } {
  const h = 56
  const parts = [
    THEME,
    `<text x="0" y="${h / 2}" dominant-baseline="central" font-family="${FONT}" font-size="17" font-weight="800" letter-spacing="-0.2" class="t1">${escapeXml(title)}</text>`,
    count ? `<text x="${textWidth(title) * (17 / 11) + 10}" y="${h / 2}" dominant-baseline="central" font-family="${FONT}" font-size="14" font-weight="600" class="t3">${escapeXml(count)}</text>` : '',
  ]
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/**
 * A table row's first line, on its own: the title and the cells, all
 * vertically centered in a fixed band, so a native button beside it can be
 * centered on the same axis. Multi-line titles grow the band evenly.
 */
/** Rows inset their text so a glow behind them has room to breathe. */
const INSET = 10

/** A row riding the current request: tinted; when it just went out, it flashes and a sheen sweeps once. */
export type Glow = { color: string; isFresh: boolean; isRing?: boolean; isWeighing?: boolean }

function glowRect(_width: number, _h: number, _g: Glow | undefined, _edge: 'top' | 'bottom', _isJoined: boolean): string {
  // Rows carry no tinted block or side bar: state is the shimmer on the text and the pill.
  return ''
}

/**
 * The file-tree shimmer: a band of light sweeping across the title text.
 * Judging repeats it; a lesson that just went out sweeps twice and settles.
 */
function shimmerDef(width: number, g: Glow): string {
  const hi = g.isWeighing ? '#f0c27a' : '#8fe0ae'
  const reps = g.isWeighing ? 'indefinite' : '2'
  return `<defs><style>.sb{stop-color:#1d1d1f}@media (prefers-color-scheme: dark){.sb{stop-color:#f2f2f2}}</style><linearGradient id="sh" gradientUnits="userSpaceOnUse" x1="-260" y1="0" x2="0" y2="0"><stop offset="0" class="sb"/><stop offset="0.45" class="sb"/><stop offset="0.5" stop-color="${hi}"/><stop offset="0.55" class="sb"/><stop offset="1" class="sb"/><animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="${width + 260} 0" dur="1.4s" repeatCount="${reps}"/></linearGradient></defs>`
}

export function titleRowSvg(
  width: number,
  r: { title: string; textWidth: number; isMuted?: boolean; isDim?: boolean; cols?: readonly { x: number; text: string; color?: string; anchor?: 'start' | 'end'; isPill?: boolean }[]; hasDetail?: boolean; glow?: Glow },
): { source: string; width: number; height: number } {
  const size = 14.5
  const lineH = 22
  const pad = 14
  const padB = 14
  const lines = wrapLines(r.title, r.textWidth - INSET, size)
  const h = pad + padB + lines.length * lineH
  const shim = r.glow && (r.glow.isWeighing || r.glow.isFresh)
  const parts = [THEME, shim && r.glow ? shimmerDef(width, r.glow) : '']
  lines.forEach((l, i) =>
    parts.push(
      `<text x="${INSET}" y="${pad + lineH * i + lineH / 2}" dominant-baseline="central" font-family="${FONT}" font-size="${size}" font-weight="${r.isDim ? 400 : 600}" ${shim ? 'fill="url(#sh)"' : `class="${r.isMuted ? 't3' : r.isDim ? 't2' : 't1'}"`} ${r.isMuted ? 'text-decoration="line-through"' : ''}>${escapeXml(l)}</text>`,
    ),
  )
  for (const c of r.cols ?? []) {
    if (c.isPill && c.color) {
      const pw = textWidth(c.text) * (12 / 11) + 18
      const px = c.anchor === 'end' ? c.x - pw - 4 : c.x - 9
      parts.push(`<rect x="${px}" y="${pad + (lines.length * lineH) / 2 - 11}" width="${pw}" height="22" rx="11" fill="${c.color}" opacity="0.18"/>`)
    }
    parts.push(
      `<text x="${c.isPill && c.color && c.anchor === 'end' ? c.x - 13 : c.x}" y="${pad + (lines.length * lineH) / 2}" text-anchor="${c.anchor ?? 'start'}" dominant-baseline="central" font-family="${FONT}" font-size="12.5" font-weight="${c.color ? 600 : 400}" ${c.color ? `fill="${c.color}"` : 'class="t2"'}>${escapeXml(c.text)}</text>`,
    )
  }
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/** The detail under a row's title: labeled lines, then the meta line. */
export function detailSvg(
  width: number,
  r: { textWidth: number; lines?: readonly RowLine[]; meta?: readonly RowMeta[]; glow?: Glow },
): { source: string; width: number; height: number } | null {
  if (!r.lines?.length && !r.meta?.length) return null
  const subSize = 12.5
  const metaSize = 11.5
  const labelW = SUB_LABEL_W + INSET
  const parts = [THEME, '<!--glow-->']
  let y = -6
  for (const line of r.lines ?? []) {
    const vx = line.label ? labelW : INSET
    const vl = wrapLines(line.value, r.textWidth - vx, subSize)
    y += subSize * 1.6
    if (line.label) parts.push(`<text x="${INSET}" y="${y}" font-family="${FONT}" font-size="${subSize - 0.5}" class="t3">${escapeXml(line.label)}</text>`)
    vl.forEach((l, i) => parts.push(`<text x="${vx}" y="${y + i * subSize * 1.6}" font-family="${FONT}" font-size="${subSize}" class="t2">${escapeXml(l)}</text>`))
    y += (vl.length - 1) * subSize * 1.6
  }
  if (r.meta?.length) {
    y += 10 + metaSize
    let x = INSET
    r.meta.forEach((m, i) => {
      if (i > 0) {
        parts.push(`<text x="${x + 6}" y="${y}" font-family="${FONT}" font-size="${metaSize}" class="t3">·</text>`)
        x += 18
      }
      parts.push(`<text x="${x}" y="${y}" font-family="${FONT}" font-size="${metaSize}" font-weight="${m.color ? 600 : 400}" ${m.color ? `fill="${m.color}"` : 'class="t3"'}>${escapeXml(m.text)}</text>`)
      x += textWidth(m.text) * (metaSize / 11)
    })
  }
  const h = Math.ceil(y + 14)
  const body = parts.join('').replace('<!--glow-->', glowRect(width, h, r.glow, 'bottom', true))
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${body}</svg>`, width, height: h }
}

/**
 * The decision card above the strip, shaped like a permission prompt: the
 * question, the lesson in full, why it exists. Its frame and buttons are the
 * surface's own; this draws only the text.
 */
export function askCardSvg(
  width: number,
  a: { question?: string; counter?: string; lesson: string; intent?: string; why?: string; color: string },
): { source: string; width: number; height: number } {
  const q = a.question ?? '이번 요청에도 이 교훈을 적용할까요?'
  const lessonSize = 15
  const lessonLH = 22
  const tagW = textWidth('다음엔') * (12 / 11) + 10
  const lessonLines = wrapLines(a.lesson, width - tagW, lessonSize)
  const sub = [a.intent ? { label: '원했던 것', value: a.intent } : null, a.why ? { label: '틀린 이유', value: a.why } : null].filter(Boolean) as { label: string; value: string }[]
  const subSize = 12.5
  const subLH = 19
  const labelW = 66
  const subLines = sub.map(s => ({ label: s.label, lines: wrapLines(s.value, width - labelW, subSize) }))
  let y = 10
  const parts = [THEME]
  parts.push(`<text x="0" y="${y}" dominant-baseline="central" font-family="${FONT}" font-size="13" font-weight="600" fill="${a.color}">${escapeXml(q)}</text>`)
  if (a.counter) parts.push(`<text x="${width}" y="${y}" text-anchor="end" dominant-baseline="central" font-family="${FONT}" font-size="12" class="t3">${escapeXml(a.counter)}</text>`)
  y += 28
  parts.push(`<text x="0" y="${y}" dominant-baseline="central" font-family="${FONT}" font-size="12" font-weight="700" fill="${a.color}">다음엔</text>`)
  lessonLines.forEach((l, i) => parts.push(`<text x="${tagW}" y="${y + i * lessonLH}" dominant-baseline="central" font-family="${FONT}" font-size="${lessonSize}" font-weight="700" class="t1">${escapeXml(l)}</text>`))
  y += (lessonLines.length - 1) * lessonLH
  if (subLines.length) y += 10
  for (const s of subLines) {
    y += subLH
    parts.push(`<text x="0" y="${y}" dominant-baseline="central" font-family="${FONT}" font-size="12" class="t3">${escapeXml(s.label)}</text>`)
    s.lines.forEach((l, i) => parts.push(`<text x="${labelW}" y="${y + i * subLH}" dominant-baseline="central" font-family="${FONT}" font-size="${subSize}" class="t2">${escapeXml(l)}</text>`))
    y += (s.lines.length - 1) * subLH
  }
  const h = Math.ceil(y + 12)
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/**
 * "지금" card at the top of the pane, after the file-tree mod's RIGHT NOW:
 * what ani is doing for the request just sent, then a legend for the rows.
 */
export function nowCardSvg(
  width: number,
  n: { state: 'busy' | 'hit' | 'idle' | 'late'; title: string; sub?: string },
): { source: string; width: number; height: number } {
  const h = 128
  const color = n.state === 'hit' ? STATE_COLOR.hit : n.state === 'busy' ? STATE_COLOR.weigh : n.state === 'late' ? STATE_COLOR.ask : '#8a8a8a'
  const cx = 34
  const cy = 46
  const icon =
    n.state === 'busy'
      ? `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="${color}" stroke-width="2.4" stroke-dasharray="14 44" stroke-linecap="round"><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur="0.9s" repeatCount="indefinite"/></circle>`
      : n.state === 'hit'
        ? `<circle cx="${cx}" cy="${cy}" r="15" fill="${color}" fill-opacity="0.16"/><path d="M${cx - 6} ${cy} l4 4 l8 -8.5" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<circle cx="${cx}" cy="${cy}" r="9" fill="none" class="rule" stroke-width="2"/>`
  const lx = 64
  const legend = [
    { c: STATE_COLOR.hit, t: '반영 중' },
    { c: STATE_COLOR.weigh, t: '판단 중' },
    { c: '#8a8a8a', t: '꺼둠' },
  ]
  let x = 18
  const leg = legend
    .map(l => {
      const s = `<circle cx="${x + 4}" cy="${h - 22}" r="4" fill="${l.c}"/><text x="${x + 14}" y="${h - 22}" dominant-baseline="central" font-family="${FONT}" font-size="12.5" class="t2">${l.t}</text>`
      x += 14 + textWidth(l.t) * (12.5 / 11) + 22
      return s
    })
    .join('')
  const parts = [
    THEME,
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${h - 1}" rx="12" class="tile"/>`,
    icon,
    `<text x="${lx}" y="24" dominant-baseline="central" font-family="${FONT}" font-size="11" font-weight="800" letter-spacing="1.4" fill="${color}">${n.state === 'busy' ? '판단 중' : n.state === 'hit' ? '반영함' : n.state === 'late' ? '늦음' : '대기'}</text>`,
    `<text x="${lx}" y="${cy}" dominant-baseline="central" font-family="${FONT}" font-size="17" font-weight="800" class="t1">${escapeXml(n.title)}</text>`,
    n.sub ? `<text x="${lx}" y="${cy + 22}" dominant-baseline="central" font-family="${FONT}" font-size="12.5" class="t2">${escapeXml(n.sub)}</text>` : '',
    `<line x1="18" y1="${h - 44}" x2="${width - 18}" y2="${h - 44}" class="rule" stroke-width="1"/>`,
    leg,
  ]
  return { source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${parts.join('')}</svg>`, width, height: h }
}

/** The label column of detail lines (원했던 것, 처음 요청, …): wide enough that the values start well clear of it. */
const SUB_LABEL_W = 92

export type CardRow = {
  dot: string
  /** A small type badge in place of the dot, the way the file tree tags JS / PDF. */
  badge?: { text: string; color: string }
  /** The row's live state: the whole row takes this hue, text and tint. */
  tone?: string
  title: string
  scope?: string
  pill?: { text: string; color?: string }
  sub?: readonly { label: string; value: string }[]
  shimmer?: 'weigh' | 'fresh'
  isMuted?: boolean
}

/**
 * A file-tree style section: one rounded card, one line per item (a kind dot,
 * the title, a scope cell, a status pill), detail lines only where given.
 * Titles wrap instead of being cut.
 */
/** How much wider than measured a short name may draw. */
const SCOPE_SLACK = 1.15

export function listCardSvg(width: number, rows: readonly CardRow[], tone?: string): { source: string; width: number; height: number } {
  const padX = 16
  const padY = 8
  const size = 13.5
  const lineH = 20
  const pillRight = width - padX
  const pillWOf = (r: CardRow) => (r.pill ? textWidth(r.pill.text) * (11.5 / 11) + 18 : 0)
  const pillCol = Math.max(0, ...rows.map(pillWOf))
  // The project or scope column: as wide as its longest name needs, up to a
  // fifth of the card; a longer name ends in "…" before the pill, never under it.
  // Names are measured a little wide: latin letters vary more than the table says.
  const scopeSize = 12
  const scopeMax = Math.min(160, Math.round(width * 0.2))
  const scopeCol = Math.ceil(Math.min(scopeMax, Math.max(0, ...rows.map(r => (r.scope ? textWidth(r.scope) * (scopeSize / 11) * SCOPE_SLACK : 0)))))
  const scopeRight = pillRight - (pillCol ? pillCol + 12 : 0)
  const scopeX = scopeRight - scopeCol
  const textX = padX + (rows.some(r => r.badge) ? 40 : 16)
  const textW = (scopeCol ? scopeX - 16 : scopeRight - 12) - textX
  const parts: string[] = [THEME]
  const defs: string[] = []
  let y = padY
  rows.forEach((r, i) => {
    const lines = wrapLines(r.title, textW, size)
    const rowH = Math.max(36, lines.length * lineH + 16)
    const cy = y + rowH / 2
    if (r.tone) parts.push(`<rect x="${padX - 8}" y="${y + 3}" width="${width - padX * 2 + 16}" height="${rowH - 6}" rx="9" fill="${r.tone}" fill-opacity="0.2"/>`)
    else if (i > 0 && !rows[i - 1].tone) parts.push(`<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" class="rule" stroke-width="1"/>`)
    if (r.badge) {
      const bw = textWidth(r.badge.text) * (10.5 / 11) + 10
      parts.push(`<rect x="${padX - 2}" y="${cy - 10}" width="${bw}" height="20" rx="5" fill="${r.isMuted ? '#6e6e73' : r.badge.color}" fill-opacity="0.18"/><text x="${padX - 2 + bw / 2}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="10.5" font-weight="700" fill="${r.isMuted ? '#8a8a8a' : r.badge.color}">${escapeXml(r.badge.text)}</text>`)
    } else parts.push(`<circle cx="${padX + 4}" cy="${cy}" r="4" fill="${r.isMuted ? '#6e6e73' : r.dot}"/>`)
    const isStrong = Boolean(r.shimmer) || Boolean(r.pill?.color) || Boolean(r.tone)
    let fill = r.tone ? `fill="${r.tone}"` : `class="${r.isMuted ? 't3' : isStrong ? 't1' : 't2'}"`
    if (r.shimmer) {
      const id = `sh${i}`
      const hi = '#ffffff'
      defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${textX - 260}" y1="0" x2="${textX}" y2="0"><stop offset="0" stop-color="${r.tone ?? '#f2f2f2'}"/><stop offset="0.42" stop-color="${r.tone ?? '#f2f2f2'}"/><stop offset="0.5" stop-color="${hi}"/><stop offset="0.58" stop-color="${r.tone ?? '#f2f2f2'}"/><stop offset="1" stop-color="${r.tone ?? '#f2f2f2'}"/><animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="${textW + 260} 0" dur="1.5s" repeatCount="${r.shimmer === 'weigh' ? 'indefinite' : '3'}"/></linearGradient>`)
      fill = `fill="url(#${id})"`
    }
    lines.forEach((l, k) =>
      parts.push(`<text x="${textX}" y="${cy - ((lines.length - 1) * lineH) / 2 + k * lineH}" dominant-baseline="central" font-family="${FONT}" font-size="${size}" font-weight="${r.tone ? 700 : isStrong ? 600 : 400}" ${fill}${r.isMuted ? ' text-decoration="line-through"' : ''}>${escapeXml(l)}</text>`),
    )
    if (r.scope) parts.push(`<text x="${scopeX}" y="${cy}" dominant-baseline="central" font-family="${FONT}" font-size="${scopeSize}" class="t3">${escapeXml(fitText(r.scope, scopeSize, scopeCol / SCOPE_SLACK))}</text>`)
    if (r.pill) {
      const pw = textWidth(r.pill.text) * (11.5 / 11) + 18
      if (r.pill.color) parts.push(`<rect x="${pillRight - pw}" y="${cy - 11}" width="${pw}" height="22" rx="11" fill="${r.pill.color}" fill-opacity="0.24"/>`)
      parts.push(`<text x="${pillRight - pw / 2}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-size="11.5" font-weight="700" ${r.pill.color ? `fill="${r.pill.color}"` : 'class="t3"'}>${escapeXml(r.pill.text)}</text>`)
    }
    y += rowH
    for (const s of r.sub ?? []) {
      const vl = wrapLines(s.value, width - padX - textX - SUB_LABEL_W, 12)
      vl.forEach((l, k) => {
        if (k === 0) parts.push(`<text x="${textX}" y="${y + 6 + k * 18}" dominant-baseline="central" font-family="${FONT}" font-size="11.5" class="t3">${escapeXml(s.label)}</text>`)
        parts.push(`<text x="${textX + SUB_LABEL_W}" y="${y + 6 + k * 18}" dominant-baseline="central" font-family="${FONT}" font-size="12" class="t2">${escapeXml(l)}</text>`)
      })
      y += vl.length * 18
    }
    if (r.sub?.length) y += 10
  })
  const h = Math.ceil(y + padY)
  const frame = `<rect x="0.5" y="0.5" width="${width - 1}" height="${h - 1}" rx="12" ${tone ? `fill="${tone}" fill-opacity="0.06" stroke="${tone}" stroke-opacity="0.55"` : 'class="tile"'}/>`
  const style = '<style>.sb{stop-color:#1d1d1f}@media (prefers-color-scheme: dark){.sb{stop-color:#f2f2f2}}</style>'
  return lean({ source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">${style}<defs>${defs.join('')}</defs>${frame}${parts.join('')}</svg>`, width, height: h })
}

/** A file-tree section label: small caps and a count. */
export function capLabelSvg(text: string, count: string): { source: string; width: number; height: number } {
  const labelW = textWidth(text) * (11.5 / 11) + text.length * 1.2
  const w = Math.ceil(2 + labelW + 8 + textWidth(count) * (12.5 / 11) + 4)
  const h = 28
  return {
    source: `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${THEME}<text x="2" y="${h / 2}" dominant-baseline="central" font-family="${FONT}" font-size="11.5" font-weight="700" letter-spacing="1.2" class="t3">${escapeXml(text)}</text><text x="${Math.round(2 + labelW + 8)}" y="${h / 2}" dominant-baseline="central" font-family="${FONT}" font-size="12.5" font-weight="700" class="t1">${escapeXml(count)}</text></svg>`,
    width: w,
    height: h,
  }
}

export type CaseView = {
  dot: string
  said: string
  /** The feedback as the person typed it; shown whole on the timeline. */
  raw?: string
  when: string
  before?: string
  did?: string
  after?: readonly string[]
  understood?: string
  meant?: string
  judgment?: string
  lesson?: string
}

/**
 * One case, read top to bottom as what happened: a timeline (request → what
 * the agent did → the feedback → what came next), then where the agent's
 * reading and the person's intent parted, then the judgment drawn from it.
 */
export function caseCardSvg(width: number, cs: readonly CaseView[]): { source: string; width: number; height: number } {
  const padX = 18
  const railX = padX + 5
  const textX = padX + 22
  const textW = width - textX - padX
  const parts: string[] = [THEME]
  let y = 10
  cs.forEach((c, n) => {
    if (n > 0) {
      parts.push(`<line x1="${padX}" y1="${y}" x2="${width - padX}" y2="${y}" class="rule" stroke-width="1"/>`)
      y += 8
    }
    // head: the feedback, and when
    const head = wrapLines(c.said, textW - 70, 14)
    head.forEach((l, i) => parts.push(`<text x="${padX}" y="${y + 14 + i * 21}" dominant-baseline="central" font-family="${FONT}" font-size="14" font-weight="600" class="t1">${escapeXml(l)}</text>`))
    parts.push(`<text x="${width - padX}" y="${y + 14}" text-anchor="end" dominant-baseline="central" font-family="${FONT}" font-size="11.5" class="t3">${escapeXml(c.when)}</text>`)
    y += 14 + head.length * 21
    // timeline
    const steps = [
      c.before ? { tag: '요청', text: c.before } : null,
      c.did ? { tag: 'Claude', text: c.did } : null,
      { tag: '피드백', text: c.raw ?? c.said, isMe: true },
      ...(c.after ?? []).map(a => ({ tag: '다음', text: a })),
    ].filter(Boolean) as { tag: string; text: string; isMe?: boolean }[]
    const top = y + 4
    const nodes: number[] = []
    for (const s of steps) {
      const lines = wrapLines(s.text, textW - 56, 12.5)
      const cy = y + 12
      nodes.push(cy)
      parts.push(`<circle cx="${railX}" cy="${cy}" r="${s.isMe ? 4 : 3}" ${s.isMe ? `fill="${c.dot}"` : 'class="t3" fill-opacity="0.9"'} />`)
      parts.push(`<text x="${textX}" y="${cy}" dominant-baseline="central" font-family="${FONT}" font-size="11" font-weight="700" class="t3">${s.tag}</text>`)
      lines.forEach((l, i) => parts.push(`<text x="${textX + 56}" y="${cy + i * 19}" dominant-baseline="central" font-family="${FONT}" font-size="12.5" class="${s.isMe ? 't1' : 't2'}">${escapeXml(l)}</text>`))
      y += 6 + lines.length * 19
    }
    if (nodes.length > 1) parts.unshift('') , parts.splice(1, 0, `<line x1="${railX}" y1="${nodes[0]}" x2="${railX}" y2="${nodes[nodes.length - 1]}" class="rule" stroke-width="1.5"/>`)
    void top
    // where the readings parted
    if (c.understood && c.meant) {
      y += 8
      const half = (width - padX * 2 - 10) / 2
      const ul = wrapLines(c.understood, half - 24, 12.5)
      const ml = wrapLines(c.meant, half - 24, 12.5)
      const bh = 30 + Math.max(ul.length, ml.length) * 19
      parts.push(`<rect x="${padX}" y="${y}" width="${half}" height="${bh}" rx="8" class="tile"/>`)
      parts.push(`<rect x="${padX + half + 10}" y="${y}" width="${half}" height="${bh}" rx="8" fill="${c.dot}" fill-opacity="0.1" stroke="${c.dot}" stroke-opacity="0.45"/>`)
      parts.push(`<text x="${padX + 12}" y="${y + 16}" dominant-baseline="central" font-family="${FONT}" font-size="11" font-weight="700" class="t3">Claude가 이해한 것</text>`)
      parts.push(`<text x="${padX + half + 22}" y="${y + 16}" dominant-baseline="central" font-family="${FONT}" font-size="11" font-weight="700" fill="${c.dot}">실제 의도</text>`)
      ul.forEach((l, i) => parts.push(`<text x="${padX + 12}" y="${y + 36 + i * 19}" dominant-baseline="central" font-family="${FONT}" font-size="12.5" class="t2">${escapeXml(l)}</text>`))
      ml.forEach((l, i) => parts.push(`<text x="${padX + half + 22}" y="${y + 36 + i * 19}" dominant-baseline="central" font-family="${FONT}" font-size="12.5" class="t1">${escapeXml(l)}</text>`))
      y += bh
    }
    // the judgment, and the lesson it feeds
    if (c.judgment) {
      y += 12
      const jl = wrapLines(c.judgment, textW - 34, 13)
      parts.push(`<text x="${padX}" y="${y + 9}" dominant-baseline="central" font-family="${FONT}" font-size="11" font-weight="700" class="t3">판단</text>`)
      jl.forEach((l, i) => parts.push(`<text x="${padX + 34}" y="${y + 9 + i * 20}" dominant-baseline="central" font-family="${FONT}" font-size="13" font-weight="600" class="t1">${escapeXml(l)}</text>`))
      y += jl.length * 20
    }
    if (c.lesson) {
      y += 6
      const ll = wrapLines(c.lesson, textW - 34, 12)
      parts.push(`<text x="${padX}" y="${y + 9}" dominant-baseline="central" font-family="${FONT}" font-size="11" font-weight="700" class="t3">교훈</text>`)
      ll.forEach((l, i) => parts.push(`<text x="${padX + 34}" y="${y + 9 + i * 18}" dominant-baseline="central" font-family="${FONT}" font-size="12" class="t2">↳ ${escapeXml(l)}</text>`))
      y += ll.length * 18
    }
    y += 14
  })
  const h = Math.ceil(y)
  return lean({ source: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}"><rect x="0.5" y="0.5" width="${width - 1}" height="${h - 1}" rx="12" class="tile"/>${parts.join('')}</svg>`, width, height: h })
}
