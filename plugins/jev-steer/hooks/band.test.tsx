import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { TestBody } from 'claude-code/testing'

// Stand-ins for the engine: a store, and the engine's own drawing.
function engine(on: On, entries?: Record<string, unknown>) {
  mock.store(on, entries)
  mock.clock(on)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    const modes = (e.props as { modes?: readonly string[] }).modes
    return <Text>{modes ? modes.join(' & ') : 'engine'}</Text>
  })
}

/** The source of the first drawn Svg whose alt text matches: an Svg is not found by its key. */
async function sourceOf(ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }, alt: RegExp) {
  return String((await ui.findAll({ type: 'Svg' })).find(s => alt.test(String(s.props.alt ?? '')))?.props.source)
}

/** Whether any drawn Svg's alt text matches: ElementQuery does not match on alt. */
async function hasSvg(ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }, alt: RegExp) {
  return (await ui.findAll({ type: 'Svg' })).some(s => alt.test(String(s.props.alt ?? '')))
}

const ABOVE = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } as never
const PANE = { plugin: 'jev-steer', component: 'Pane', requestId: 'jev-steer', props: {} as never } as const
const card = (over: Record<string, unknown>) => ({
  id: 'J-1', ts: 1, text: '아니 배경만 바꾸라고', kind: 'intent', scope: 'personal-project', project: 'unknown', source: 'jev', keywords: [], ...over,
})

test('terminal: status sits under the prompt on the hint line, after the engine hint', async ($, on) => {
  mock.store(on)
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{(e.props as { hint: string }).hint}</Text>
  })
  const ui = await $.ui.mount({ plugin: 'jev-steer', surface: 'terminal', component: 'PromptHint', props: { hint: '? for shortcuts', isDraft: false, isWorking: false } as never })
  expect(await ui.find({ type: 'Text', text: /\? for shortcuts {2}· {2}ani {2}요청을 보내면 해당되는 교훈 · 규칙을 골라 함께 붙여요 {2}· {2}교훈 0 · 규칙 0/ })).toBeDefined()
  await ui.unmount()
})

test('terminal band stays out of the way when there is nothing to answer', async ($, on) => {
  engine(on)
  const band = await $.ui.mount({ plugin: 'jev-steer', surface: 'terminal', component: 'AbovePrompt', props: ABOVE })
  expect(await band.find({ key: 'b-open' })).toBeUndefined()
  await band.unmount()
})

test('desktop: one buttonless status strip, and the pane can switch the band off', async ($, on) => {
  engine(on)
  const surface = 'desktop'
  const band = await $.ui.mount({ plugin: 'jev-steer', surface, component: 'AbovePrompt', props: ABOVE })
  expect(await band.find({ type: 'Svg' })).toBeDefined()
  expect(await band.find({ key: 'b-open' })).toBeUndefined()
  expect(await band.find({ key: 'b-collapse' })).toBeUndefined()
  await band.unmount()
  const pane = await $.ui.mount({ ...PANE, surface })
  await pane.press({ key: 'tab-settings' })
  await pane.unmount()
  const settings = await $.ui.mount({ ...PANE, surface })
  await settings.press({ key: 'd-band' })
  await settings.unmount()
  const off = await $.ui.mount({ plugin: 'jev-steer', surface, component: 'AbovePrompt', props: ABOVE })
  expect(await off.find({ type: 'Svg' })).toBeUndefined()
  await off.unmount()
})

test('desktop band is one type-set block, not loose text', async ($, on) => {
  engine(on)
  const ui = await $.ui.mount({ plugin: 'jev-steer', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('a lesson reads large with intent and cause beneath it', async ($, on) => {
  engine(on, { cards: [card({ intent: '카드 배경만 어둡게', why: '어둡게를 글자 흐리게로 읽음', lesson: '밝기 요청은 바꿀 속성부터 확인' })] })
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /다음엔 밝기 요청은 바꿀 속성부터 확인/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /의도 {2}카드 배경만 어둡게/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /이유 {2}어둡게를 글자 흐리게로 읽음/ })).toBeDefined()
  await term.unmount()
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ type: 'Svg' })).toBeDefined()
  await desk.unmount()
})

test('the panel groups lessons by scope with capacity, and controls each one', async ($, on) => {
  engine(on, { cards: [card({ id: 'J-1' }), card({ id: 'J-2', scope: 'global' })] })
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /이 프로젝트에만 · 1\/12/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /모든 프로젝트에 · 1\/12/ })).toBeDefined()
  await term.press({ key: 'mv-J-1' })
  expect(await term.find({ type: 'Text', text: /모든 프로젝트에 · 2\/12/ })).toBeDefined()
  await term.press({ key: 'rm-J-2' })
  expect(await term.find({ type: 'Text', text: /모든 프로젝트에 · 1\/12/ })).toBeDefined()
  await term.unmount()

  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ key: 'sc-J-1' })).toBeUndefined()
  await desk.press({ key: 'tab-lessons' })
  await desk.unmount()
  const folded = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await folded.find({ key: 'rm-J-1' })).toBeUndefined()
  await folded.unmount()
  const opened = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await opened.press({ key: 'manage' })
  await opened.unmount()
  const editing = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await editing.press({ key: 'mute-J-1' })
  await editing.unmount()
  const after = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after.find({ text: /켜기/ })).toBeDefined()
  await after.unmount()
})

test('desktop panel: every ladder tab always shows; instructions live under feedback', async ($, on) => {
  engine(on, { cards: [card({ lesson: '밝기 요청은 바꿀 속성부터 확인' })], requirements: [{ id: 'R-1', text: '이미지는 Codex CLI의 Astra로', ts: 1, active: 1, project: 'unknown' }] })
  const first = await $.ui.mount({ ...PANE, surface: 'desktop' })
  for (const k of ['tab-feedback', 'tab-lessons', 'tab-rules', 'tab-principles', 'tab-needs', 'tab-sent', 'tab-settings']) expect(await first.find({ key: k })).toBeDefined()
  await first.press({ key: 'tab-feedback' })
  await first.unmount()
  const rulesTab = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await rulesTab.find({ key: 'rq-rm-R-1' })).toBeUndefined()
  await rulesTab.press({ key: 'manage' })
  await rulesTab.unmount()
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desk.find({ key: 'rq-rm-R-1' })).toBeDefined()
  expect(await desk.find({ key: 'rm-J-1' })).toBeUndefined()
  expect(await desk.find({ key: 'tab-lessons' })).toBeDefined()
  await desk.press({ key: 'rq-rm-R-1' })
  await desk.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await again.find({ key: 'rq-rm-R-1' })).toBeUndefined()
  await again.press({ key: 'tab-lessons' })
  await again.unmount()
  const closed = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await closed.unmount()
  const lessons = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await lessons.find({ key: 'manage' })).toBeDefined()
  expect(await lessons.find({ key: 'rm-J-1' })).toBeDefined()
  await lessons.press({ key: 'manage' })
  await lessons.unmount()
  const done = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await done.find({ key: 'rm-J-1' })).toBeUndefined()
  await done.unmount()
})

test('desktop: a pressed lesson card leaves the band on that press, with no remount', async ($, on) => {
  engine(on, {
    candidates: [{ id: 'C-1', cases: [1, 2], kind: 'intent', scope: 'personal-project', lesson: '배경만 바꾸라면 배경만 바꾼다', short: '배경만 바꾼다' }],
    feedbackLog: [
      { at: 1, text: '아니 배경만 바꾸라고', project: 'unknown' },
      { at: 2, text: '배경만 바꾸라니까', project: 'unknown' },
    ],
  })
  const band = await $.ui.mount({ plugin: 'jev-steer', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
  expect(await band.find({ key: 'c-yes' })).toBeDefined()
  await band.press({ key: 'c-yes' })
  expect(await band.find({ key: 'c-yes' })).toBeUndefined()
  await band.unmount()
})
test('promoting a lesson to a rule clears the card at once (store writes redraw)', async ($, on) => {
  engine(on, { cards: [card({ count: 3, lesson: '위치를 지정받으면 그 자리에 정확히 둔다' })] })
  const band = await $.ui.mount({ plugin: 'jev-steer', surface: 'desktop', component: 'AbovePrompt', props: ABOVE })
  expect(await band.find({ key: 'q-yes' })).toBeDefined()
  await band.press({ key: 'q-yes' })
  expect(await band.find({ key: 'q-yes' })).toBeUndefined()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-rules' })
  expect(await hasSvg(pane, /위치를 지정받으면/)).toBe(true)
  await pane.unmount()
  await band.unmount()
})

test('another project\'s lesson is listed for reference, folded, with its project; 모든 프로젝트로 brings it here', async ($, on) => {
  engine(on, { cards: [card({ id: 'J-9', project: 'me/other', lesson: '위치를 지정받으면 그 자리에 정확히 둔다' })] })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-lessons' })
  // Nothing waits for a decision: no "+", and the reference list starts folded.
  expect((await pane.find({ key: 'tab-lessons' }))?.text).toMatch(/교훈 0$/)
  expect(await hasSvg(pane, /위치를 지정받으면/)).toBe(false)
  await pane.press({ key: 's-ls-other-fold' })
  expect(await hasSvg(pane, /위치를 지정받으면/)).toBe(true)
  expect(await sourceOf(pane, /위치를 지정받으면/)).toContain('other')
  expect(await pane.find({ key: 'gl-J-9' })).toBeUndefined()
  await pane.press({ key: 'manage' })
  await pane.press({ key: 'gl-J-9' })
  expect((await pane.find({ key: 'tab-lessons' }))?.text).toMatch(/교훈 1$/)
  await pane.unmount()
})

test('a requirement with no project yet is listed for reference as 출처 모름, and asks nothing', async ($, on) => {
  engine(on, { requirements: [{ id: 'R-1', text: '0 raw 원문 본문 수정 금지', ts: 1, active: 1 }] })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  expect((await pane.find({ key: 'tab-feedback' }))?.text).toMatch(/사례 0$/)
  await pane.press({ key: 's-rq-other-fold' })
  const listed = await sourceOf(pane, /0 raw 원문/)
  expect(listed).toContain('0 raw 원문 본문 수정 금지')
  expect(listed).toContain('출처 모름')
  expect(await pane.find({ key: 'at-R-1' })).toBeUndefined()
  await pane.unmount()
})

const ANI_FILES: Record<string, string> = {
  '.ani/INDEX.md': [
    '| id | status | scope | keywords | summary | updated |',
    '| --- | --- | --- | --- | --- | --- |',
    '| F-1 | captured | global | hmi | 메뉴바 문제를 제거 허가로 읽음 — 왼쪽 메뉴바는 고정 | 2026-09-07 |',
    '| F-2 | compiled | global | deploy | 로컬만 보고 배포 URL을 넘김 | 2026-09-05 |',
  ].join('\n'),
  '.ani/patterns/F-1.md': '---\nid: F-1\nstatus: captured\ndate: 2026-09-07\nproject: hmi2html\ntrigger_quote: "왼쪽에 메뉴바있어야됨"\nkeywords: [hmi]\nrecurrence: 0\n---\n\n## Intent\n\n왼쪽 메뉴바는 고정이다.\n',
  '.ani/patterns/F-2.md': '---\nid: F-2\nstatus: compiled\ndate: 2026-09-05\nproject: sta_ai_seminar_v2\ntrigger_quote: "배포 링크 404야"\nkeywords: [deploy]\nrecurrence: 0\n---\n',
  '.ani/patterns/S-deploy.md': '---\nid: S-deploy\nstatus: active\ncompiled_from: [F-2]\ndate_compiled: 2026-09-05\nkeywords: [deploy]\nscope: global\nsummary: Use when about to hand the user a deployed URL\n---\n',
}

/** ani's files on disk, answered beneath the plugin whatever the home folder is. */
function aniDisk(on: Parameters<TestBody>[1]) {
  const find = (path: string) => Object.keys(ANI_FILES).find(k => path.replace(/\\/g, '/').endsWith(k))
  on('fs.read', ($, e) => {
    const k = find((e as { path: string }).path)
    if (!k) throw new Error('ENOENT')
    return { value: ANI_FILES[k] } as never
  })
  on('fs.list', ($, e) => {
    if (!(e as { path: string }).path.replace(/\\/g, '/').endsWith('.ani/patterns')) throw new Error('ENOENT')
    return { value: ['F-1.md', 'F-2.md', 'S-deploy.md'].map(name => ({ name, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) } as never
  })
  on('prompt.submit', ($, e) => ({ text: (e as { text: string }).text }) as never)
}

test("ani's records from every project are listed here, each tagged with its project", async ($, on) => {
  mock.store(on)
  const clock = mock.clock(on)
  aniDisk(on)
  on('ui.toast', () => ({ value: undefined }) as never)
  await $.prompt.submit({ text: '아무 요청이나 하나' } as never)
  await clock.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-lessons' })
  // The S is a lesson for every project; hmi2html's F is listed for reference with its project.
  expect(await hasSvg(pane, /Use when about to hand the user a deployed URL/)).toBe(true)
  await pane.press({ key: 's-ls-other-fold' })
  expect(await sourceOf(pane, /메뉴바/)).toContain('hmi2html')
  await pane.press({ key: 'tab-feedback' })
  expect(await pane.find({ key: 's-fb-other' })).toBeDefined()
  expect(await hasSvg(pane, /배포 링크 404야/)).toBe(true)
  await pane.unmount()
  // Forgotten here, it is not brought back by the next request.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await term.press({ key: 'rm-S-deploy' })
  await term.unmount()
  await $.prompt.submit({ text: '두 번째 요청' } as never)
  await clock.settle()
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await again.find({ type: 'Text', text: /deployed URL/ })).toBeUndefined()
  await again.unmount()
})

test('each card keeps its buttons with it, a clear step from the next card', async ($, on) => {
  engine(on, { requirements: [{ id: 'R-1', text: '0 raw 원문 본문 수정 금지', ts: 1, active: 1, project: 'unknown' }, { id: 'R-2', text: '2 Permanent 폴더 수정 금지', ts: 2, active: 1, project: 'unknown', scope: 'global' }] })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  await pane.press({ key: 'manage' })
  type El = { type: string; props: Record<string, unknown> }
  const texts: Record<string, string> = { 'R-1': '0 raw 원문 본문 수정 금지', 'R-2': '2 Permanent 폴더 수정 금지' }
  for (const id of ['R-1', 'R-2']) {
    const item = await pane.find({ key: `mrq-${id}` })
    const [cardEl, row] = (item?.children ?? []) as El[]
    // The card and its own buttons are one group, the buttons right under the card...
    expect(cardEl.type).toBe('Svg')
    expect(String(cardEl.props.alt)).toContain(texts[id])
    const buttons = ((row as El & { children: El[] }).children ?? []).map(b => b.props)
    expect(buttons.map(b => b.label)).toEqual(['이 프로젝트', '모든 프로젝트', '잊기'])
    // ...the one in force is marked...
    expect(buttons.find(b => b.variant === 'primary')?.label).toBe(id === 'R-2' ? '모든 프로젝트' : '이 프로젝트')
    // ...and the next group starts further down than the buttons sit from their card.
    expect(Number(item?.props.marginTop)).toBeGreaterThan(Number(row.props.marginTop))
  }
  await pane.unmount()
})

test("another project's cases are one line each, like lessons: what was said, where, when", async ($, on) => {
  const feedbackLog = [
    { at: 1_000, text: '아니 배포 링크 달라고', cardId: '', project: 'ThingsLikeClaude/stalab-web', said: '배포 링크 대신 로컬 주소를 넘김', before: '배포해줘 요청 맥락', did: 'localhost 주소를 보냄', judgment: '이 상황에서는 배포 주소가 필요했다' },
  ]
  engine(on, { feedbackLog })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  const src = await sourceOf(pane, /배포 링크 대신 로컬 주소/)
  expect(src).toContain('stalab-web')
  // The case's detail stays in the store for Jev and Claude; the list shows none of it.
  expect(src).not.toContain('localhost 주소를 보냄')
  expect(src).not.toContain('배포해줘 요청 맥락')
  expect(src).not.toContain('배포 주소가 필요했다')
  await pane.unmount()
})

test('a long list of cases is drawn in pieces the engine accepts, never one that empties the pane', async ($, on) => {
  const long = '배포 링크를 달라고 했는데 로컬 주소를 넘겼고, 그다음에도 같은 실수를 반복해서 다시 설명해야 했다 '.repeat(4)
  const feedbackLog = Array.from({ length: 60 }, (_, i) => ({
    at: 1_000 + i, text: long, cardId: '', project: 'unknown', said: long, before: long, did: long, understood: long, meant: long, judgment: long,
  }))
  engine(on, { feedbackLog, listLimit: 60 })
  // The engine refuses a pane holding an Svg over its limits: mounting at all is the check.
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  const drawn = (await pane.findAll({ type: 'Svg' })).filter(s => String(s.props.alt).includes('배포 링크'))
  expect(drawn.length).toBeGreaterThan(1)
  for (const s of drawn) {
    expect(String(s.props.source).length).toBeLessThanOrEqual(131_072)
    expect(Number(s.props.height)).toBeLessThanOrEqual(4096)
  }
  await pane.unmount()
})
