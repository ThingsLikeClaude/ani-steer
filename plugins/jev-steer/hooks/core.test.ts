import { expect, test } from 'claude-code/testing'
import { isConcreteRequirement } from './register'

import type { Card } from '../types'
import { buildQuestions, judge, parseIndex, pickCandidates, scopeOf, slugOf, verdictOf } from './core'

const card = (over: Partial<Card>): Card => ({
  id: 'J-1',
  ts: 1,
  text: '폰트 좀 키워줘',
  kind: 'effort',
  scope: 'personal-project',
  project: 'me/site',
  source: 'jev',
  keywords: ['폰트', '키워줘'],
  ...over,
})

test('verdict: apply only when same, satisfying and unlikely to flip', async () => {
  expect(verdictOf(0.9, 0.8, 0.1)).toBe('apply')
  expect(verdictOf(0.9, 0.8, 0.5)).toBe('ask')
  expect(verdictOf(0.3, 0.9, 0.0)).toBe('hold')
})

test('scope defaults to this project; global only when Jev is clearly sure; never team', async () => {
  expect(scopeOf({})).toBe('personal-project')
  expect(scopeOf({ scope: { probabilities: { global: 0.55, 'team-project': 0.9 } } })).toBe('personal-project')
  expect(scopeOf({ scope: { probabilities: { global: 0.8 } } })).toBe('global')
})

test('candidates: other projects are excluded, narrower scope wins on the same id', async () => {
  const cards = [
    card({ id: 'S-a', scope: 'global', text: 'global copy' }),
    card({ id: 'S-a', scope: 'team-project', text: 'team copy' }),
    card({ id: 'J-other', project: 'someone/else' }),
  ]
  const picked = pickCandidates('폰트 크기 조정해줘', cards, 'me/site')
  expect(picked.map(c => c.text)).toEqual(['team copy'])
})

test('questions and judgments line up by index', async () => {
  const cs = [card({ id: 'J-1' }), card({ id: 'J-2' })]
  const q = buildQuestions(cs, [{ id: 'R-1', text: 'src/generated 수정 금지', ts: 1, active: 1 }])
  expect(Object.keys(q)).toContain('c1_flip')
  expect(Object.keys(q)).toContain('r0_active')
  const js = judge(cs, { c0_same: { noul: 0.9 }, c0_satisfy: { noul: 0.9 }, c0_flip: { noul: 0.1 }, c1_same: { noul: 0.1 } })
  expect(js.map(j => j.verdict)).toEqual(['apply', 'hold'])
})

test('ani INDEX rows: only active or provisional S/K rows', async () => {
  const md = [
    '| id | status | scope | keywords | summary | updated |',
    '| --- | --- | --- | --- | --- | --- |',
    '| S-dark | active | global | dark-mode, css | Use when dark mode colors change | 2026-08-28 |',
    '| S-old | retired | global | x | old | 2026-08-01 |',
  ].join('\n')
  const rows = parseIndex(md, 'global', 'me/site')
  expect(rows.map(r => r.id)).toEqual(['S-dark'])
  expect(rows[0]?.keywords).toEqual(['dark-mode', 'css'])
})

test('project slug from the origin remote, else the folder name', async () => {
  expect(await slugOf('git@github.com:ThingsLikeClaude/ani.git\n', '/x/ani')).toBe('ThingsLikeClaude/ani')
  expect(await slugOf('', '/Users/me/work/site')).toBe('site')
})

test('requirements must name a concrete target; generic working rules are dropped', () => {
  for (const t of ['사용자 피드백이 있으면 이전 결과물에 반영해 다시 수정할 것', '설명은 깔끔하게 표현하기', "'해당되는 ~' 같은 군더더기 표현 빼기"]) {
    expect(isConcreteRequirement(t)).toBe(false)
  }
  for (const t of ['이미지 작업은 코덱스 CLI(Astra)를 사용해 진행할 것', 'ani 상태는 프롬프트 창 아래에', 'src/generated는 수정 금지']) {
    expect(isConcreteRequirement(t)).toBe(true)
  }
})
