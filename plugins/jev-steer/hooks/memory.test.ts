import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import type { Card } from '../types'

type Disk = Record<string, { text: string; mtimeMs: number }>

const user = (cwd: string) => JSON.stringify({ type: 'user', uuid: `u-${cwd}`, timestamp: '2026-10-01T00:00:00Z', sessionId: 's', cwd, message: { role: 'user', content: '안녕' } })
const feedback = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\nmetadata:\n  type: feedback\n---\n${description}`

const NOTE_AT = Date.parse('2026-09-20T00:00:00Z')
const DISK: Disk = {
  '/cfg/projects/D--p-site/memory/MEMORY.md': { text: '- [revert](feedback_revert.md)\n- [brand](project_brand.md)', mtimeMs: NOTE_AT },
  '/cfg/projects/D--p-site/memory/feedback_revert.md': {
    text: [
      '---',
      'name: selective-revert-only',
      'description: When reverting changes, never check out whole files with uncommitted work.',
      'type: feedback',
      'metadata:',
      '  managed_by: memory-layer',
      '---',
      '',
      'Revert only your own edits.',
      '',
      '**Why:** the user lost uncommitted work.',
      '**How to apply:** check git diff first, then remove only your changes.',
    ].join('\r\n'),
    mtimeMs: NOTE_AT,
  },
  '/cfg/projects/D--p-site/memory/project_brand.md': { text: '---\nname: brand-color\ndescription: The brand color is teal\nmetadata:\n  type: project\n---\nTeal.', mtimeMs: NOTE_AT },
  // The newest transcript names the folder; its first line records none.
  '/cfg/projects/D--p-site/s-old.jsonl': { text: user('D:/p/old'), mtimeMs: NOTE_AT },
  '/cfg/projects/D--p-site/s-new.jsonl': { text: [JSON.stringify({ type: 'file-history-snapshot' }), user('D:/p/site')].join('\n'), mtimeMs: NOTE_AT + 1000 },
}

const WORDED = { intent: '내가 한 변경만 되돌리기', why: '파일 전체 되돌리기로 읽음', lesson: '되돌릴 땐 git diff로 내 변경만 골라 제거', short: '내 변경만 골라 되돌리기' }
const ENGLISH = { intent: 'Revert only my edits', why: 'Read it as reverting files', lesson: 'When reverting, remove only your own changes', short: 'Revert own edits' }

type Model = { reply: 'korean' | 'english' | 'down'; calls: number }

/** The plugin's store, kept where the test can read it as JSON would keep it. */
function storeOf(on: Parameters<TestBody>[1]) {
  const kept = new Map<string, unknown>()
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

/** Claude Code's config folder on disk, the small model answering beneath the plugin. */
function world(on: Parameters<TestBody>[1], model: Model, disk: Disk = DISK) {
  const store = storeOf(on)
  const clock = mock.clock(on, { now: Date.parse('2026-10-14T00:00:00Z') })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/me' })
  // Paths may reach the hooks resolved or with backslashes: matched by their tail.
  const tail = (path: string) => path.replace(/\\/g, '/').replace(/^.*?\/cfg\//, '/cfg/')
  on('fs.list', ($, e) => {
    const p = tail((e as { path: string }).path)
    const names = new Map<string, { kind: 'dir' | 'file'; mtimeMs: number }>()
    for (const [k, f] of Object.entries(disk)) {
      if (!k.startsWith(`${p}/`)) continue
      const [name = '', ...rest] = k.slice(p.length + 1).split('/')
      names.set(name, rest.length ? { kind: 'dir', mtimeMs: 0 } : { kind: 'file', mtimeMs: f.mtimeMs })
    }
    if (!names.size) throw new Error('ENOENT')
    return { value: [...names].map(([name, x]) => ({ name, kind: x.kind, size: 100, mtimeMs: x.mtimeMs, isLink: false })) } as never
  })
  on('fs.read', ($, e) => {
    const f = disk[tail((e as { path: string }).path)]
    if (!f) throw new Error('ENOENT')
    return { value: f.text } as never
  })
  on('session.start', ($, e) => ({ cwd: (e as { cwd: string }).cwd }) as never)
  on('session.root', () => ({ value: '/home/me/site' }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false } }) as never)
  on('command.register', ($, e) => ({ value: { command: (e as { name: string }).name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('http.fetch', () => ({ value: { status: 503, ok: false, headers: {}, text: '' } }) as never)
  on('model.complete', () => {
    model.calls++
    if (model.reply === 'down') return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded' } } as never
    const text = JSON.stringify(model.reply === 'korean' ? WORDED : ENGLISH)
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } as never
  })
  return { clock, store }
}

/** One session start, run to rest; the memory lessons it leaves. */
async function start($: Parameters<TestBody>[0], w: ReturnType<typeof world>) {
  await $.session.start({ cwd: '/home/me/site', surface: null, isInteractive: false })
  await w.clock.settle()
  return ((w.store.get('cards') as Card[] | undefined) ?? []).filter(c => c.source === 'memory')
}

const PANE = { plugin: 'jev-steer', component: 'Pane', requestId: 'jev-steer', props: {} as never } as const

test('a feedback note from Claude memory becomes a Korean lesson of the folder it was said in, once', async ($, on) => {
  const model: Model = { reply: 'korean', calls: 0 }
  const w = world(on, model)
  const cards = await start($, w)
  // Only the feedback note comes in; the project note and the index do not.
  expect(cards.length).toBe(1)
  const [card] = cards as [Card]
  expect(card.id).toBe('M-D--p-site-selective-revert-only')
  expect(card.lesson).toBe(WORDED.lesson)
  expect(card.short).toBe(WORDED.short)
  expect(card.intent).toBe(WORDED.intent)
  expect(card.why).toBe(WORDED.why)
  // Claude's English note is not shown where the person's words go.
  expect(card.text).toBe(WORDED.lesson)
  expect(card.scope).toBe('personal-project')
  // Named as a case said there is: the origin remote, else the folder.
  expect(card.project).toBe('site')
  expect(card.ts).toBe(NOTE_AT)
  expect(card.kind).toBe('intent')
  expect(card.count).toBe(1)
  expect(model.calls).toBe(1)
  // The next session brings in nothing twice.
  expect((await start($, w)).length).toBe(1)
  expect(model.calls).toBe(1)
})

test('a memory lesson is listed as this project\'s own, and once forgotten it is not brought back', async ($, on) => {
  const model: Model = { reply: 'korean', calls: 0 }
  const w = world(on, model)
  expect((await start($, w)).length).toBe(1)
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /이 프로젝트에만 · 1$/ })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /되돌릴 땐 git diff로 내 변경만 골라 제거/ })).toBeDefined()
  await term.press({ key: 'rm-M-D--p-site-selective-revert-only' })
  await term.unmount()
  expect((await start($, w)).length).toBe(0)
  expect(model.calls).toBe(1)
})

test('a note the small model could not word, or worded in English, is not saved and is tried again next session', async ($, on) => {
  const model: Model = { reply: 'down', calls: 0 }
  const w = world(on, model)
  expect((await start($, w)).length).toBe(0)
  model.reply = 'english'
  expect((await start($, w)).length).toBe(0)
  expect(w.store.get('memoryImported') ?? []).toEqual([])
  model.reply = 'korean'
  const cards = await start($, w)
  expect(cards.length).toBe(1)
  expect(cards[0]?.lesson).toBe(WORDED.lesson)
  expect(model.calls).toBe(3)
})

test('one session start words at most twelve notes; the rest come next session', async ($, on) => {
  const model: Model = { reply: 'korean', calls: 0 }
  const many: Disk = {}
  for (let i = 0; i < 14; i++) many[`/cfg/projects/D--p-site/memory/feedback_${i}.md`] = { text: feedback(`note-${i}`, `Note number ${i}`), mtimeMs: NOTE_AT }
  const w = world(on, model, many)
  expect((await start($, w)).length).toBe(12)
  expect((await start($, w)).length).toBe(14)
  expect(model.calls).toBe(14)
})

test('a note said in the home folder holds in every project; one with no transcript stays with its folder', async ($, on) => {
  const model: Model = { reply: 'korean', calls: 0 }
  const w = world(on, model, {
    '/cfg/projects/C--home-me/memory/feedback_lang.md': { text: feedback('reply-in-korean', 'Reply in Korean'), mtimeMs: NOTE_AT },
    '/cfg/projects/C--home-me/s.jsonl': { text: user('/home/me'), mtimeMs: NOTE_AT },
    '/cfg/projects/D--gone/memory/feedback_tabs.md': { text: feedback('tabs-not-folds', 'Use tabs, not folds'), mtimeMs: NOTE_AT },
  })
  const cards = await start($, w)
  expect(cards.map(c => [c.id, c.scope, c.project])).toEqual([
    ['M-C--home-me-reply-in-korean', 'global', 'me'],
    ['M-D--gone-tabs-not-folds', 'personal-project', 'D--gone'],
  ])
})
