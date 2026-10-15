import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import type { Card } from '../types'

const card = (over: Partial<Card>): Card => ({
  id: 'J-x', ts: 1, text: '아니 그게 아니라', kind: 'intent', scope: 'personal-project', project: 'other', source: 'jev', keywords: [], ...over,
})

const HABIT = card({ id: 'J-habit', lesson: '한정하는 말이 나오면 전체로 넓히지 말고 그 부분만 답한다' })
const OWN = card({ id: 'J-own', lesson: '대시보드 모달 헤더는 28px 타이틀바와 닫기 점만 쓴다' })
const PLACED = card({ id: 'J-placed', lesson: '결과물을 요청받으면 상태 보고 대신 결과를 먼저 보인다' })
const ARCHIVED = card({ id: 'J-archived', scope: 'global', isArchived: true, lesson: '완료 보고 전에 결과 화면을 직접 확인한다' })

/** The plugin's store, kept where the test can read it as JSON would keep it. */
function storeOf(on: Parameters<TestBody>[1], entries: Record<string, unknown>) {
  const kept = new Map<string, unknown>(Object.entries(entries))
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

/**
 * A session in a third project. Jev reads a lesson as a habit when it is about
 * how to answer, and as portable unless it names a screen part; every lesson it
 * was asked about is counted.
 */
function world(on: Parameters<TestBody>[1], entries: Record<string, unknown>) {
  const store = storeOf(on, entries)
  const clock = mock.clock(on, { now: Date.parse('2026-10-14T00:00:00Z') })
  mock.env(on, { CLAUDE_CONFIG_DIR: '/cfg', HOME: '/home/me', TYPESAFE_API_KEY: 'test-key' })
  const asked: string[] = []
  on('fs.list', () => {
    throw new Error('ENOENT')
  })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('session.start', ($, e) => ({ cwd: (e as { cwd: string }).cwd }) as never)
  on('session.root', () => ({ value: '/home/me/site' }) as never)
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false } }) as never)
  on('command.register', ($, e) => ({ value: { command: (e as { name: string }).name } }) as never)
  on('ui.open', () => ({ value: { isPlaced: false } }) as never)
  on('ui.toast', () => ({ value: undefined }) as never)
  on('model.complete', () => ({ value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded' } }) as never)
  on('http.fetch', ($, e) => {
    const body = JSON.parse(String((e as { init?: { body?: string } }).init?.body)) as { state: { lessons?: string[] }; questions: Record<string, unknown> }
    const lessons = body.state.lessons ?? []
    asked.push(...lessons)
    const noulOf = (k: string) => {
      const l = lessons[Number(k.slice(1))] ?? ''
      if (k.startsWith('g')) return /답한다|보인다|28px/.test(l) ? 0.9 : 0.1
      if (k.startsWith('w')) return /모달|타이틀바/.test(l) ? 0.2 : 0.9
      return 0.05
    }
    const answers = Object.fromEntries(Object.keys(body.questions).map(k => [k, { noul: noulOf(k) }]))
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers }) } } as never
  })
  return { clock, store, asked }
}

const scopeOf = (store: Map<string, unknown>, id: string) => (store.get('cards') as Card[]).find(c => c.id === id)

test("another project's lesson that holds anywhere moves to every project; one tied to its project stays; the person's placing stands", async ($, on) => {
  const w = world(on, { cards: [HABIT, OWN, PLACED, ARCHIVED], lessonsPlaced: ['J-placed'] })
  await $.session.start({ cwd: '/home/me/site', surface: null, isInteractive: false })
  await w.clock.settle()
  expect(scopeOf(w.store, 'J-habit')?.scope).toBe('global')
  // A habit by the first question, but it names a screen part: both must agree.
  expect(scopeOf(w.store, 'J-own')?.scope).toBe('personal-project')
  // Placed by the person: not asked about.
  expect(scopeOf(w.store, 'J-placed')?.scope).toBe('personal-project')
  expect(w.asked.some(l => l.includes('상태 보고'))).toBe(false)
  // Each is judged once: both are now on the list Jev is not asked about again.
  expect(w.store.get('lessonsPlaced')).toEqual(['J-placed', 'J-habit', 'J-own'])
})

test('a lesson once archived for a full scope comes back, once', async ($, on) => {
  const w = world(on, { cards: [ARCHIVED] })
  await $.session.start({ cwd: '/home/me/site', surface: null, isInteractive: false })
  await w.clock.settle()
  expect(scopeOf(w.store, 'J-archived')?.isArchived).toBe(false)
  expect(w.store.get('uncappedV1')).toBe(true)
})
