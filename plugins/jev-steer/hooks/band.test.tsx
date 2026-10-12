import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

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
  engine(on, { cards: [card({ lesson: '밝기 요청은 바꿀 속성부터 확인' })], requirements: [{ id: 'R-1', text: '이미지는 Codex CLI의 Astra로', ts: 1, active: 1 }] })
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
