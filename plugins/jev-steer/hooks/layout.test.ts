import { expect, test } from 'claude-code/testing'

import { caseCardSvg, detailSvg, leadStripSvg, listCardSvg, textWidth, titleRowSvg } from './ui'

// Layout lint: nothing is cut with an ellipsis, and no text runs past its
// image's right edge (estimated with the same width table the layout uses).
function lint(svg: { source: string; width: number }) {
  expect(svg.source).not.toContain('…')
  for (const m of svg.source.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)) {
    const [, attrs, text] = m
    if (/text-anchor="(end|middle)"/.test(attrs)) continue
    const x = Number(/\bx="([\d.]+)"/.exec(attrs)?.[1] ?? 0)
    const size = Number(/font-size="([\d.]+)"/.exec(attrs)?.[1] ?? 11)
    expect(x + textWidth(text) * (size / 11)).toBeLessThanOrEqual(svg.width + 1)
  }
}

const LONG = 'UI 레이아웃 수정 시 세로 중앙정렬 여부를 먼저 확인하고, 버튼과 텍스트가 같은 축에 오도록 맞춘다'

test('strip: a long lesson wraps inside its block instead of being cut', () => {
  for (const w of [360, 520, 900]) {
    lint(leadStripSvg(w, { label: '새 교훈으로 기억했어요', quote: LONG, color: '#8b7cf6' }, true, 'live'))
    lint(leadStripSvg(w, { label: '방금 보낸 요청에 교훈 2개를 붙였어요', quote: LONG, color: '#3a9d63' }, false, 'live'))
  }
})

test('panel rows: titles and detail wrap within their column', () => {
  for (const w of [320, 480]) {
    lint(titleRowSvg(w, { title: LONG, textWidth: w - 170, cols: [{ x: w - 150, text: '이 프로젝트' }, { x: w - 8, text: '2회', anchor: 'end' }] }))
    const d = detailSvg(w, { textWidth: w - 170, lines: [{ label: '원했던 것', value: LONG }, { label: '틀린 이유', value: LONG }], meta: [{ text: '이번 세션' }] })
    if (d) lint(d)
  }
})

test('strip: the 다음엔 line is one line or absent, never wrapped', () => {
  for (const w of [360, 700]) {
    const short = leadStripSvg(w, { label: '이것도 적용할까요?', quote: 'UI는 위계부터 정하기', color: '#8b7cf6' }, true, 'live')
    expect((short.source.match(/class="t1">UI는/g) ?? []).length).toBe(1)
    const long = leadStripSvg(w, { label: '이것도 적용할까요?', quote: LONG, color: '#8b7cf6' }, true, 'live')
    expect(long.height).toBeLessThanOrEqual(56)
  }
})

test('list card: a long project name ends in … before the pill, and the title stops before the name', () => {
  for (const width of [822, 520, 380]) {
    const sv = listCardSvg(width, [{ dot: '#8a8a8a', title: LONG, scope: 'deep_twin-doom-orchestrator-v2', pill: { text: '다른 프로젝트', color: '#f5873a' } }], '#f5873a')
    const texts = [...sv.source.matchAll(/<text ([^>]*)>([^<]*)<\/text>/g)]
    const xOf = (attrs: string) => Number(/\bx="([\d.]+)"/.exec(attrs)?.[1])
    const scope = texts.find(m => m[2].startsWith('deep_twin'))
    const pillX = Number(/<rect x="([\d.]+)" y="[\d.]+" width="[\d.]+" height="22"/.exec(sv.source)?.[1])
    expect(scope?.[2]).toMatch(/…$/)
    expect(xOf(scope?.[1] ?? '') + textWidth(scope?.[2] ?? '') * (12 / 11)).toBeLessThan(pillX)
    for (const m of texts.filter(t => /font-size="13.5"/.test(t[1]))) expect(xOf(m[1]) + textWidth(m[2]) * (13.5 / 11)).toBeLessThan(xOf(scope?.[1] ?? ''))
  }
})

test('case and list cards name their font once, not on every text: half of what is carried to the screen', () => {
  const cs = caseCardSvg(554, [{ dot: '#8a8a8a', said: '배포 링크 달라고', when: 'dashboard · 9월 7일', before: '배포 링크 줘', did: '로컬 주소를 줌', judgment: '배포 주소를 줘야 했다' }])
  const ls = listCardSvg(554, [{ dot: '#8a8a8a', title: LONG, scope: 'dashboard', pill: { text: '다른 프로젝트', color: '#f5873a' } }])
  for (const sv of [cs, ls]) {
    expect(sv.source.match(/font-family/g)?.length).toBe(1)
    expect(sv.source).toContain('<style>text{font-family:')
  }
})
