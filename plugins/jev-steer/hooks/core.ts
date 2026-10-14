import type { Card, Judgment, Kind, Requirement, Scope, Verdict } from '../types'

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
export const MAX_CANDIDATES = 24
export const MAX_REQUIREMENTS = 7
export const MAX_PROMPT_CHARS = 4000

export const KIND_LABEL: Record<Kind, string> = {
  intent: '의도 빗나감',
  effort: '덜/더 함',
  missed: '말한 걸 놓침',
  autonomy: '너무 앞서감',
  buried: '묻혀서 놓침',
}

export const SCOPE_LABEL: Record<Scope, string> = {
  global: '전체',
  'personal-project': '이 프로젝트',
  'team-project': '팀',
}

export type NoulQ = { type: 'noul'; instructions: string; criteria?: { true?: string; false?: string } }
export type ChoiceQ = { type: 'choice'; instructions: string; criteria: Record<string, string> }
export type Questions = Record<string, NoulQ | ChoiceQ>
export type Answers = Record<string, { noul?: number; choice?: string; probabilities?: Record<string, number> }>

/** Lowercased word tokens, Hangul kept; tokens under 2 characters dropped. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu) ?? []).filter(t => t.length >= 2)
}

/** Rows of an ani INDEX.md table: `| id | status | scope | keywords | summary | updated |`. */
export function parseIndex(markdown: string, scope: Scope, project: string): Card[] {
  const cards: Card[] = []
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map(c => c.trim())
    if (cells.length < 7) continue
    const [, id = '', status = '', , keywords = '', summary = ''] = cells
    if (!/^[SK]-/.test(id)) continue
    if (status !== 'active' && status !== 'provisional') continue
    cards.push({
      id,
      ts: 0,
      text: summary,
      kind: 'missed',
      scope,
      project,
      source: 'ani',
      keywords: keywords.split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
    })
  }
  return cards
}

/** Narrowest scope first: team → personal-project → global; same id keeps the narrowest. */
export function pickCandidates(prompt: string, cards: readonly Card[], project: string): Card[] {
  const order: Record<Scope, number> = { 'team-project': 0, 'personal-project': 1, global: 2 }
  const words = new Set(tokenize(prompt))
  const seen = new Set<string>()
  return cards
    .filter(c => !c.isMuted && appliesTo(c, project))
    .sort((a, b) => order[a.scope] - order[b.scope])
    .filter(c => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map(c => {
      const keys = c.keywords.length > 0 ? c.keywords : tokenize(c.text)
      return { c, hits: keys.filter(k => words.has(k) || prompt.toLowerCase().includes(k)).length }
    })
    .filter(x => x.hits > 0 || x.c.source === 'jev')
    .sort((a, b) => b.hits - a.hits || b.c.ts - a.c.ts)
    .slice(0, MAX_CANDIDATES)
    .map(x => x.c)
}

/** How a card reads to Jev and to the person: the lesson with its context when known. */
export function describe(c: Card): string {
  if (!c.lesson) return c.text
  const cause = c.why ?? c.did
  const ctx = [c.intent && `intended: ${c.intent}`, cause && `went wrong because: ${cause}`].filter(Boolean).join('; ')
  return ctx ? `${c.lesson} (${ctx})` : c.lesson
}

/** Every question for one submitted prompt, sent in a single Jev request. */
export function buildQuestions(candidates: readonly Card[], requirements: readonly Requirement[], attached: readonly Card[] = []): Questions {
  const q: Questions = {
    is_correction: {
      type: 'noul',
      instructions:
        "Is the user's latest message a correction or complaint about the assistant's previous result (they got it wrong, missed something, did too much or too little)?",
      criteria: { true: 'negative feedback on the previous turn', false: 'a new request, a question, or praise' },
    },
    kind: {
      type: 'choice',
      instructions: 'If the latest message is a correction, what went wrong?',
      criteria: {
        intent: 'misunderstood what the user wanted',
        effort: 'too shallow, or overdone',
        missed: 'ignored something stated in the request itself',
        autonomy: 'acted beyond scope without asking',
        buried: 'forgot a requirement the user gave many turns earlier',
      },
    },
    scope: {
      type: 'choice',
      instructions: 'Where should a lesson from the latest message apply in the future?',
      criteria: {
        global: "the user's general working style or taste, true in any project",
        'personal-project': "specific to this project's files, brand or conventions, for this user",
        'team-project': 'a rule of this repository every contributor should follow',
      },
    },
    has_requirement: {
      type: 'noul',
      instructions:
        'Does the latest message state a standing requirement or constraint that should keep holding in later turns (not a one-off task)?',
    },
  }
  candidates.forEach((c, i) => {
    q[`c${i}_same`] = {
      type: 'noul',
      instructions: `Does this past lesson bear on the work the latest request asks for, so keeping it in mind would change how the assistant does it: "${describe(c)}"?`,
      criteria: { true: 'the request touches what the lesson is about (same kind of work or the same thing)', false: 'the request is about something the lesson does not touch' },
    }
    q[`c${i}_satisfy`] = {
      type: 'noul',
      instructions: `Would applying this past feedback now satisfy the user: "${describe(c)}"?`,
    }
    q[`c${i}_dup`] = {
      type: 'noul',
      instructions: `If the latest message is a correction, is it correcting the same kind of mistake as this remembered feedback, so the two should become one lesson: "${describe(c)}"?`,
    }
    q[`c${i}_flip`] = {
      type: 'noul',
      instructions: `Would applying this past feedback now likely draw the opposite complaint: "${describe(c)}"?`,
    }
  })
  requirements.forEach((r, i) => {
    q[`r${i}_active`] = {
      type: 'noul',
      instructions: `Does this earlier requirement still hold after the latest message (not withdrawn or replaced): "${r.text}"?`,
    }
    q[`r${i}_relevant`] = {
      type: 'noul',
      instructions: `Does this standing requirement bear on doing the latest request, so the assistant should be reminded of it now: "${r.text}"?`,
    }
  })
  // Lessons attached to the previous request: does this message push the other way?
  attached.forEach((a, i) => {
    q[`p${i}_reverses`] = {
      type: 'noul',
      instructions: `Last turn the assistant followed this lesson: "${a.lesson ?? a.text}". Does the user's latest message ask for the opposite, or say that lesson should not have been applied here?`,
      criteria: { true: 'the user pushes against that lesson', false: 'unrelated, or consistent with it' },
    }
  })
  return q
}

export function noul(answers: Answers, name: string): number {
  const v = answers[name]?.noul
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

export function verdictOf(same: number, satisfy: number, flip: number): Verdict {
  if (same < 0.4) return 'hold'
  // Jev's "opposite complaint" sits around 0.4 for nearly everything, so it only
  // vetoes when it leans yes. Relevance is the real gate.
  // Replaying the logged prompts: flip rises with relevance (0.55–0.63 on the
  // lessons that plainly applied), so it vetoes only when it outweighs relevance.
  if (same >= 0.55 && flip < 0.7 && flip <= same) return 'apply'
  void satisfy
  return 'ask'
}

export function judge(candidates: readonly Card[], answers: Answers): Judgment[] {
  return candidates.map((c, i) => {
    const same = noul(answers, `c${i}_same`)
    const satisfy = noul(answers, `c${i}_satisfy`)
    const flip = noul(answers, `c${i}_flip`)
    return { id: c.id, label: c.lesson ?? c.text, kind: c.kind, verdict: verdictOf(same, satisfy, flip), same, satisfy, flip }
  })
}

/**
 * Scope of a new correction. Default is personal-project: the smallest blast
 * radius. Global only when Jev is clearly sure; team is never chosen here
 * (moving into the shared overlay is the user's explicit act, as in ani).
 */
export function scopeOf(answers: Answers): Scope {
  const p = answers.scope?.probabilities ?? {}
  return (p.global ?? 0) >= 0.7 ? 'global' : 'personal-project'
}

export function kindOf(answers: Answers): Kind {
  const c = answers.kind?.choice
  return c === 'intent' || c === 'effort' || c === 'missed' || c === 'autonomy' || c === 'buried' ? c : 'intent'
}

export function excerpt(text: string, max = 120): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

export async function slugOf(remote: string, root: string): Promise<string> {
  const m = remote.trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/)
  return m?.[1] ?? root.split('/').filter(Boolean).pop() ?? 'unknown'
}

/** A project slug as a person reads it: the last segment of `owner/repo` or of a folder path. */
export function projectName(slug: string | undefined): string {
  return slug ? (slug.split(/[\\/]/).filter(Boolean).pop() ?? slug) : '출처 모름'
}

/** The same folder written two ways (`C:\Users\me`, `/c/Users/me/`). */
export function isSamePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/^\/([a-z])\//i, '$1:/').replace(/\/+$/, '').toLowerCase()
  return Boolean(a && b) && norm(a) === norm(b)
}

type Placed = { scope?: Scope; project?: string; alsoIn?: string[]; skipIn?: string[] }

/**
 * Whether a lesson, rule or requirement rides in this project: its own project,
 * every project when global, and any project the person attached it to, unless
 * the person said no here.
 */
export function appliesTo(x: Placed, project: string): boolean {
  if (x.skipIn?.includes(project)) return false
  return x.scope === 'global' || x.project === project || Boolean(x.alsoIn?.includes(project))
}

/** Another project's item nobody has decided on here yet. */
export function isUndecided(x: Placed, project: string): boolean {
  return !appliesTo(x, project) && !x.skipIn?.includes(project)
}

/** The person's decision for this project: attach it here, or not. */
export function placeIn<T extends Placed>(x: T, project: string, isAttached: boolean): T {
  const without = (xs?: string[]) => (xs ?? []).filter(p => p !== project)
  return isAttached
    ? { ...x, alsoIn: [...without(x.alsoIn), project], skipIn: without(x.skipIn) }
    : { ...x, alsoIn: without(x.alsoIn), skipIn: [...without(x.skipIn), project] }
}
