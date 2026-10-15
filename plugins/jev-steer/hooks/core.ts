import type { Card, Feedback, Judgment, Kind, Requirement, Scope, Verdict } from '../types'

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'

/**
 * A Jev request body. Text cut to a length can split an emoji's surrogate pair,
 * and Jev refuses the whole request with a 400 ("invalid Unicode text"): a half
 * left alone becomes U+FFFD.
 */
export function jevBody(value: unknown): string {
  return JSON.stringify(value, (_, v) => (typeof v === 'string' ? v.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD') : v))
}

/**
 * Where Jev is reached. OpenRouter carries the same Jev on the same System One
 * API, billed to the OpenRouter account; with its key set it is used first.
 */
export type JevRoute = { name: 'OpenRouter' | 'TypeSafe'; url: string; model: string; key: string }
export function jevRouteOf(keys: { openRouter?: string; typeSafe?: string }): JevRoute | null {
  if (keys.openRouter) return { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/systemone', model: '~typesafe/jev-latest', key: keys.openRouter }
  if (keys.typeSafe) return { name: 'TypeSafe', url: JEV_URL, model: 'jev-latest', key: keys.typeSafe }
  return null
}
export const MAX_CANDIDATES = 24
/** Rules weighed per request: every rule in scope, the ones sharing the request's words first. */
export const MAX_RULE_CANDIDATES = 16
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

/** The one-line summary of every row in an ani INDEX.md, by id, whatever its status. */
export function indexSummaries(markdown: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map(c => c.trim())
    if (cells.length >= 7 && /^[SKF]-/.test(cells[1] ?? '')) out[cells[1] as string] = cells[5] ?? ''
  }
  return out
}

/** One file of ani's `patterns/`: its frontmatter and its `## ` sections. */
export type AniPattern = {
  id: string
  status: string
  date?: string
  project?: string
  quote?: string
  summary?: string
  keywords: string[]
  compiledFrom: string[]
  recurrence: number
  sections: Record<string, string>
  /** What the person said, from the pattern's excerpt (`> user: ...`): their words, not ani's summary. */
  said: string[]
}

export function parseAniPattern(markdown: string): AniPattern | null {
  const m = markdown.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) return null
  const fm: Record<string, string> = {}
  let last = ''
  for (const line of (m[1] as string).split('\n')) {
    const kv = line.match(/^([A-Za-z_]+):\s*(.*)$/)
    if (kv) fm[(last = kv[1] as string)] = (kv[2] as string).trim()
    else if (last && /^\s+\S/.test(line)) fm[last] = `${fm[last]} ${line.trim()}`
  }
  const list = (v?: string) => (v ?? '').replace(/^\[|\]$/g, '').split(',').map(x => x.trim()).filter(Boolean)
  const unquote = (v?: string) => (v ? v.replace(/^["']|["']$/g, '') : undefined)
  const sections: Record<string, string> = {}
  for (const part of (m[2] as string).split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n')
    sections[part.slice(0, nl < 0 ? undefined : nl).trim()] = nl < 0 ? '' : part.slice(nl + 1).trim()
  }
  if (!fm.id) return null
  return {
    id: fm.id,
    status: fm.status ?? '',
    date: fm.date ?? fm.date_compiled,
    project: unquote(fm.project),
    quote: unquote(fm.trigger_quote),
    summary: unquote(fm.summary),
    keywords: list(fm.keywords).map(k => k.toLowerCase()),
    compiledFrom: list(fm.compiled_from),
    recurrence: Number(fm.recurrence) || 0,
    sections,
    said: (sections.Excerpt ?? '').split('\n').map(l => l.match(/^>\s*user:\s*(.+)$/i)?.[1]?.replace(/\*\*/g, '').trim() ?? '').filter(Boolean),
  }
}

/** Mostly Latin letters: ani wrote its summaries in English, never the person's words here. */
export function isLatin(text?: string): boolean {
  const latin = (text?.match(/[A-Za-z]/g) ?? []).length
  return latin > 20 && latin > 2 * (text?.match(/[가-힣]/g) ?? []).length
}

const plain = (s?: string, max = 160) => (s ? excerpt(s.replace(/\*\*|`/g, ''), max) : undefined)

/**
 * An ani pattern as a lesson here: an S is a lesson for every project, an F the
 * lesson of the project it was said in. The summary is the INDEX row's line.
 */
export function aniCard(p: AniPattern, summary?: string): Card {
  const isSkill = p.id.startsWith('S-')
  return {
    id: p.id,
    ts: Date.parse(p.date ?? '') || 0,
    text: p.quote ?? p.said[0] ?? summary ?? p.summary ?? p.id,
    kind: 'intent',
    scope: isSkill || !p.project ? 'global' : 'personal-project',
    project: p.project ?? '',
    source: 'ani',
    keywords: p.keywords,
    lesson: (summary ?? p.summary)?.replace(/\*\*|`/g, '') ?? plain(p.sections.Correction ?? p.sections.Action),
    intent: plain(p.sections.Intent ?? p.sections.Situation),
    why: plain(p.sections.Misreading),
    count: isSkill ? Math.max(1, p.compiledFrom.length) : 1 + p.recurrence,
    ...(p.quote ? { examples: [p.quote] } : p.said.length ? { examples: p.said.slice(0, 3) } : {}),
  }
}

/** A compiled F: one of the cases the S it went into was made from. */
export function aniCase(p: AniPattern, at: number, cardId: string, summary?: string): Feedback {
  return {
    at,
    text: p.quote ?? p.said[0] ?? summary ?? p.id,
    cardId,
    project: p.project ?? '',
    aniId: p.id,
    said: p.quote ?? p.said[0],
    understood: plain(p.sections.Misreading),
    meant: plain(p.sections.Intent),
    judgment: summary?.replace(/\*\*|`/g, ''),
  }
}

/** One note of Claude Code's auto memory (`<config>/projects/<slug>/memory/*.md`). */
export type MemoryNote = {
  name: string
  description: string
  /** `feedback`, `user`, `project` or `reference`. */
  type: string
  /** The fact: the body before its **Why:** and **How to apply:** parts. */
  body: string
  why?: string
  how?: string
}

/** A YAML scalar as written: quotes removed only when they enclose the whole value. */
function unquoteYaml(v: string): string {
  const s = v.trim()
  if (/^"(?:[^"\\]|\\.)*"$/s.test(s)) {
    try {
      return String(JSON.parse(s.replace(/\n/g, ' ')))
    } catch {
      return s.slice(1, -1).replace(/\\(.)/g, '$1')
    }
  }
  if (/^'(?:[^']|'')*'$/s.test(s)) return s.slice(1, -1).replace(/''/g, "'")
  return s
}

/** A quoted scalar whose closing quote is still to come on a later line. */
function isOpenQuote(v: string): boolean {
  if (v.startsWith('"')) return !/^"(?:[^"\\]|\\.)*"/s.test(v)
  if (v.startsWith("'")) return !/^'(?:[^']|'')*'(?!')/s.test(v)
  return false
}

/**
 * Frontmatter as flat keys: `type: x` is `type`, `type: x` under `metadata:` is
 * `metadata.type`. Values may be quoted, continue on indented lines, span lines
 * inside quotes, or be `|` / `>` blocks.
 */
function frontmatterOf(text: string): Record<string, string> {
  type Value = { key: string; parts: string[]; style: 'plain' | 'quoted' | 'literal' | 'folded' }
  const out: Record<string, string> = {}
  const KEY = /^[ \t]*([A-Za-z_][\w-]*):(?:[ \t]+(.*?))?[ \t]*$/
  const start = (key: string, value: string): Value =>
    /^[|>][-+]?$/.test(value)
      ? { key, parts: [], style: value.startsWith('|') ? 'literal' : 'folded' }
      : { key, parts: value ? [value] : [], style: isOpenQuote(value) ? 'quoted' : 'plain' }
  let cur: Value | null = null
  let curIndent = 0
  // The top-level key with no value of its own: indented `key: value` lines under it are its children.
  let parent = ''
  let childIndent = -1
  const close = () => {
    if (!cur) return
    const v = cur.style === 'literal' ? cur.parts.join('\n').trim() : cur.parts.join(' ').replace(/\s+/g, ' ').trim()
    out[cur.key] = cur.style === 'plain' || cur.style === 'quoted' ? unquoteYaml(v) : v
    cur = null
  }
  for (const line of text.split('\n')) {
    const kv = line.match(KEY)
    const indent = (line.match(/^[ \t]*/) as RegExpMatchArray)[0].length
    if (cur?.style === 'quoted' && !(kv && indent === 0)) {
      cur.parts.push(line.trim())
      if (!isOpenQuote(cur.parts.join(' '))) close()
      continue
    }
    if (!line.trim()) {
      if (cur?.style === 'literal' || cur?.style === 'folded') cur.parts.push('')
      continue
    }
    if (kv && indent === 0) {
      close()
      parent = kv[2] ? '' : (kv[1] as string)
      childIndent = -1
      cur = start(kv[1] as string, kv[2] ?? '')
      curIndent = 0
      continue
    }
    if (cur && cur.key !== parent && indent > curIndent) {
      cur.parts.push(cur.style === 'literal' || cur.style === 'folded' ? line.replace(/^[ \t]+/, '') : line.trim())
      continue
    }
    if (parent && kv && (childIndent < 0 || indent === childIndent)) {
      close()
      childIndent = curIndent = indent
      cur = start(`${parent}.${kv[1]}`, kv[2] ?? '')
      continue
    }
    if (cur && cur.key === parent && childIndent < 0) cur.parts.push(line.trim())
  }
  close()
  return out
}

const MEMORY_MARK = /\*\*(?:Why|How to apply)(?::\*\*|\*\*:)/i

/** The text after a **Why:** or **How to apply:** mark, up to the next mark, heading or paragraph. */
function memorySection(body: string, mark: RegExp): string | undefined {
  const m = mark.exec(body)
  if (!m) return undefined
  const rest = body.slice(m.index + m[0].length).replace(/^\s+/, '')
  const end = rest.search(/\*\*(?:Why|How to apply)(?::\*\*|\*\*:)|\n#{1,6} |\n[ \t]*\n(?![ \t]*(?:[-*+]|\d+\.)[ \t])/i)
  return (end < 0 ? rest : rest.slice(0, end)).trim() || undefined
}

/** A memory note: its frontmatter, flat or nested under `metadata:`, and its body. Null when it has no frontmatter. */
export function parseMemoryNote(markdown: string): MemoryNote | null {
  const m = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').match(/^---[ \t]*\n(?:([\s\S]*?)\n)?---[ \t]*(?:\n([\s\S]*))?$/)
  if (!m) return null
  const fm = frontmatterOf(m[1] ?? '')
  const body = (m[2] ?? '').trim()
  const at = body.search(MEMORY_MARK)
  return {
    name: fm.name ?? '',
    description: fm.description ?? '',
    type: (fm.type || fm['metadata.type'] || '').toLowerCase(),
    body: (at < 0 ? body : body.slice(0, at)).trim(),
    why: memorySection(body, /\*\*Why(?::\*\*|\*\*:)/i),
    how: memorySection(body, /\*\*How to apply(?::\*\*|\*\*:)/i),
  }
}

/** Narrowest scope first: team → personal-project → global; same id keeps the narrowest. */
/** isEvery: weigh every card in scope (rules), not only those sharing a word with the request. */
export function pickCandidates(prompt: string, cards: readonly Card[], project: string, opts: { isEvery?: boolean; max?: number } = {}): Card[] {
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
    .filter(x => opts.isEvery || x.hits > 0 || x.c.source === 'jev')
    .sort((a, b) => b.hits - a.hits || b.c.ts - a.c.ts)
    .slice(0, opts.max ?? MAX_CANDIDATES)
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

/**
 * One project however it was recorded: `owner/repo` from the remote, the folder
 * name, or a whole Windows path all name the same project by their last segment.
 */
export function sameProject(a: string | undefined, b: string | undefined): boolean {
  return Boolean(a && b) && (a === b || projectName(a).toLowerCase() === projectName(b).toLowerCase())
}

type Placed = { scope?: Scope; project?: string; alsoIn?: string[]; skipIn?: string[] }

/**
 * Whether a lesson, rule or requirement rides in this project: its own project,
 * every project when global, and any project the person attached it to, unless
 * the person said no here.
 */
export function appliesTo(x: Placed, project: string): boolean {
  if (x.skipIn?.some(p => sameProject(p, project))) return false
  return x.scope === 'global' || sameProject(x.project, project) || Boolean(x.alsoIn?.some(p => sameProject(p, project)))
}

/** Another project's item nobody has decided on here yet. */
export function isUndecided(x: Placed, project: string): boolean {
  return !appliesTo(x, project) && !x.skipIn?.some(p => sameProject(p, project))
}

/** The person's decision for this project: attach it here, or not. */
export function placeIn<T extends Placed>(x: T, project: string, isAttached: boolean): T {
  const without = (xs?: string[]) => (xs ?? []).filter(p => !sameProject(p, project))
  return isAttached
    ? { ...x, alsoIn: [...without(x.alsoIn), project], skipIn: without(x.skipIn) }
    : { ...x, alsoIn: without(x.alsoIn), skipIn: [...without(x.skipIn), project] }
}
