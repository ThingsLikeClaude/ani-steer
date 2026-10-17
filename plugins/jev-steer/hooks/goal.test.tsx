import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = { plugin: 'jev-steer', component: 'Pane', requestId: 'jev-steer', props: {} as never } as const
const principle = (n: number) => ({ id: `P-${n}`, text: `원칙 ${n}번`, from: [], status: 'active', ts: n })
const SIX = [1, 2, 3, 4, 5, 6].map(principle)

/** The plugin's store, kept where the test can read it as JSON would keep it. */
function storeOf(on: On, entries: Record<string, unknown> = {}) {
  const kept = new Map<string, unknown>(Object.entries(entries).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]))
  on('store.get', ($, e) => ({ value: kept.get((e as { key: string }).key) }) as never)
  on('store.set', ($, e) => {
    const { key, value } = e as { key: string; value: unknown }
    kept.set(key, JSON.parse(JSON.stringify(value ?? null)))
    return { value: undefined } as never
  })
  on('store.delete', ($, e) => (kept.delete((e as { key: string }).key), { value: undefined }) as never)
  on('store.keys', () => ({ value: [...kept.keys()] }) as never)
  return kept
}

/** Haiku's reply to each prompt, picked by what the prompt asks for. */
function haiku(on: On, replies: { goals?: string[]; needs?: string[] }) {
  on('model.complete', ($, e) => {
    const system = String((e as { system?: string }).system ?? '')
    const list = system.includes('한 단계 위의 목표') ? replies.goals : system.includes('한 단계 더 아래의 가치') ? replies.needs : undefined
    return { value: list ? { isAnswered: true, text: JSON.stringify(list.map(text => ({ text }))) } : { isAnswered: false, reason: 'api-error' } } as never
  })
}

/** Jev answers every question with `score(key, instructions)`. */
function jev(on: On, score: (key: string, instructions: string) => number) {
  on('http.fetch', ($, e) => {
    const body = JSON.parse(String((e as { init?: { body?: string } }).init?.body)) as { questions: Record<string, { instructions?: string }> }
    const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, { noul: score(k, q.instructions ?? '') }]))
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
}

test('a goal is kept only when most principles serve it and it is not one of them said again', async ($, on) => {
  const store = storeOf(on, { principles: SIX })
  const clock = mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'ts-test', HOME: '/tmp' })
  haiku(on, { goals: ['맡긴 일이 내 의도대로 끝났으면 좋겠어', '원칙 1번을 지켰으면 좋겠어', '빨리 끝났으면 좋겠어'] })
  // g0: all six serve it. g1: all six, but it is principle 1 said again. g2: only two serve it.
  jev(on, (k) => (/^g1_same$/.test(k) ? 0.9 : /_same$/.test(k) ? 0.1 : /^g2_p[2-5]$/.test(k) ? 0.1 : 0.9))
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-goals' })
  await pane.press({ key: 'gl-run' })
  await pane.unmount()
  await clock.settle()
  const goals = store.get('goals') as { text: string; covers: number; of: number; status: string }[]
  expect(goals.map(g => g.text)).toEqual(['맡긴 일이 내 의도대로 끝났으면 좋겠어'])
  expect(goals[0]).toMatchObject({ covers: 6, of: 6, status: 'hypothesis' })
  // A candidate does not ride; only a confirmed goal does.
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /^원칙 6\/6$/ })).toBeDefined()
  await term.unmount()
})

test('confirming a goal reads needs beneath it; several needs hold, the first is the largest, and the mark can move', async ($, on) => {
  const store = storeOf(on, { principles: SIX, goals: [{ id: 'G-1', text: '맡긴 일이 내 의도대로 끝났으면 좋겠어', from: SIX.map(p => p.id), covers: 6, of: 6, status: 'hypothesis', ts: 1 }] })
  const clock = mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'ts-test', HOME: '/tmp' })
  haiku(on, { needs: ['내 시간과 주의를 내가 정한 일에 쓰고 싶어', '남들보다 뛰어남을 증명하고 싶어', '맡긴 일이 의도대로 끝나면 좋겠어'] })
  // The third is the goal said again.
  jev(on, (k) => (k === 'n2_same' ? 0.9 : /_same$/.test(k) ? 0.1 : 0.8))
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-goals' })
  await pane.press({ key: 'gy-G-1' })
  await pane.unmount()
  await clock.settle()
  const hyps = (store.get('needs') as { id: string; text: string; status: string }[]).filter(n => n.status === 'hypothesis')
  expect(hyps.map(n => n.text)).toEqual(['내 시간과 주의를 내가 정한 일에 쓰고 싶어', '남들보다 뛰어남을 증명하고 싶어'])
  const view = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await view.press({ key: 'tab-needs' })
  await view.press({ key: `ny-${hyps[0].id}` })
  await view.press({ key: `ny-${hyps[1].id}` })
  await view.unmount()
  await clock.settle()
  let needs = store.get('needs') as { id: string; status: string; isMain?: boolean; from: string[] }[]
  expect(needs.filter(n => n.status === 'confirmed').length).toBe(2)
  expect(needs.find(n => n.id === hyps[0].id)?.isMain).toBe(true)
  // Jev links each confirmed need to the goal and principles that serve it.
  expect(needs.find(n => n.id === hyps[0].id)?.from).toContain('G-1')
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await again.press({ key: `nm-${hyps[1].id}` })
  await again.unmount()
  needs = store.get('needs') as typeof needs
  expect(needs.find(n => n.id === hyps[1].id)?.isMain).toBe(true)
  expect(needs.find(n => n.id === hyps[0].id)?.isMain).toBe(false)
})

test("the person's own words add a need without setting the others aside", async ($, on) => {
  const store = storeOf(on, { needs: [{ id: 'N-1', text: '내 시간을 지키고 싶어', from: [], status: 'confirmed', isMain: true, ts: 1 }] })
  const clock = mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'ts-test', HOME: '/tmp' })
  jev(on, () => 0.05)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  await $.prompt.submit({ text: '근원 욕구: 남들보다 뛰어남을 증명하고 싶어' } as never)
  await clock.settle()
  const needs = store.get('needs') as { text: string; status: string; isMain?: boolean }[]
  expect(needs.filter(n => n.status === 'confirmed').map(n => n.text)).toEqual(['내 시간을 지키고 싶어', '남들보다 뛰어남을 증명하고 싶어'])
  expect(needs.find(n => n.text === '내 시간을 지키고 싶어')?.isMain).toBe(true)
})

test('a confirmed goal and the confirmed needs ride the request, the largest need first; candidates do not', async ($, on) => {
  mock.store(on, {
    principles: [principle(1)],
    goals: [
      { id: 'G-1', text: '맡긴 일이 내 의도대로 끝났으면 좋겠어', from: ['P-1'], covers: 1, of: 1, status: 'confirmed', ts: 1 },
      { id: 'G-2', text: '후보일 뿐인 목표', from: [], covers: 1, of: 1, status: 'hypothesis', ts: 2 },
    ],
    needs: [
      { id: 'N-1', text: '내 시간을 지키고 싶어', from: [], status: 'confirmed', ts: 5 },
      { id: 'N-2', text: '남들보다 뛰어남을 증명하고 싶어', from: [], status: 'confirmed', isMain: true, ts: 1 },
      { id: 'N-3', text: '후보일 뿐인 욕구', from: [], status: 'hypothesis', ts: 6 },
    ],
  })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'ts-test', HOME: '/tmp' })
  jev(on, () => 0.05)
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: '이 화면 정리해줘' } as never)
  const sent = (context ?? []).join('\n')
  expect(sent).toContain('What this user is after when working with an AI: 맡긴 일이 내 의도대로 끝났으면 좋겠어')
  expect(sent).toContain('남들보다 뛰어남을 증명하고 싶어 / 내 시간을 지키고 싶어')
  expect(sent).not.toContain('후보일 뿐인')
})
