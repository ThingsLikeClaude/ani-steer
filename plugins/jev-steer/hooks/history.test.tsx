import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { isPersonOrigin, lineSplitter, pastPromptReader, personText } from './history'

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

const T = (minute: number) => `2026-10-01T01:${String(minute).padStart(2, '0')}:00Z`

test('a past request carries the conversation around it; what the person did not type is left out', () => {
  const r = pastPromptReader(0)
  const edit = JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'D:\\p\\src\\app.tsx', old_string: 'x' } }] } })
  const lines = [
    user('u1', T(0), '/p', '카드 배경 어둡게'),
    agent('글자를 흐리게 했어요'),
    user('u2', T(1), '/p', '버튼도 둥글게'),
    edit,
    agent('둥글게 했어요'),
    user('s1', T(2), '/p', '<scheduled-task name="nightly">매일 정리해</scheduled-task>'),
    user('g1', T(3), '/p', 'You are a commit message generator. Write one line.'),
    user('u3', T(4), '/p', '<!-- attach: 터미널 | tab:0 -->\n> PS C:\\> npm test\n> 1 failed\n\n아니 배경이라니까, 글자 말고'),
    agent('배경을 바꿨어요'),
    user('u4', T(5), '/p', '좋아'),
    user('u5', T(6), '/p', '다음은 README'),
  ]
  for (const l of lines) r.line(l)
  const got = r.prompts()
  expect(got.map(p => p.text)).toEqual(['카드 배경 어둡게', '버튼도 둥글게', '아니 배경이라니까, 글자 말고', '좋아', '다음은 README'])
  const c = got[2]!
  expect(c.earlier).toEqual(['카드 배경 어둡게', '버튼도 둥글게'])
  expect(c.tools).toEqual(['Edit src/app.tsx'])
  expect(c.reply).toBe('둥글게 했어요')
  expect(c.next).toBe('배경을 바꿨어요')
  expect(c.after).toEqual(['좋아', '다음은 README'])
})

test("a file stops being read once the rest can give nothing: a tool's session at once, a past window once its last request has what follows", () => {
  const observer = pastPromptReader(0)
  observer.line(user('o1', T(0), 'C:\\Users\\me\\.claude-mem\\observer', '세션 요약해줘'))
  expect(observer.over()).toBe('agent')
  const scripted = pastPromptReader(0)
  scripted.line(user('s1', T(0), '/p', '정리해줘', { entrypoint: 'sdk-cli' }))
  expect(scripted.over()).toBe('agent')
  // The window ends at minute 5: the request at minute 4 still gets the two requests after it.
  const r = pastPromptReader(0, Date.parse(T(5)))
  r.line(user('p1', T(4), '/p', '아니 그거 말고 푸터'))
  r.line(agent('푸터를 고쳤어요'))
  r.line(user('p2', T(6), '/p', '좋아 다음은 헤더'))
  expect(r.over()).toBe('')
  r.line(user('p3', T(7), '/p', '헤더 색만'))
  expect(r.over()).toBe('past')
  expect(r.prompts().map(p => [p.text, p.after])).toEqual([['아니 그거 말고 푸터', ['좋아 다음은 헤더', '헤더 색만']]])
  // A session that began after the window gives nothing from its first line.
  const later = pastPromptReader(0, Date.parse(T(5)))
  later.line(user('l1', T(9), '/p', '아니 그거 말고'))
  expect(later.over()).toBe('past')
  expect(later.prompts()).toEqual([])
})

test("a session another program started, or a tool's own workspace, is never the person's", () => {
  const scripted = pastPromptReader(0)
  scripted.line(user('x1', T(0), '/p', '아니 그거 말고 다시', { entrypoint: 'sdk-cli' }))
  expect(scripted.prompts()).toEqual([])
  const observer = pastPromptReader(0)
  observer.line(user('x2', T(0), 'C:\\Users\\me\\.claude-mem\\observer', '아니 그거 말고 다시'))
  expect(observer.prompts()).toEqual([])
  // The transcript names who sent a turn: another session's or a coordinator's words are not the person's, in any language.
  const sent = pastPromptReader(0)
  sent.line(user('x3', T(0), '/p', 'Fix the header so it matches the design', { origin: { kind: 'coordinator' } }))
  sent.line(user('x4', T(1), '/p', '아니 그거 말고 다시', { origin: { kind: 'peer' } }))
  sent.line(user('x5', T(2), '/p', '아니 헤더 말고 푸터', { origin: { kind: 'human' } }))
  expect(sent.prompts().map(p => p.text)).toEqual(['아니 헤더 말고 푸터'])
  // Read for where things were said: queued deliveries are found too, marked as not typed.
  const all = pastPromptReader(0, Infinity, false)
  all.line(user('t1', T(0), '/p', '아니 그거 말고'))
  all.line(JSON.stringify({ type: 'queue-operation', operation: 'remove', timestamp: T(1), sessionId: 's', content: '<ci-monitor-event>CI failed</ci-monitor-event>' }))
  all.line(user('t2', T(2), '/p', '<scheduled-task name="n">정리</scheduled-task>'))
  expect(all.prompts().map(p => [p.isTyped, p.cwd])).toEqual([[true, '/p'], [false, '/p'], [false, '/p']])
})

test('a prompt from a schedule, a notice, another session or a plugin is not the person speaking', () => {
  expect(isPersonOrigin({ kind: 'composer' })).toBe(true)
  // The desktop app hosts sessions through the SDK: what the person types there comes that way.
  expect(isPersonOrigin({ kind: 'sdk' })).toBe(true)
  expect(isPersonOrigin(undefined)).toBe(true)
  for (const kind of ['scheduled-trigger', 'task-notification', 'peer', 'peer-send-message', 'coordinator', 'observer']) expect(isPersonOrigin({ kind })).toBe(false)
  expect(isPersonOrigin({ kind: 'plugin' })).toBe(false)
  expect(isPersonOrigin({ kind: 'plugin', asUser: true })).toBe(true)
  expect(personText('<!-- attach: 터미널 | tab:0 -->\n> log line\n\n아니 그거 말고')).toBe('아니 그거 말고')
  expect(personText('<system-reminder>notice</system-reminder>')).toBe('')
  expect(personText('<ci-monitor-event>CI failed</ci-monitor-event>')).toBe('')
  expect(personText('You are a commit message generator.')).toBe('')
})

test('streamed text is cut into whole lines', () => {
  const s = lineSplitter()
  expect(s.push('{"a":1}\n{"b"')).toEqual(['{"a":1}'])
  expect(s.push(':2}\n')).toEqual(['{"b":2}'])
  expect(s.push('{"c":3}')).toEqual([])
  expect(s.end()).toEqual(['{"c":3}'])
})

/** The source of the first drawn Svg whose alt text matches: an Svg is not found by its key. */
async function sourceOf(ui: { findAll: (q: { type: string }) => Promise<{ props: Record<string, unknown> }[]> }, alt: RegExp) {
  return String((await ui.findAll({ type: 'Svg' })).find(s => alt.test(String(s.props.alt ?? '')))?.props.source)
}

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
function past(on: Parameters<TestBody>[1], jevDown: (body: string) => boolean = () => false, entries?: Record<string, unknown>, disk: Record<string, string> = DISK) {
  mock.store(on, entries)
  const clock = mock.clock(on, { now: Date.parse('2026-10-14T00:00:00Z') })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg', TYPESAFE_API_KEY: 'test-key' })
  const at = Date.parse('2026-10-05T00:00:00Z')
  const entry = (name: string, kind: 'dir' | 'file') => ({ name, kind, size: 100, mtimeMs: at, isLink: false })
  // Paths may reach the hooks resolved or with backslashes: matched by their tail.
  const tail = (path: string) => path.replace(/\\/g, '/').replace(/^.*?\/cfg\//, '/cfg/')
  on('fs.list', ($, e) => {
    const p = tail((e as { path: string }).path)
    if (p === '/cfg/projects') return { value: [...new Set(Object.keys(disk).map(k => k.split('/')[3] as string))].map(d => entry(d, 'dir')) } as never
    const files = Object.keys(disk).filter(k => k.startsWith(`${p}/`)).map(k => entry(k.slice(p.length + 1), 'file'))
    if (!files.length) throw new Error('ENOENT')
    return { value: files } as never
  })
  on('fs.read', ($, e) => {
    const text = disk[tail((e as { path: string }).path)]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text } as never
  })
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false } }) as never)
  // Jev: a request is a correction when it starts with 아니; any two judgments are the same mistake.
  on('http.fetch', ($, e) => {
    const raw = String((e as { init?: { body?: string } }).init?.body)
    if (jevDown(raw)) return { value: { status: 503, ok: false, headers: {}, text: '' } } as never
    const body = JSON.parse(raw) as { state: { items?: { user_message: string }[]; requirements?: string[] }; questions: Record<string, unknown> }
    // A past request is a correction when it starts with 아니; a requirement holds everywhere when it is about replies.
    const noulOf = (k: string) =>
      /^h\d/.test(k) ? (body.state.items?.[Number(k.slice(1))]?.user_message.startsWith('아니') ? 0.9 : 0.05)
      : /^g\d/.test(k) ? (body.state.requirements?.[Number(k.slice(1))]?.includes('응답') ? 0.9 : 0.1)
      : /^[lkp]\d/.test(k) ? 0.9
      : 0.05
    const answers = Object.fromEntries(Object.keys(body.questions).map(k => [k, { noul: noulOf(k) }]))
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
  on('prompt.submit', ($, e) => ({ text: (e as { text: string }).text }) as never)
  return clock
}

test('past conversations become cases, and the same mistake in two projects one lesson the AI registers, not attached', async ($, on) => {
  const clock = past(on)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  await pane.press({ key: 'hist-run' })
  await clock.settle()
  // Two of the five requests were corrections, one in each project.
  expect(await pane.find({ type: 'Text', text: /요청 5개를 보고 교정 2개를 사례로 정리했어요/ })).toBeDefined()
  expect((await pane.find({ key: 'tab-feedback' }))?.text).toMatch(/사례 2/)
  expect(await pane.find({ key: 's-fb-other' })).toBeDefined()
  // Both say the same thing: one lesson for every project, registered by the AI without asking, kept off requests.
  expect((await pane.find({ key: 'tab-lessons' }))?.text).toMatch(/교훈 1$/)
  await pane.press({ key: 'tab-lessons' })
  expect(await pane.find({ key: 's-cand' })).toBeUndefined()
  expect(await sourceOf(pane, /주소를 넘길 땐 배포된 주소인지 확인/)).toContain('안 붙음')
  await pane.unmount()
})

test('a run that stopped carries on where it stopped; nothing read is asked about twice', async ($, on) => {
  let asked = 0
  let isDown = true
  // Jev is unreachable while beta's requests are asked about: tried three more times, then the run stops.
  const clock = past(on, body => {
    if (body.includes('"items"')) asked++
    return isDown && body.includes('데모 주소')
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  await pane.press({ key: 'hist-run' })
  await clock.settle()
  // Still trying: one 503 is Jev's moment, not a stop. What it is doing is said: which record, how big, which step.
  expect(await pane.find({ type: 'Text', text: /지난 대화를 읽는 중[\s\S]*지금 p-beta 기록 0MB · Jev가 교정인지 판정 1\/1/ })).toBeDefined()
  await clock.advance(20_000)
  expect(await pane.find({ type: 'Text', text: /멈췄어요 · Jev에 연결하지 못했어요 \(HTTP 503\)/ })).toBeDefined()
  expect(asked).toBe(5)
  isDown = false
  await pane.press({ key: 'hist-run' })
  await clock.settle()
  // Only beta is read again; alpha's case is not found twice.
  expect(asked).toBe(6)
  expect(await pane.find({ type: 'Text', text: /요청 5개를 보고 교정 2개를 사례로 정리했어요/ })).toBeDefined()
  // Read up to 45 days back: what is older is offered, not read on its own.
  expect((await pane.find({ key: 'hist-run' }))?.text).toMatch(/이전 대화도 찾기/)
  expect((await pane.find({ key: 'tab-feedback' }))?.text).toMatch(/사례 2/)
  await pane.unmount()
})

test('a run whose session closed says so, and offers to carry on', async ($, on) => {
  past(on, () => false, { history: { status: 'running', at: Date.parse('2026-10-13T00:00:00Z'), since: 0, until: 1, files: 15372, filesDone: 1811, prompts: 1398, found: 375, enriched: 0, v: 2, range: 'all' } })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  expect(await pane.find({ type: 'Text', text: /멈췄어요 · 읽던 세션이 닫혔거나 플러그인이 업데이트됐어요 · 기록 1811\/15372/ })).toBeDefined()
  expect((await pane.find({ key: 'hist-run' }))?.text).toMatch(/이어서 찾기/)
  await pane.unmount()
})

test('a run kept by an earlier version (a list of every file name) carries on from it', async ($, on) => {
  const bodies: string[] = []
  const clock = past(on, body => (body.includes('"items"') && bodies.push(body), false), {
    history: { status: 'error', at: 1, since: Date.parse('2026-08-30T00:00:00Z'), until: Date.parse('2026-10-14T00:00:00Z'), files: 2, filesDone: 1, prompts: 3, found: 1, enriched: 0, v: 2, range: 'recent' },
    historyFiles: ['s1.jsonl'],
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  expect((await pane.find({ key: 'hist-run' }))?.text).toMatch(/이어서 찾기/)
  await pane.press({ key: 'hist-run' })
  await clock.settle()
  // alpha (s1) was read before: only beta is asked about.
  expect(bodies.some(b => b.includes('데모 주소'))).toBe(true)
  expect(bodies.some(b => b.includes('배포 링크 줘'))).toBe(false)
  await pane.unmount()
})

test('one dropped Jev call does not stop the run: it is tried again', async ($, on) => {
  let drops = 1
  const clock = past(on, body => body.includes('"items"') && drops-- > 0)
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  await pane.press({ key: 'hist-run' })
  await clock.settle()
  await clock.advance(20_000)
  expect(await pane.find({ type: 'Text', text: /멈췄어요/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /요청 5개를 보고 교정 2개를 사례로 정리했어요/ })).toBeDefined()
  await pane.unmount()
})

test('a requirement saved before projects were recorded gets the project it was said in, and Jev says where it holds', async ($, on) => {
  // Saved the moment alpha's correction and beta's were sent; neither knew its project.
  const clock = past(on, () => false, {
    requirements: [
      { id: 'R-a', text: 'src/generated 폴더는 수정 금지', ts: Date.parse(ALPHA_AT), active: 1 },
      { id: 'R-b', text: '응답은 영어가 아닌 한국어로 작성', ts: Date.parse(BETA_AT), active: 1 },
    ],
  })
  await $.prompt.submit({ text: '아무 요청이나 하나' } as never)
  await clock.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  // About replies: it holds in every project, this one included.
  const own = await sourceOf(pane, /한국어로 작성/)
  expect(own).toContain('한국어로 작성')
  expect(own).toContain('모든 프로젝트')
  // About one project's files: it stays with alpha, listed here for reference.
  await pane.press({ key: 's-rq-other-fold' })
  const others = await sourceOf(pane, /src\/generated/)
  expect(others).toContain('src/generated')
  expect(others).toContain('alpha')
  expect(others).not.toContain('출처 모름')
  await pane.unmount()
})

test('a run made the older way can be run again: Jev reads each request with what came before and after', async ($, on) => {
  const bodies: string[] = []
  const clock = past(on, body => (bodies.push(body), false), {
    history: { status: 'done', at: 1, since: Date.parse('2026-08-30T00:00:00Z'), until: Date.parse('2026-10-14T00:00:00Z'), files: 2, filesDone: 2, prompts: 5, found: 0, enriched: 0 },
    historyFiles: ['s1.jsonl', 's2.jsonl'],
  })
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  expect((await pane.find({ key: 'hist-run' }))?.text).toMatch(/새 기준으로/)
  await pane.press({ key: 'hist-run' })
  await clock.settle()
  expect(await pane.find({ type: 'Text', text: /요청 5개를 보고 교정 2개를 사례로 정리했어요/ })).toBeDefined()
  const asked = bodies.map(b => JSON.parse(b) as { state: { items?: { user_message: string; earlier_user_messages: string[]; next_user_messages: string[]; assistant_reply: string }[] } }).flatMap(b => b.state.items ?? [])
  const alpha = asked.find(i => i.user_message.startsWith('아니 그건 로컬'))
  expect(alpha?.earlier_user_messages).toEqual(['배포 링크 줘'])
  expect(alpha?.assistant_reply).toBe('여기 있어요: http://localhost:3000')
  expect(alpha?.next_user_messages).toEqual(['고마워 다음은 README 정리해줘'])
  await pane.unmount()
})

test("a requirement taken from a scheduled task's prompt is set aside; one the person typed stays", async ($, on) => {
  const SCHEDULED_AT = '2026-10-02T13:00:00Z'
  const disk = {
    ...DISK,
    '/cfg/projects/D--p-alpha/s3.jsonl': user('n1', SCHEDULED_AT, 'D:/p/alpha', '<scheduled-task name="nightly">0 raw 원문은 수정 금지. 정리만 해</scheduled-task>'),
  }
  const clock = past(on, () => false, {
    requirements: [
      { id: 'R-n', text: '0 raw 원문 본문 수정 금지', ts: Date.parse(SCHEDULED_AT), active: 1 },
      { id: 'R-b', text: '응답은 영어가 아닌 한국어로 작성', ts: Date.parse(BETA_AT), active: 1 },
    ],
  }, disk)
  await $.prompt.submit({ text: '아무 요청이나 하나' } as never)
  await clock.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-feedback' })
  expect(await sourceOf(pane, /한국어로 작성/)).toContain('한국어로 작성')
  const shows = async (re: RegExp) => (await pane.findAll({ type: 'Svg' })).some(x => re.test(String(x.props.alt ?? '') + String(x.props.source ?? '')))
  // Another project's requirements are folded: open them, the scheduled one is not there either.
  if (await pane.find({ key: 's-rq-other-fold' })) await pane.press({ key: 's-rq-other-fold' })
  expect(await shows(/0 raw/)).toBe(false)
  await pane.unmount()
})

test("old records show the person's words: ani's English summary is said again in Korean, an app's notice is dropped", async ($, on) => {
  const pattern = [
    '---',
    'id: S-deploy',
    'status: active',
    'scope: global',
    'summary: Use when handing the user a link to a deployed page, check it is the deployed one',
    'compiled_from: [F-deploy]',
    '---',
    '## Situation',
    'Handing over a link.',
  ].join('\n')
  // A compiled lesson keeps no words of its own: the record it was compiled from has them.
  const source = ['---', 'id: F-deploy', 'status: compiled', '---', '## Excerpt', '> User: 아니 그거 **배포 주소** 아니잖아'].join('\n')
  const clock = past(on, () => false, {
    aniImported: ['S-deploy'],
    cards: [{ id: 'S-deploy', ts: 1, text: 'Use when handing the user a link to a deployed page, check it is the deployed one', kind: 'intent', scope: 'global', project: '', source: 'ani', keywords: [], lesson: 'Use when handing the user a link to a deployed page, check it is the deployed one', count: 2 }],
    feedbackLog: [
      { at: 3, text: '<system-reminder>The user started your suggested background task.</system-reminder>', cardId: '', project: 'unknown' },
      { at: 2, text: '<!-- attach: 터미널 | tab:0 -->\n> PS C:\\> npm test\n\n아니 테스트 먼저 돌려', cardId: '', project: 'unknown' },
    ],
  }, { ...DISK, '/.ani/patterns/S-deploy.md': pattern, '/.ani/patterns/F-deploy.md': source })
  // Old records are tidied when a session starts.
  on('session.start', ($, e) => ({ cwd: (e as { cwd: string }).cwd }) as never)
  on('session.root', () => ({ value: '/p' }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  on('command.register', ($, e) => ({ value: { command: (e as { name: string }).name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false } as never)
  await clock.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const drawn = async () => (await pane.findAll({ type: 'Svg' })).map(x => `${String(x.props.alt ?? '')} ${String(x.props.source ?? '')}`).join('\n')
  await pane.press({ key: 'tab-lessons' })
  expect(await drawn()).toContain('주소를 넘길 땐 배포된 주소인지 확인')
  expect(await drawn()).not.toContain('Use when')
  await pane.press({ key: 'tab-feedback' })
  expect((await pane.find({ key: 'tab-feedback' }))?.text).toMatch(/사례 1/)
  if (await pane.find({ key: 's-fb' })) await pane.press({ key: 's-fb' })
  const cases = await drawn()
  expect(cases).not.toContain('system-reminder')
  expect(cases).not.toContain('npm test')
  await pane.unmount()
})

/** A session starting: when ani tidies what it keeps. */
async function startSession($: Parameters<TestBody>[0], on: Parameters<TestBody>[1]) {
  on('session.start', ($, e) => ({ cwd: (e as { cwd: string }).cwd }) as never)
  on('session.root', () => ({ value: '/p' }) as never)
  on('session.messages', () => ({ value: [] }) as never)
  on('command.register', ($, e) => ({ value: { command: (e as { name: string }).name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  await $.session.start({ cwd: '/p', surface: null, isInteractive: false } as never)
}

const STRUNG = '이 상황에서 그림체 지시를 놓쳤다 / 이 상황에서 트리거 설계를 되돌려 맡겼다'
const caseOf = (at: number, judgment: string, link: Record<string, string>) => ({ at, text: '아니 그게 아니라', cardId: '', project: 'unknown', judgment, ...link })

test('a candidate left waiting from before becomes one worded lesson at a session start, never its judgments strung together', async ($, on) => {
  const clock = past(on, () => false, {
    candidates: [{ id: 'C-1', cases: [11, 12], kind: 'intent', scope: 'global', project: 'unknown' }],
    feedbackLog: [caseOf(12, '이 상황에서 그림체 지시를 놓쳤다', { candidateId: 'C-1' }), caseOf(11, '이 상황에서 트리거 설계를 되돌려 맡겼다', { candidateId: 'C-1' })],
  })
  await startSession($, on)
  await clock.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-lessons' })
  const drawn = (await pane.findAll({ type: 'Svg' })).map(x => `${String(x.props.alt ?? '')} ${String(x.props.source ?? '')}`).join('\n')
  expect(drawn).toContain('주소를 넘길 땐 배포된 주소인지 확인')
  expect(drawn).not.toContain(STRUNG)
  await pane.unmount()
})

test('a rule saved as strung-together judgments is worded again from its cases when a session starts; it stays a rule', async ($, on) => {
  const clock = past(on, () => false, {
    cards: [{ id: 'J-s', ts: 1, text: '아니 그게 아니라', kind: 'intent', scope: 'global', project: '', source: 'jev', keywords: [], count: 2, isRule: true, lesson: STRUNG }],
    feedbackLog: [caseOf(12, '이 상황에서 그림체 지시를 놓쳤다', { cardId: 'J-s' }), caseOf(11, '이 상황에서 트리거 설계를 되돌려 맡겼다', { cardId: 'J-s' })],
  })
  await startSession($, on)
  await clock.settle()
  const pane = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await pane.press({ key: 'tab-rules' })
  const drawn = (await pane.findAll({ type: 'Svg' })).map(x => `${String(x.props.alt ?? '')} ${String(x.props.source ?? '')}`).join('\n')
  expect(drawn).toContain('주소를 넘길 땐 배포된 주소인지 확인')
  expect(drawn).not.toContain(STRUNG)
  await pane.unmount()
})
