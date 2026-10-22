import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const lesson = {
  id: 'J-1', ts: 1, text: '아니 배경만 바꾸라고', kind: 'intent', scope: 'personal-project', project: 'unknown', source: 'jev',
  keywords: ['배경', '어둡게'], count: 1, intent: '카드 배경만 어둡게', why: '어둡게를 글자 흐리게로 읽음', lesson: '밝기 요청은 바꿀 속성부터 확인',
}
/** The same card promoted: attaching starts at the rule layer. */
const asRule = { ...lesson, isRule: true, count: 3 }

function jev(on: Parameters<Parameters<typeof test>[1]>[1], answers: Record<string, unknown>) {
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
}

test('a rule Jev judges to apply rides with the prompt, before Claude answers', async ($, on) => {
  mock.store(on, { cards: [asRule] })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  jev(on, { is_correction: { noul: 0.05 }, has_requirement: { noul: 0.1 }, c0_same: { noul: 0.9 }, c0_satisfy: { noul: 0.9 }, c0_flip: { noul: 0.05 } })
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' })
  expect(context?.join('\n')).toContain('밝기 요청은 바꿀 속성부터 확인')
  expect(context?.join('\n')).toContain('카드 배경만 어둡게')
})

test('nothing rides along when no lesson applies', async ($, on) => {
  mock.store(on, { cards: [lesson] })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  jev(on, { is_correction: { noul: 0.05 }, has_requirement: { noul: 0.1 }, c0_same: { noul: 0.1 } })
  let context: readonly string[] | undefined = ['unset']
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' })
  expect(context ?? []).toEqual([])
})

const otherReq = { id: 'R-1', text: 'src/generated는 수정 금지', ts: 1, active: 1, project: 'me/other' }

async function sendWith($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], requirements: unknown[]) {
  mock.store(on, { requirements })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  jev(on, { is_correction: { noul: 0.05 }, has_requirement: { noul: 0.1 }, r0_active: { noul: 0.9 }, r0_relevant: { noul: 0.9 }, r1_active: { noul: 0.9 }, r1_relevant: { noul: 0.9 } })
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: 'src/generated 폴더 정리해줘' } as never)
  return (context ?? []).join('\n')
}

test("this project's requirement rides; another project's does not while undecided", async ($, on) => {
  const ownReq = { id: 'R-2', text: 'src/generated 정리는 스크립트로만', ts: 2, active: 1, project: 'unknown' }
  const sent = await sendWith($, on, [otherReq, ownReq])
  expect(sent).toContain('src/generated 정리는 스크립트로만')
  expect(sent).not.toContain('src/generated는 수정 금지')
})

test("another project's requirement rides here once attached", async ($, on) => {
  expect(await sendWith($, on, [{ ...otherReq, alsoIn: ['unknown'] }])).toContain('src/generated는 수정 금지')
})

const PANE = { plugin: 'jev-steer', component: 'Pane', requestId: 'jev-steer', props: {} as never } as const

/** Jev calls every prompt a correction holding a requirement; returns how often the small model was asked. */
async function sendAsPerson($: Parameters<TestBody>[0], on: Parameters<TestBody>[1], text: string) {
  mock.store(on, {})
  const clock = mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  jev(on, { is_correction: { noul: 0.9 }, has_requirement: { noul: 0.9 } })
  let asked = 0
  on('model.complete', () => {
    asked++
    return { value: { isAnswered: false, reason: 'offline' } } as never
  })
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  await $.prompt.submit({ text, asUser: true } as never)
  await clock.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const cases = (await pane.find({ key: 'tab-feedback' }))?.text
  await pane.unmount()
  return { asked, cases }
}

test("the person's correction is recorded as a case", async ($, on) => {
  const { cases } = await sendAsPerson($, on, '아니 배경만 바꾸라고 했잖아')
  expect(cases).toMatch(/사례 1/)
})

test("an app helper's role prompt is not the person's: no case, no requirement", async ($, on) => {
  const { asked, cases } = await sendAsPerson($, on, 'You are a commit message generator. Write one line. 타입은 항상 WIP')
  expect(cases).toMatch(/사례 0/)
  expect(asked).toBe(0)
})

test("an app's notice in the person's turn is not recorded", async ($, on) => {
  const { cases } = await sendAsPerson($, on, '<system-reminder>The user started your suggested background task.</system-reminder>')
  expect(cases).toMatch(/사례 0/)
})

const rule = (n: number, lesson: string) => ({ id: `J-r${n}`, ts: n, text: lesson, kind: 'intent', scope: 'global', project: '', source: 'jev', keywords: [], count: 3, isRule: true, lesson })

test('Jev weighs rules too: only those bearing on the request ride, three at most; principles always ride', async ($, on) => {
  const commitRules = [1, 2, 3, 4, 5].map(n => rule(n, `커밋 규칙 ${n}번: 메시지는 한국어로`))
  mock.store(on, {
    cards: [...commitRules, rule(6, '배포 주소는 직접 열어 보고 넘긴다')],
    principles: [{ id: 'P-1', text: '사용자가 정한 범위를 넘지 않는다', from: [], status: 'active', ts: 1 }],
  })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  // Jev: a rule bears on this request when it is about commits.
  on('http.fetch', ($, e) => {
    const body = JSON.parse(String((e as { init?: { body?: string } }).init?.body)) as { questions: Record<string, { instructions?: string }> }
    const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, { noul: /_same$/.test(k) ? (q.instructions?.includes('커밋') ? 0.9 : 0.1) : /_flip$/.test(k) ? 0.05 : 0.05 }]))
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: '지금까지 바꾼 거 커밋해줘' } as never)
  const sent = (context ?? []).join('\n')
  expect(sent.match(/커밋 규칙/g)?.length).toBe(3)
  expect(sent).not.toContain('배포 주소는 직접 열어')
  expect(sent).not.toContain('Rules (always)')
  expect(sent).toContain('사용자가 정한 범위를 넘지 않는다')
})

test('the rules that rode the last request head the rules tab, above every other rule', async ($, on) => {
  // Many rules; the two that bear on this request are stored last.
  const others = Array.from({ length: 12 }, (_, i) => rule(i + 1, `배포 규칙 ${i + 1}번: 주소는 직접 열어 본다`))
  mock.store(on, { cards: [...others, rule(20, '커밋 메시지는 한국어로 쓴다'), rule(21, '커밋 전에 테스트를 돌린다')] })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  on('http.fetch', ($, e) => {
    const body = JSON.parse(String((e as { init?: { body?: string } }).init?.body)) as { questions: Record<string, { instructions?: string }> }
    const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, { noul: /_same$/.test(k) ? (q.instructions?.includes('커밋') ? 0.9 : 0.1) : 0.05 }]))
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  await $.prompt.submit({ text: '지금까지 바꾼 거 커밋해줘' } as never)
  const pane = await $.ui.mount({ plugin: 'jev-steer', surface: 'terminal', component: 'Pane', requestId: 'jev-steer', props: {} as never })
  await pane.press({ key: 'tab-rules' })
  const shown = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  const at = (s: string) => shown.indexOf(s)
  expect(at('이번 요청에 붙인 규칙')).toBeGreaterThan(-1)
  expect(at('커밋 메시지는 한국어로')).toBeGreaterThan(at('이번 요청에 붙인 규칙'))
  expect(at('커밋 전에 테스트를')).toBeGreaterThan(at('이번 요청에 붙인 규칙'))
  // Every other rule is listed after both, under its own label.
  expect(at('그 밖의 규칙')).toBeGreaterThan(Math.max(at('커밋 메시지는 한국어로'), at('커밋 전에 테스트를')))
  expect(at('배포 규칙 1번')).toBeGreaterThan(at('그 밖의 규칙'))
  await pane.unmount()
})

test('a rule that does not bear on the request stays home', async ($, on) => {
  mock.store(on, { cards: [rule(1, '배포 주소는 직접 열어 보고 넘긴다')] })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  jev(on, { is_correction: { noul: 0.05 }, has_requirement: { noul: 0.1 }, c0_same: { noul: 0.1 } })
  let context: readonly string[] | undefined = ['unset']
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: 'README 오타 고쳐줘' } as never)
  expect(context ?? []).toEqual([])
})

/** Jev answering at whichever service is asked; each call's service, key and model recorded. */
function routed(on: Parameters<TestBody>[1], env: Record<string, string>, refuse: (url: string) => number = () => 0) {
  const sent: { url: string; auth: string; model: string }[] = []
  mock.store(on, { cards: [asRule] })
  mock.clock(on)
  mock.env(on, { HOME: '/tmp', ...env })
  on('http.fetch', ($, e) => {
    const { url, init } = e as { url: string; init?: { body?: string; headers?: Record<string, string> } }
    sent.push({ url, auth: init?.headers?.authorization ?? '', model: (JSON.parse(String(init?.body)) as { model: string }).model })
    const status = refuse(url)
    if (status) return { value: { status, ok: false, headers: {}, text: '' } } as never
    const answers = { is_correction: { noul: 0.05 }, has_requirement: { noul: 0.1 }, c0_same: { noul: 0.9 }, c0_satisfy: { noul: 0.9 }, c0_flip: { noul: 0.05 } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  return { sent, context: () => (context ?? []).join('\n') }
}

const TYPESAFE = { url: 'https://api.typesafe.ai/v1/systemone', auth: 'Bearer ts-test', model: 'jev-latest' }
const OPENROUTER = { url: 'https://openrouter.ai/api/v1/systemone', auth: 'Bearer sk-or-test', model: '~typesafe/jev-latest' }

test("a request's own judging goes to TypeSafe first: the faster line, with both keys set", async ($, on) => {
  const w = routed(on, { OPENROUTER_API_KEY: 'sk-or-test', TYPESAFE_API_KEY: 'ts-test' })
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' } as never)
  expect(w.sent[0]).toEqual(TYPESAFE)
  expect(w.context()).toContain('밝기 요청은 바꿀 속성부터 확인')
})

test('when TypeSafe refuses (an empty balance), the request is judged through OpenRouter', async ($, on) => {
  const w = routed(on, { OPENROUTER_API_KEY: 'sk-or-test', TYPESAFE_API_KEY: 'ts-test' }, url => (url.includes('typesafe.ai') ? 402 : 0))
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' } as never)
  expect(w.sent).toEqual([TYPESAFE, OPENROUTER])
  expect(w.context()).toContain('밝기 요청은 바꿀 속성부터 확인')
})

test('with one key, every call goes where that key reaches', async ($, on) => {
  const w = routed(on, { OPENROUTER_API_KEY: 'sk-or-test' })
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' } as never)
  expect(w.sent[0]).toEqual(OPENROUTER)
})

test("no lesson rides, the person's or the AI's, even when Jev would say it applies; Jev is not even asked", async ($, on) => {
  mock.store(on, { cards: [lesson, { ...lesson, id: 'J-2', isAuto: true }] })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  on('ui.toast', () => ({ value: undefined }) as never)
  let asked = ''
  on('http.fetch', ($, e) => {
    asked += String((e as { init?: { body?: string } }).init?.body ?? '')
    const answers = { is_correction: { noul: 0.05 }, has_requirement: { noul: 0.1 }, c0_same: { noul: 0.9 }, c0_satisfy: { noul: 0.9 }, c0_flip: { noul: 0.05 } }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } } as never
  })
  let context: readonly string[] | undefined
  on('prompt.submit', ($, e) => {
    context = e.context
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' } as never)
  expect((context ?? []).join('\n')).not.toContain('밝기 요청은 바꿀 속성부터 확인')
  expect((context ?? []).join('\n')).not.toContain('Lessons:')
  expect(asked).not.toContain('밝기 요청은 바꿀 속성부터 확인')
})

test('what an app, a script or the engine sent is not judged: no Jev call, nothing rides it', async ($, on) => {
  mock.store(on, { cards: [asRule] })
  mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/tmp' })
  let calls = 0
  on('http.fetch', () => {
    calls++
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: { c0_same: { noul: 0.9 }, c0_satisfy: { noul: 0.9 }, c0_flip: { noul: 0.05 } } }) } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', ($, e) => {
    contexts.push(e.context)
    return { text: e.text } as never
  })
  await $.prompt.submit({ text: 'You are a commit message generator. Based on the following git diff, write a single commit message. 다크모드 카드 배경' } as never)
  await $.prompt.submit({ text: '<task-notification><task-id>b1</task-id>다크모드 카드 배경 작업이 끝났어요</task-notification>', origin: { kind: 'task-notification' } } as never)
  await $.prompt.submit({ text: '<system-reminder>Linked sessions now: 다크모드 카드 배경</system-reminder>' } as never)
  expect(calls).toBe(0)
  expect(contexts.every(c => !(c ?? []).join('\n').includes('밝기 요청은 바꿀 속성부터 확인'))).toBe(true)
  // The person's own request is judged as before.
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' } as never)
  expect(calls).toBe(1)
  expect((contexts.at(-1) ?? []).join('\n')).toContain('밝기 요청은 바꿀 속성부터 확인')
})

test('cases leave the store for a file of their own once; a case another session wrote there is kept', async ($, on) => {
  // The store and the disk, in memory: each write moves the file's time on.
  const box = new Map<string, unknown>([['feedbackLog', [
    { at: 10, text: '아니 그거 말고', project: 'unknown' },
    { at: 20, text: '다시 해줘', project: 'unknown' },
  ]]])
  on('store.get', ($, e) => ({ value: box.has(e.key) ? structuredClone(box.get(e.key)) : undefined }) as never)
  on('store.set', ($, e) => {
    box.set(e.key, structuredClone(e.value))
    return { value: undefined } as never
  })
  on('store.delete', ($, e) => {
    box.delete(e.key)
    return { value: undefined } as never
  })
  on('store.keys', () => ({ value: [...box.keys()] }) as never)
  const disk = new Map<string, { text: string; mtimeMs: number }>()
  let tick = 1
  const at = (p: string) => p.split('\\').join('/')
  on('fs.exists', ($, e) => ({ value: disk.has(at(e.path)) }) as never)
  on('fs.stat', ($, e) => {
    const f = disk.get(at(e.path))
    if (!f) throw new Error('ENOENT')
    return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } } as never
  })
  on('fs.read', ($, e) => {
    const f = disk.get(at(e.path))
    if (!f) throw new Error('ENOENT')
    return { value: f.text } as never
  })
  on('fs.write', ($, e) => {
    disk.set(at(e.path), { text: e.text, mtimeMs: ++tick })
    return { value: undefined } as never
  })
  const clock = mock.clock(on)
  mock.env(on, { TYPESAFE_API_KEY: 'test-key', HOME: '/home/p' })
  jev(on, { is_correction: { noul: 0.9 }, has_requirement: { noul: 0.1 } })
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'offline' } }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  // The host makes the path absolute (on Windows it gains a drive).
  const FILE = () => [...disk.keys()].find(k => k.endsWith('/home/p/.claude/plugins/data/jev-steer/cases.json')) ?? ''
  const casesOn = () => JSON.parse(disk.get(FILE())?.text ?? '[]') as { at: number; text: string }[]

  // The first read moves them, and the store lets them go.
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.unmount()
  await clock.settle()
  expect(casesOn().map(f => f.at).sort()).toEqual([10, 20])
  expect(box.has('feedbackLog')).toBe(false)

  // Another session writes a case; this one records its own a moment later.
  disk.set(FILE(), { text: JSON.stringify([{ at: 30, text: '다른 세션의 교정', project: 'unknown' }, ...casesOn()]), mtimeMs: ++tick })
  await clock.advance(6000)
  await $.prompt.submit({ text: '아니 배경만 바꾸라고 했잖아', asUser: true } as never)
  await clock.settle()
  const after = casesOn()
  expect(after.some(f => f.at === 30)).toBe(true)
  expect(after.some(f => f.text.includes('배경만'))).toBe(true)
  expect(after).toHaveLength(4)
  expect(box.has('feedbackLog')).toBe(false)
})
