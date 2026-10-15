import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { lineSplitter, pastPromptReader } from './history'

const user = (uuid: string, at: string, cwd: string, content: unknown, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'user', uuid, timestamp: at, sessionId: 's', cwd, message: { role: 'user', content }, ...extra })
const agent = (text: string) => JSON.stringify({ type: 'assistant', uuid: `a-${text.length}`, message: { content: [{ type: 'text', text }] } })

test('past requests are read with the request before and the reply between; engine turns are not', () => {
  const r = pastPromptReader(Date.parse('2026-10-01T00:00:00Z'), Date.parse('2026-10-02T00:00:00Z'))
  const lines = [
    user('u0', '2026-09-30T23:00:00Z', '/p', '전날 요청'),
    agent('전날 답'),
    user('u1', '2026-10-01T01:00:00Z', '/p', '배포 링크 줘'),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }),
    user('t1', '2026-10-01T01:00:10Z', '/p', [{ type: 'tool_result', content: 'ok' }]),
    agent('여기 있어요: http://localhost:3000'),
    user('m1', '2026-10-01T01:00:20Z', '/p', '<command-name>/ani</command-name>'),
    user('x1', '2026-10-01T01:00:30Z', '/p', '서브에이전트 요청', { isSidechain: true }),
    user('u2', '2026-10-01T01:01:00Z', '/p', [{ type: 'text', text: '아니 그건 로컬이잖아' }]),
    'not json',
    user('u3', '2026-10-02T01:00:00Z', '/p', '다음날 요청'),
  ]
  for (const l of lines) r.line(l)
  const got = r.prompts()
  expect(got.map(p => p.text)).toEqual(['배포 링크 줘', '아니 그건 로컬이잖아'])
  expect(got[0].before).toBe('전날 요청')
  expect(got[1].before).toBe('배포 링크 줘')
  expect(got[1].reply).toBe('여기 있어요: http://localhost:3000')
})

test('streamed text is cut into whole lines', () => {
  const s = lineSplitter()
  expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
  expect(s.push(':2}\n')).toEqual(['{"b":2}'])
  expect(s.push('{"c":3}')).toEqual([])
  expect(s.end()).toEqual(['{"c":3}'])
})

const PANE = { plugin: 'jev-steer', component: 'Pane', requestId: 'jev-steer', props: {} as never } as const
const ALPHA_AT = '2026-10-01T01:01:00Z'
const BETA_AT = '2026-10-03T02:01:00Z'
const DISK: Record<string, string> = {
  '/cfg/projects/D--p-alpha/s1.jsonl': [
    user('a1', '2026-10-01T01:00:00Z', 'D:/p/alpha', '배포 링크 줘'),
    agent('여기 있어요: http://localhost:3000'),
    user('a2', ALPHA_AT, 'D:/p/alpha', '아니 그건 로컬이잖아, 배포된 링크 달라고'),
    user('a3', '2026-10-01T01:05:00Z', 'D:/p/alpha', '고마워 다음은 README 정리해줘'),
  ].join('\n'),
  '/cfg/projects/D--p-beta/s2.jsonl': [
    user('b1', '2026-10-03T02:00:00Z', 'D:/p/beta', '데모 주소 알려줘'),
    agent('http://127.0.0.1:5173 에서 보실 수 있어요'),
    user('b2', BETA_AT, 'D:/p/beta', '아니 그건 내 컴퓨터 주소잖아, 배포 주소를 줘'),
  ].join('\n'),
}

/** Past transcripts on disk, Jev and the small model answering beneath the plugin. */
function past(on: Parameters<TestBody>[1], jevDown: (body: string) => boolean = () => false) {
  mock.store(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-14T00:00:00Z') })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg', TYPESAFE_API_KEY: 'test-key' })
  const at = Date.parse('2026-10-05T00:00:00Z')
  const entry = (name: string, kind: 'dir' | 'file') => ({ name, kind, size: 100, mtimeMs: at, isLink: false })
  // Paths may reach the hooks resolved or with backslashes: matched by their tail.
  const tail = (path: string) => path.replace(/\\/g, '/').replace(/^.*?\/cfg\//, '/cfg/')
  on('fs.list', ($, e) => {
    const p = tail((e as { path: string }).path)
    if (p === '/cfg/projects') return { value: [entry('D--p-alpha', 'dir'), entry('D--p-beta', 'dir')] } as never
    const files = Object.keys(DISK).filter(k => k.startsWith(`${p}/`)).map(k => entry(k.slice(p.length + 1), 'file'))
    if (!files.length) throw new Error('ENOENT')
    return { value: files } as never
  })
  on('fs.read', ($, e) => {
    const text = DISK[tail((e as { path: string }).path)]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false } }) as never)
  // Jev: a request is a correction when it starts with 아니; any two judgments are the same mistake.
  on('http.fetch', ($, e) => {
    const raw = String((e as { init?: { body?: string } }).init?.body)
    if (jevDown(raw)) return { value: { status: 503, ok: false, headers: {}, text: '' } } as never
    const body = JSON.parse(raw) as { state: { items?: { user_message: string }[] }; questions: Record<string, unknown> }
    const answers = Object.fromEntries(
      Object.keys(body.questions).map(k => [k, { noul: k.startsWith('h') ? (body.state.items?.[Number(k.slice(1))]?.user_message.startsWith('아니') ? 0.9 : 0.05) : 0.9 }]),
    )
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } } as never
  })
  on('model.complete', () => ({
    value: {
      isAnswered: true,
      text: JSON.stringify({ said: '로컬 말고 배포 주소', understood: '로컬 주소면 된다', meant: '배포된 주소', judgment: '주소를 달라면 배포된 주소를 줘야 했다', intent: '배포된 주소', why: '로컬 주소로 충분하다고 봄', lesson: '주소를 넘길 땐 배포된 주소인지 확인', short: '배포 주소인지 확인' }),
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  return clock
}

test('past conversations become cases, and the same mistake in two projects one lesson candidate', async ($, on) => {
  const clock = past(on)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  await pane.press({ key: 'hist-run' })
  await clock.settle()
  // Two of the five requests were corrections, one in each project.
  expect(await pane.find({ type: 'Text', text: /요청 5개를 보고 교정 2개를 사례로 정리했어요/ })).toBeDefined()
  expect((await pane.find({ key: 'tab-feedback' }))?.text).toMatch(/사례 2/)
  expect(await pane.find({ key: 's-fb-other' })).toBeDefined()
  // Both say the same thing: one candidate, offered for every project, waiting for the person.
  expect((await pane.find({ key: 'tab-lessons' }))?.text).toMatch(/교훈 0 \+1$/)
  await pane.press({ key: 'tab-lessons' })
  expect(await pane.find({ key: 's-cand' })).toBeDefined()
  await pane.press({ key: `ca-C-${Date.parse(BETA_AT)}` })
  expect(await pane.find({ key: 's-cand' })).toBeUndefined()
  expect((await pane.find({ key: 'tab-lessons' }))?.text).toMatch(/교훈 1$/)
  await pane.unmount()
})

test('a run that stopped carries on where it stopped; nothing read is asked about twice', async ($, on) => {
  let asked = 0
  let isDown = true
  // Jev is unreachable the first time beta's requests are asked about.
  const clock = past(on, body => {
    if (body.includes('"items"')) asked++
    return isDown && body.includes('데모 주소')
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  await pane.press({ key: 'hist-run' })
  await clock.settle()
  expect(await pane.find({ type: 'Text', text: /멈췄어요 · Jev에 연결하지 못했어요/ })).toBeDefined()
  expect(asked).toBe(2)
  isDown = false
  await pane.press({ key: 'hist-run' })
  await clock.settle()
  // Only beta is read again; alpha's case is not found twice.
  expect(asked).toBe(3)
  expect(await pane.find({ type: 'Text', text: /요청 5개를 보고 교정 2개를 사례로 정리했어요/ })).toBeDefined()
  expect(await pane.find({ key: 'hist-run' })).toBeUndefined()
  expect((await pane.find({ key: 'tab-feedback' }))?.text).toMatch(/사례 2/)
  await pane.unmount()
})
