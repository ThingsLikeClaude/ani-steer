import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

const lesson = {
  id: 'J-1', ts: 1, text: '아니 배경만 바꾸라고', kind: 'intent', scope: 'personal-project', project: 'unknown', source: 'jev',
  keywords: ['배경', '어둡게'], count: 1, intent: '카드 배경만 어둡게', why: '어둡게를 글자 흐리게로 읽음', lesson: '밝기 요청은 바꿀 속성부터 확인',
}

function jev(on: Parameters<Parameters<typeof test>[1]>[1], answers: Record<string, unknown>) {
  on('http.fetch', () => ({ value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
}

test('a lesson Jev judges to apply rides with the prompt, before Claude answers', async ($, on) => {
  mock.store(on, { cards: [lesson] })
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

test('Jev goes through OpenRouter when its key is set, even with a TypeSafe key', async ($, on) => {
  const sent: { url: string; auth: string; model: string }[] = []
  const world = (env: Record<string, string>) => {
    mock.store(on, { cards: [lesson] })
    mock.clock(on)
    mock.env(on, { HOME: '/tmp', ...env })
    on('http.fetch', ($, e) => {
      const { url, init } = e as { url: string; init?: { body?: string; headers?: Record<string, string> } }
      sent.push({ url, auth: init?.headers?.authorization ?? '', model: (JSON.parse(String(init?.body)) as { model: string }).model })
      return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: { is_correction: { noul: 0.05 } } }) } } as never
    })
    on('ui.toast', () => ({ value: undefined }) as never)
    on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  }
  world({ OPENROUTER_API_KEY: 'sk-or-test', TYPESAFE_API_KEY: 'ts-test' })
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' } as never)
  expect(sent[0]).toEqual({ url: 'https://openrouter.ai/api/v1/systemone', auth: 'Bearer sk-or-test', model: '~typesafe/jev-latest' })
})

test('with only the TypeSafe key, Jev is reached at TypeSafe', async ($, on) => {
  let sent = { url: '', model: '' }
  mock.store(on, { cards: [lesson] })
  mock.clock(on)
  mock.env(on, { HOME: '/tmp', TYPESAFE_API_KEY: 'ts-test' })
  on('http.fetch', ($, e) => {
    const { url, init } = e as { url: string; init?: { body?: string } }
    sent = { url, model: (JSON.parse(String(init?.body)) as { model: string }).model }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers: { is_correction: { noul: 0.05 } } }) } } as never
  })
  on('ui.toast', () => ({ value: undefined }) as never)
  on('prompt.submit', ($, e) => ({ text: e.text }) as never)
  await $.prompt.submit({ text: '다크모드 카드 배경 좀 어둡게 해줘' } as never)
  expect(sent).toEqual({ url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' })
})
