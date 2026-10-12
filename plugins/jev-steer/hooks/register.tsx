import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Candidate, Card, Display, Need, Preview, Principle, Feedback, Judgment, Kind, Label, Requirement, Scope, Sent, View } from '../types'
import {
  JEV_URL,
  KIND_LABEL,
  MAX_PROMPT_CHARS,
  buildQuestions,
  describe,
  excerpt,
  judge,
  kindOf,
  noul,
  parseIndex,
  pickCandidates,
  scopeOf,
  slugOf,
  tokenize,
  type Answers,
} from './core'
import { KIND_COLOR, STATE_COLOR, bandSvg, bannerSvg, cardSvg, headingSvg, leadStripSvg, paneHeaderSvg, ruleSvg, rowSvg, sectionSvg, tableHeadSvg, titleRowSvg, detailSvg, textWidth, caseCardSvg, askCardSvg, nowCardSvg, listCardSvg, capLabelSvg, type CardRow, type Glow, type Pulse, type KindCount } from './ui'

// ── constants and state ─────────────────────────────────────────────────

const PANE = 'jev-steer'
const TITLE = 'ani · 피드백'
const KINDS: Kind[] = ['intent', 'effort', 'missed', 'autonomy', 'buried']
/**
 * The memory is small on purpose: a closed loop. A repeated correction merges
 * into the lesson it repeats, and when a scope is full the weakest lesson
 * (fewest corrections, oldest) gives way. The pressure is what refines lessons.
 */
const CAPACITY: Record<'personal-project' | 'global', number> = { 'personal-project': 12, global: 12 }
const SUBMIT_WAIT_MS = 1200
const ARCHIVE_MAX = 200
const REATTACH_EVERY = 6
const MAX_ATTACHED_LESSONS = 2
/** A lesson the same correction has hit this often is offered as a rule. */
const PROMOTE_AT = 3
/** Two-letter type tags for lesson kinds, as the file tree tags JS / PDF. */
const KIND_BADGE: Record<Kind, string> = { intent: '의도', effort: '정도', missed: '누락', autonomy: '월권', buried: '묻힘' }
const MAX_ATTACHED_REQS = 5
const SCOPE_NAME: Record<Scope, string> = { 'personal-project': '이 프로젝트', global: '모든 프로젝트', 'team-project': '팀' }
const EMPTY: View = { isBusy: false, isLabeled: false, answers: {}, judgments: [], recorded: null, error: null, lastMs: 0, applied: [], weighing: [] }
const DEFAULT_DISPLAY: Display = { chip: true, band: true, toast: true, pane: true }

const view = atom({ plugin: 'jev-steer', key: 'view' } as const, EMPTY)
const requirements = atom({ plugin: 'jev-steer', key: 'requirements' } as const, [] as Requirement[])
const isInjecting = atom({ plugin: 'jev-steer', key: 'isInjecting' } as const, false)
const sessionStartedAt = atom({ plugin: 'jev-steer', key: 'sessionStartedAt' } as const, 0)
const openSections = atom({ plugin: 'jev-steer', key: 'openSections' } as const, [] as string[])
const ackedLead = atom({ plugin: 'jev-steer', key: 'ackedLead' } as const, '')
type Beat = { ok: boolean | null; ms: number; at: number; detail?: string }
const beat = atom({ plugin: 'jev-steer', key: 'beat' } as const, { ok: null, ms: 0, at: 0 } as Beat)
type Tab = 'feedback' | 'lessons' | 'rules' | 'principles' | 'needs' | 'sent' | 'settings'
const paneTab = atom({ plugin: 'jev-steer', key: 'paneTab' } as const, 'lessons' as Tab)
const paneCols = atom({ plugin: 'jev-steer', key: 'paneCols' } as const, 0)
const sent = atom({ plugin: 'jev-steer', key: 'sent' } as const, null as Sent | null)
/** CSS px per layout cell in the desktop pane; calibrated from a screenshot. */
const PX_PER_CELL = 8
const editing = atom({ plugin: 'jev-steer', key: 'editing' } as const, '')
const isBandOpen = atom({ plugin: 'jev-steer', key: 'isBandOpen' } as const, false)
const display = atom({ plugin: 'jev-steer', key: 'display' } as const, DEFAULT_DISPLAY)
const expandedSections = atom({ plugin: 'jev-steer', key: 'expandedSections' } as const, [] as string[])
const pinned = atom({ plugin: 'jev-steer', key: 'pinned' } as const, [] as string[])
const keyLater = atom({ plugin: 'jev-steer', key: 'keyLater' } as const, false)
const hasKey = atom({ plugin: 'jev-steer', key: 'hasKey' } as const, true)

let project = 'unknown'
let root = ''
let home = ''
const recentPrompts: string[] = []
let latestSeq = 0
/** The draft Jev judged while the person typed, and what it said: reused at submit when the text matches. */
let drafted: { text: string; result: Result } | null = null
let draftSeq = 0
const DRAFT_IDLE_MS = 700
let lastAnswer = ''
let attachedReqIds: string[] = []

// ── memory ──────────────────────────────────────────────────────────────

async function ownCards($: EngineInterface): Promise<Card[]> {
  return ((await $.store.get('cards')) as Card[] | undefined) ?? []
}

function mineOf(cards: readonly Card[]): Card[] {
  return cards.filter(c => !c.isArchived && (c.project === project || c.scope === 'global'))
}

/** ani's own stores (read-only here) plus the lessons this mod keeps. */
async function loadCards($: EngineInterface): Promise<Card[]> {
  const stores: [string, Scope][] = [
    [`${root}/.ani/INDEX.md`, 'team-project'],
    [`${home}/.ani/INDEX.md`, 'global'],
  ]
  const ani: Card[] = []
  for (const [path, scope] of stores) {
    const text = await $.fs.read(path).catch(() => '')
    if (text) ani.push(...parseIndex(String(text), scope, project))
  }
  return [...ani, ...(await ownCards($)).filter(c => !c.isArchived)]
}

async function editCard($: EngineInterface, id: string, change: Partial<Card> | null) {
  const own = await ownCards($)
  const next = change === null ? own.filter(c => c.id !== id) : own.map(c => (c.id === id ? { ...c, ...change } : c))
  await $.store.set('cards', next)
  if (change === null) {
    await update($, pinned, ids => ids.filter(x => x !== id))
    await update($, view, v => (v.recorded?.cardId === id ? { ...v, recorded: null } : v))
  } else if (change.scope) {
    const scope = change.scope
    await update($, view, v => (v.recorded?.cardId === id ? { ...v, recorded: { ...v.recorded, scope } } : v))
  }
}

/** Keeps each scope within its capacity: muted first, then fewest corrections, then oldest. */
function enforceCapacity(cards: Card[]): Card[] {
  let out = cards
  for (const scope of ['personal-project', 'global'] as const) {
    const inScope = out.filter(c => !c.isArchived && !c.isRule && c.scope === scope && (scope === 'global' || c.project === project))
    const over = inScope.length - CAPACITY[scope]
    if (over <= 0) continue
    const weakest = [...inScope]
      .sort((a, b) => Number(!!b.isMuted) - Number(!!a.isMuted) || (a.count ?? 1) - (b.count ?? 1) || a.ts - b.ts)
      .slice(0, over)
      .map(c => c.id)
    // Archived, not deleted: a repeat of the same mistake brings it back with its count.
    out = out.map(c => (weakest.includes(c.id) ? { ...c, isArchived: true } : c))
  }
  const archived = out.filter(c => c.isArchived).sort((a, b) => b.ts - a.ts)
  const drop = new Set(archived.slice(ARCHIVE_MAX).map(c => c.id))
  return out.filter(c => !drop.has(c.id))
}

/**
 * Remembers one correction. If Jev says it corrects the same mistake as a
 * remembered lesson, the two become one (count + 1, the correction kept as an
 * example, the lesson rewritten with both in view); otherwise a new lesson.
 */
async function remember($: EngineInterface, prompt: string, answers: Answers, candidates: readonly Card[], now: number): Promise<Card | null> {
  const own = await ownCards($)
  const dupIndex = candidates.findIndex((c, i) => c.source === 'jev' && noul(answers, `c${i}_dup`) >= 0.7)
  const dup = dupIndex >= 0 ? own.find(c => c.id === candidates[dupIndex]?.id) : undefined
  const intentPrompt = recentPrompts[recentPrompts.length - 2] ?? ''
  const answer = lastAnswer
  const fb = ((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []
  const logIt = async (cardId: string) => {
    await $.store.set('feedbackLog', [{ at: now, text: prompt, cardId, project }, ...fb].slice(0, 500))
    $.clock.after(0, () => enrichFeedback($, now, prompt))
  }

  // Not a live lesson: maybe an archived one. A repeat revives it.
  let revived: Card | undefined
  if (!dup) {
    const archived = own.filter(c => c.isArchived && c.lesson && (c.scope === 'global' || c.project === project)).sort((a, b) => (b.count ?? 1) - (a.count ?? 1) || b.ts - a.ts).slice(0, 24)
    const ans = archived.length
      ? await askJev($, { correction: prompt.slice(0, 1500), earlier_request: intentPrompt.slice(0, 800) }, Object.fromEntries(archived.map((c, i) => [`z${i}`, { type: 'noul', instructions: `Is this correction about the same recurring mistake as this archived lesson, so one lesson covers both: "${describe(c)}"`, criteria: { true: 'same mistake', false: 'a different mistake' } }])))
      : null
    const best = ans ? archived.map((c, i) => ({ c, v: noul(ans, `z${i}`) })).sort((a, b) => b.v - a.v)[0] : undefined
    if (best && best.v >= 0.7) revived = best.c
  }
  const hit = dup ?? revived
  if (hit) {
    const dup = hit
    const merged: Card = {
      ...dup,
      ts: now,
      count: (dup.count ?? 1) + 1,
      examples: [prompt.slice(0, 300), ...(dup.examples ?? [dup.text])].slice(0, 3),
      isMuted: false,
      isArchived: false,
    }
    await $.store.set('cards', enforceCapacity(own.map(c => (c.id === dup.id ? merged : c))))
    $.clock.after(0, () => structure($, merged.id, intentPrompt, answer, prompt, merged))
    await logIt(merged.id)
    return merged
  }

  // Not the same mistake as a lesson: it stays a case with one judgment. Two
  // judgments that say the same thing become a lesson candidate (pairUp).
  await $.store.set('feedbackLog', [{ at: now, text: prompt, cardId: '', project, kind: kindOf(answers), scope: scopeOf(answers) }, ...fb].slice(0, 500))
  $.clock.after(0, () => enrichFeedback($, now, prompt))
  return null
}

const CANDIDATE_AT = 0.7

/**
 * A case's judgment is in: ask Jev whether it says the same thing as another
 * case still waiting. The first match makes a lesson candidate from the two.
 */
async function pairUp($: EngineInterface, at: number) {
  const fb = ((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []
  const me = fb.find(f => f.at === at)
  if (!me?.judgment || me.cardId || me.candidateId) return
  const others = fb.filter(f => f.at !== at && !f.cardId && !f.candidateId && f.judgment && f.project === me.project).slice(0, 8)
  if (!others.length) return
  const key = await $.env.get('TYPESAFE_API_KEY')
  if (!key) return
  const questions = Object.fromEntries(others.map((o, i) => [`p${i}`, {
    type: 'noul',
    instructions: `Does the new judgment describe the same recurring mistake, in the same kind of situation, as this earlier one: "${o.judgment}"`,
    criteria: { true: 'same mistake and situation; one lesson would cover both', false: 'a different mistake or a different situation' },
  }]))
  const res = await $.http.fetch(JEV_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state: { new_judgment: me.judgment, new_case: `${me.understood ?? ''} / ${me.meant ?? ''}` }, questions }),
  })
  if (!res.ok) return
  const answers = (JSON.parse(res.text) as { answers: Answers }).answers
  const best = others.map((o, i) => ({ o, p: noul(answers, `p${i}`) })).sort((x, y) => y.p - x.p)[0]
  if (!best || best.p < CANDIDATE_AT) return
  const id = `C-${at}`
  const cand: Candidate = { id, cases: [best.o.at, at], kind: me.kind ?? best.o.kind ?? 'intent', scope: me.scope ?? best.o.scope ?? 'personal-project' }
  const cands = ((await $.store.get('candidates')) as Candidate[] | undefined) ?? []
  await $.store.set('candidates', [...cands, cand])
  await $.store.set('feedbackLog', fb.map(f => (f.at === at || f.at === best.o.at ? { ...f, candidateId: id } : f)))
  // The lesson text, drafted from both cases by the small model.
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 400,
    timeoutMs: 20000,
    system:
      '같은 판단을 낳은 사례 두 개가 주어집니다. 둘을 함께 덮는 교훈 하나를 만드세요. JSON만 답하세요: {"intent": "...", "why": "...", "lesson": "...", "short": "..."}. 모두 한국어 한 문장, 말줄임표 금지. ' +
      'intent: 사용자가 실제로 원한 것(30자 이내). why: 에이전트가 왜 잘못 읽었는지(40자 이내). lesson: 그 상황에서 다음엔 할 일, 상황으로 시작(40자 이내). short: lesson을 20자 이내로 다시 요약.',
    prompt: [best.o, me].map((f, i) => `사례 ${i + 1}\n요청: ${f.before ?? ''}\n에이전트가 이해한 것: ${f.understood ?? ''}\n실제 의도: ${f.meant ?? ''}\n피드백: ${f.said ?? f.text}\n판단: ${f.judgment}`).join('\n\n'),
  })
  if (!r.isAnswered) return
  try {
    const t = JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] ?? '') as { intent?: string; why?: string; lesson?: string; short?: string }
    const short = t.short && [...t.short].length <= SHORT_MAX ? t.short : undefined
    const now = ((await $.store.get('candidates')) as Candidate[] | undefined) ?? []
    await $.store.set('candidates', now.map(c => (c.id === id ? { ...c, intent: t.intent, why: t.why, lesson: t.lesson, short } : c)))
  } catch {
    // stays a candidate without wording; the card falls back to the judgments
  }
}

/** The person said yes: the two cases become one lesson (count 2). */
async function acceptCandidate($: EngineInterface, id: string) {
  const cands = ((await $.store.get('candidates')) as Candidate[] | undefined) ?? []
  const c = cands.find(x => x.id === id)
  if (!c) return
  const fb = ((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []
  const cases = fb.filter(f => c.cases.includes(f.at))
  const now = await $.clock.now()
  const card: Card = {
    id: `J-${now}`,
    ts: now,
    text: cases[0]?.text.slice(0, 300) ?? c.lesson ?? '',
    kind: c.kind,
    scope: c.scope,
    project,
    source: 'jev',
    keywords: tokenize(cases.map(f => f.text).join(' ')).slice(0, 6),
    count: cases.length,
    examples: cases.map(f => f.text.slice(0, 300)),
    intent: c.intent,
    why: c.why,
    lesson: c.lesson ?? cases.map(f => f.judgment).filter(Boolean).join(' / '),
    short: c.short,
  }
  await $.store.set('cards', enforceCapacity([...(await ownCards($)), card]))
  await $.store.set('feedbackLog', fb.map(f => (c.cases.includes(f.at) ? { ...f, cardId: card.id, candidateId: undefined } : f)))
  await $.store.set('candidates', cands.filter(x => x.id !== id))
  if (!card.short) $.clock.after(0, () => shorten($))
}

/** Not yet: the two cases go back to waiting, and this pair is not offered again. */
async function declineCandidate($: EngineInterface, id: string) {
  const cands = ((await $.store.get('candidates')) as Candidate[] | undefined) ?? []
  await $.store.set('candidates', cands.map(c => (c.id === id ? { ...c, isDeclined: true } : c)))
}

/**
 * The one generative step, done by the small model outside the main
 * conversation: intent → why it went wrong → what to do next time. For a
 * merged lesson the earlier lesson is in view, so the rule generalises.
 */
async function structure($: EngineInterface, cardId: string, intentPrompt: string, answer: string, correction: string, previous?: Card) {
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 400,
    timeoutMs: 20000,
    system:
      'You turn a user\'s correction of a coding agent into a lesson the agent keeps. ' +
      'Reply with JSON only: {"intent": "...", "why": "...", "lesson": "...", "short": "..."}, all in Korean, each one complete short sentence. ' +
      'intent: what the user actually wanted (≤ 30자). ' +
      'why: why the agent got it wrong — the misreading, not just the action (≤ 40자). ' +
      'lesson: what to do next time in that situation, as a rule starting with the situation (≤ 40자). Write it one level above this incident so it would apply to the next similar task too: name the kind of work and the habit (e.g. "위치를 지정받으면 그 자리에 정확히 배치"), not this specific button, screen or value (not "꺾쇠를 왼쪽에"). ' +
      'short: the same lesson re-said in ≤ 20자 so it fits one short line whole — keep the key object and action, drop the rest. ' +
      'If an earlier lesson is given, write one lesson that covers both cases.',
    prompt: [
      previous?.lesson ? `Earlier lesson for the same mistake:\n${previous.lesson}` : '',
      `User's request before the correction:\n${intentPrompt.slice(0, 1500) || '(unknown)'}`,
      `Agent's answer:\n${answer.slice(0, 1500) || '(unknown)'}`,
      `User's correction:\n${correction.slice(0, 1500)}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
  })
  if (!r.isAnswered) {
    await editCard($, cardId, { structureError: r.reason })
    return
  }
  const json = r.text.match(/\{[\s\S]*\}/)?.[0]
  try {
    const t = JSON.parse(json ?? '') as { intent?: string; why?: string; lesson?: string; short?: string }
    if (!t.lesson) throw new Error('no lesson')
    const short = t.short && [...t.short].length <= SHORT_MAX ? t.short : undefined
    await editCard($, cardId, { intent: t.intent, why: t.why, lesson: t.lesson, short, structureError: undefined })
    if (!short) $.clock.after(0, () => shorten($))
  } catch {
    await editCard($, cardId, { structureError: 'unreadable' })
  }
}

const SHORT_MAX = 24

async function setFeedback($: EngineInterface, at: number, change: Partial<Feedback>) {
  const fb = ((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []
  await $.store.set('feedbackLog', fb.map(f => (f.at === at ? { ...f, ...change } : f)))
}

/**
 * Walk back the conversation from a correction: which request it points to
 * (maybe several turns up), what the agent did since, and the correction
 * itself in one line. The verbatim text stays as the record.
 */
async function enrichFeedback($: EngineInterface, at: number, prompt: string) {
  const all = await $.session.messages()
  if (!Array.isArray(all)) return
  const rows = all.filter(m => m.text.trim() && !(m.role === 'user' && m.toolResults?.length))
  let end = -1
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].role === 'user' && rows[i].text.includes(prompt.slice(0, 40))) { end = i; break }
  if (end < 0) end = rows.length
  const window = rows.slice(Math.max(0, end - 12), end)
  if (!window.length) return
  const transcript = window.map((m, i) => `[${i}] ${m.role === 'user' ? '사용자' : '에이전트'}: ${m.text.replace(/\s+/g, ' ').slice(0, 500)}`).join('\n')
  const res = await $.model.complete({
    model: 'haiku',
    maxTokens: 300,
    timeoutMs: 20000,
    system:
      '대화 기록과 그 뒤에 나온 사용자 피드백이 주어집니다. JSON만 답하세요: {"before": "...", "did": "...", "said": "...", "understood": "...", "meant": "...", "judgment": "..."}. 모두 한국어 한 문장, 각 80자 이내, 말줄임표 금지. 원래 요청의 구체적인 대상과 표현은 살려서 쓸 것. ' +
      'before: 이 피드백이 가리키는 사용자의 원래 요청(바로 앞이 아니라 몇 턴 위일 수 있음, 필요한 만큼 거슬러 올라갈 것). ' +
      'did: 그 요청 이후 에이전트가 실제로 한 것. said: 피드백 자체의 요지. ' +
      'understood: 에이전트가 요청을 무엇으로 이해했는지. meant: 사용자가 실제로 의도한 것. 둘의 차이가 드러나게 쓸 것. ' +
      'judgment: 이 사례 하나에서 내릴 수 있는 판단(일반 규칙이 아니라 "이 상황에서는 ~였다").',
    prompt: `대화 기록:\n${transcript}\n\n피드백:\n${prompt.slice(0, 1500)}`,
  })
  if (!res.isAnswered) return
  try {
    const t = JSON.parse(res.text.match(/\{[\s\S]*\}/)?.[0] ?? '') as { before?: string; did?: string; said?: string; understood?: string; meant?: string; judgment?: string }
    await setFeedback($, at, { before: t.before, did: t.did, said: t.said, understood: t.understood, meant: t.meant, judgment: t.judgment })
    if (t.judgment) await pairUp($, at)
  } catch {
    // leave the verbatim record as it is
  }
}

/**
 * Lessons with no short form get one, re-summarized to the limit rather than
 * cut. One call for the batch; anything still over the limit is asked again.
 */
async function shorten($: EngineInterface) {
  // One small call per lesson: a batch reply came back empty.
  const todo = mineOf(await ownCards($)).filter(c => c.lesson && !c.short).slice(0, 12)
  for (const c of todo) {
    let best: string | undefined
    for (let attempt = 0; attempt < 2 && !best; attempt++) {
      const r = await $.model.complete({
        model: 'haiku',
        maxTokens: 120,
        timeoutMs: 15000,
        system:
          `다음 교훈을 한국어 한 문장으로 다시 요약하세요. 공백 포함 ${attempt ? SHORT_MAX - 6 : SHORT_MAX - 4}자 이내. ` +
          '상황과 행동만 남기고 수식어는 버리세요. 말줄임표 금지. 요약문만 답하세요.',
        prompt: c.lesson as string,
      })
      await $.store.set('shortenLast', { at: await $.clock.now(), id: c.id, ok: r.isAnswered, text: r.isAnswered ? r.text.slice(0, 200) : String(r.reason) })
      if (!r.isAnswered) continue
      const t = r.text.trim().replace(/^["'“”]+|["'“”.]+$/g, '').split('\n')[0].trim()
      if (t && [...t].length <= SHORT_MAX && !t.includes('…')) best = t
    }
    if (best) await editCard($, c.id, { short: best })
  }
}

/** Lessons recorded before structuring worked: structure them now, a few at a time. */
async function backfill($: EngineInterface) {
  const todo = mineOf(await ownCards($)).filter(c => c.source === 'jev' && !c.lesson).slice(0, 6)
  for (const c of todo) await structure($, c.id, c.intent ?? '', '', c.text)
}

/** A standing requirement in the user's words, extracted short; the raw prompt is never stored. */
/**
 * Generic working rules ("반영해서 다시 고칠 것", "깔끔하게") match almost every
 * request, so they cost context everywhere and steer nothing. A requirement
 * must name a concrete target: a tool, file, place, component, value or name.
 */
const GENERIC = [
  /피드백.*(반영|수정)/, /다시\s*(고치|수정)/, /(깔끔|성의|퀄리티|완성도|꼼꼼|신경)/, /(잘|제대로|정확히)\s*(해|할|만들)/,
  /군더더기/, /(이해|파악)하기\s*쉽/, /사용성/,
]
export function isConcreteRequirement(text: string): boolean {
  const t = text.trim()
  if (t.length < 6) return false
  return !GENERIC.some(re => re.test(t))
}

async function extractRequirements($: EngineInterface, prompt: string, now: number) {
  const existing = (await loadReqs($)).map(r => r.text)
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 300,
    timeoutMs: 20000,
    system: [
      'Extract standing requirements from the user message: constraints that must keep holding in later turns AND name a concrete target',
      '(a tool or model, file or folder, UI place or component, a value, a name, a format).',
      'Skip general working attitudes that would apply to any request (quality, tidiness, "apply feedback", "fix it again", "be careful").',
      'Skip one-off instructions for this turn only, and anything already in the existing list.',
      'Good: "이미지 생성은 Codex CLI의 gpt-6-astra로", "ani 상태는 프롬프트 창 아래에", "src/generated는 수정 금지".',
      'Bad: "피드백 반영해서 다시 수정", "깔끔하게 표현", "군더더기 빼기".',
      'Reply with JSON only: {"requirements": ["..."]}, Korean, each ≤ 40자, at most 2. Empty list is the usual answer.',
    ].join(' '),
    prompt: `Existing:\n${existing.map(t => `- ${t}`).join('\n') || '(none)'}\n\nUser message:\n${prompt.slice(0, 3000)}`,
  })
  if (!r.isAnswered) return
  try {
    const list = (JSON.parse(r.text.match(/\{[\s\S]*\}/)?.[0] ?? '') as { requirements?: string[] }).requirements ?? []
    const add = list
      .filter(t => t && isConcreteRequirement(t) && !existing.includes(t))
      .map((text, i) => ({ id: `R-${now}-${i}`, text, ts: now, active: 1 }))
    if (add.length) await setReqs($, rs => [...rs, ...add].slice(-20))
  } catch {
    // nothing extracted
  }
}

// ── judging one prompt, before Claude answers ───────────────────────────

type Result = { judgments: Judgment[]; candidates: Card[]; reqIds: string[] }

/**
 * draft: judging what is being typed; no correction or requirement is recorded.
 * submit: the request going out; everything.
 * commit: the request went out on a draft's judgment; record only, leave the view.
 */
async function analyze($: EngineInterface, prompt: string, mode: 'draft' | 'submit' | 'commit' = 'submit', prevAttached: readonly string[] = []): Promise<Result | null> {
  const key = await $.env.get('TYPESAFE_API_KEY')
  await update($, hasKey, () => Boolean(key))
  if (!key) {
    await update($, view, v => ({ ...v, error: 'Jev 키가 없어요 · /jev-steer:ani-key로 설정' }))
    return null
  }
  const seq = mode === 'commit' ? latestSeq : ++latestSeq
  if (mode !== 'commit') await update($, view, v => ({ ...v, isBusy: true, error: null }))
  const started = await $.clock.now()
  const shown = await read($, display)
  try {
    const allCards = await loadCards($)
    // Rules ride every request; Jev weighs only lessons.
    const candidates = pickCandidates(prompt, allCards.filter(c => !c.isRule), project)
    const attachedBefore = mode === 'draft' ? [] : allCards.filter(c => prevAttached.includes(c.id))
    if (mode !== 'commit') await update($, view, v => ({ ...v, weighing: candidates.map(c => c.id) }))
    const reqs = (await loadReqs($)).filter(r => r.active >= 0.4)
    const state = {
      latest_user_message: prompt.slice(0, MAX_PROMPT_CHARS),
      earlier_user_messages: (mode === 'draft' ? recentPrompts.slice(-3) : recentPrompts.slice(-4, -1)).map(p => p.slice(0, 1000)),
      // Short replies ("1번으로 해줘", "했어") only make sense against what the assistant last said.
      assistant_last_reply: lastAnswer.slice(-1500),
      project,
    }
    const body = JSON.stringify({ model: 'jev-latest', state, questions: buildQuestions(candidates, reqs, attachedBefore) })
    const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
    // 5xx and 429 are transient on Jev's side: two retries with backoff.
    let res = await $.http.fetch(JEV_URL, { method: 'POST', headers, body })
    for (const wait of [400, 1500]) {
      if (res.ok || !(res.status >= 500 || res.status === 429) || seq !== latestSeq) break
      await $.clock.sleep(wait)
      res = await $.http.fetch(JEV_URL, { method: 'POST', headers, body })
    }
    const beatMs = (await $.clock.now()) - started
    await update($, beat, () => ({ ok: res.ok, ms: beatMs, at: started, detail: res.ok ? undefined : `HTTP ${res.status}` }))
    if (!res.ok) {
      await $.store.set('lastError', { status: res.status, body: res.text.slice(0, 300), at: started })
      throw new Error(res.status >= 500 ? `Jev가 잠시 응답하지 않아요 (${res.status})` : `Jev 오류 ${res.status}`)
    }
    const answers = (JSON.parse(res.text) as { answers: Answers }).answers

    // Requirements: Jev scores whether each still holds and whether it bears on
    // this request. It never deletes one.
    if (mode !== 'draft') {
      const scored = reqs.map((r, i) => ({ ...r, active: noul(answers, `r${i}_active`) }))
      const all = await read($, requirements)
      await setReqs($, () => all.map(r => scored.find(s => s.id === r.id) ?? r))
    }
    const reqIds = reqs
      .map((r, i) => ({ r, rel: noul(answers, `r${i}_relevant`), act: noul(answers, `r${i}_active`) }))
      .filter(x => x.rel >= 0.6 && x.act >= 0.4)
      .sort((a, b) => b.rel - a.rel)
      .slice(0, MAX_ATTACHED_REQS)
      .map(x => x.r.id)
    if (mode !== 'draft' && noul(answers, 'has_requirement') >= 0.6) $.clock.after(0, () => extractRequirements($, prompt, started))

    // A correction pushing against a lesson attached last turn means Jev attached it wrongly.
    for (const [i, c] of attachedBefore.entries()) {
      if (noul(answers, `p${i}_reverses`) < 0.6) continue
      const labels = ((await $.store.get('labels')) as Label[] | undefined) ?? []
      await $.store.set('labels', [...labels, { cardId: c.id, verdict: 'apply', isRight: false, same: 0, satisfy: 0, flip: 1, ts: started } as Label].slice(-2000))
      const reversals = (c.reversals ?? 0) + 1
      await editCard($, c.id, { reversals, ...(reversals >= 2 ? { isMuted: true } : {}) })
      if (shown.toast) $.ui.toast(reversals >= 2 ? `ani · "${c.short ?? c.lesson ?? c.text}" 반대 피드백 2번 · 이 교훈을 껐어요` : `ani · "${c.short ?? c.lesson ?? c.text}"은 이번엔 잘못 붙였어요 · 기록했어요`, { timeoutMs: 5000 })
    }

    let recorded: View['recorded'] = null
    if (mode !== 'draft' && noul(answers, 'is_correction') >= 0.6) {
      const card = await remember($, prompt, answers, candidates, started)
      if (card) recorded = { cardId: card.id, kind: card.kind, scope: card.scope, until: started }
      if (shown.toast) $.ui.toast(card ? `ani · 같은 판단 ${card.count}번째 — 교훈을 다듬을게요` : `ani · 사례로 기록했어요 · 같은 판단이 한 번 더 나오면 교훈 후보가 돼요`, { timeoutMs: 4000 })
    }

    if (mode !== 'draft' && noul(answers, 'is_correction') >= 0.6) {
      const ns = await loadNeeds($)
      const need = ns.find(n => n.status === 'confirmed')
      if (need) {
        const fitAns = await askJev($, { correction: prompt.slice(0, 1500) }, { fit: { type: 'noul', instructions: `Is this correction consistent with what the user says they want underneath: "${need.text}"`, criteria: { true: 'consistent', false: 'points somewhere else' } } })
        if (fitAns && noul(fitAns, 'fit') < 0.3) await $.store.set('needs', ns.map(n => (n.id === need.id ? { ...n, misfit: (n.misfit ?? 0) + 1 } : n)))
      }
    }
    const judgments = judge(candidates, answers).filter(j => j.id !== recorded?.cardId)
    if (mode === 'commit') {
      if (recorded) await update($, view, v => ({ ...v, recorded }))
      return { judgments, candidates, reqIds }
    }
    if (seq !== latestSeq) return null // a newer prompt is being judged; drop this stale answer
    const applied = judgments.filter(j => j.verdict === 'apply').sort((x, y) => y.same - x.same).slice(0, MAX_ATTACHED_LESSONS).map(j => j.id)
    const lastMs = (await $.clock.now()) - started
    await update($, beat, () => ({ ok: true, ms: lastMs, at: started }))
    await update($, view, v => {
      const kept = Object.fromEntries(Object.entries(v.answers).filter(([id]) => judgments.some(j => j.id === id)))
      return { isBusy: false, isLabeled: Object.keys(kept).length > 0, answers: kept, judgments, recorded: mode === 'draft' ? v.recorded : recorded, error: null, lastMs, applied, weighing: [], isDraft: mode === 'draft' }
    })
    return { judgments, candidates, reqIds }
  } catch (err) {
    if (seq !== latestSeq) return null
    const error = excerpt(String(err).replace(/^Error: /, ''), 70)
    const prev = await read($, view)
    if (prev.error !== error && shown.toast) $.ui.toast(`ani · ${error}`, { timeoutMs: 5000 })
    await update($, view, v => ({ ...v, isBusy: false, error }))
    return null
  }
}

function lessonLine(c: Card): string {
  const cause = c.why ?? c.did
  const ctx = [c.intent && `they wanted: ${c.intent}`, cause && `it went wrong because: ${cause}`].filter(Boolean).join('; ')
  return `- ${c.lesson ?? c.text}${ctx ? ` (${ctx})` : ''}`
}

/** What rides with the prompt: lessons Jev judged to apply, and the requirements that bear on it. */

async function loadPrinciples($: EngineInterface): Promise<Principle[]> {
  return ((await $.store.get('principles')) as Principle[] | undefined) ?? []
}
async function loadNeeds($: EngineInterface): Promise<Need[]> {
  return ((await $.store.get('needs')) as Need[] | undefined) ?? []
}

/** One yes/no batch to Jev; null when Jev is unreachable. */
async function askJev($: EngineInterface, state: Record<string, unknown>, questions: Record<string, unknown>): Promise<Answers | null> {
  const key = await $.env.get('TYPESAFE_API_KEY')
  if (!key || !Object.keys(questions).length) return null
  const res = await $.http.fetch(JEV_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions }),
  })
  return res.ok ? (JSON.parse(res.text) as { answers: Answers }).answers : null
}

const ruleText = (c: Card) => c.lesson ?? c.text

/**
 * A rule was just promoted. If it shares its reason with an active principle it
 * joins it; if it shares one with another loose rule, the two make a principle
 * candidate, worded by the small model.
 */
async function findPrinciple($: EngineInterface, ruleId: string) {
  const rules = (await ownCards($)).filter(c => c.isRule && !c.isMuted)
  const me = rules.find(c => c.id === ruleId)
  if (!me) return
  const ps = await loadPrinciples($)
  const used = new Set(ps.filter(p => p.status !== 'declined').flatMap(p => p.from))
  if (used.has(me.id)) return
  const active = ps.filter(p => p.status === 'active')
  const loose = rules.filter(c => c.id !== me.id && !used.has(c.id)).slice(0, 8)
  const q: Record<string, unknown> = {}
  active.forEach((p, i) => (q[`a${i}`] = { type: 'noul', instructions: `Does the new rule follow from this principle, for the same underlying reason: "${p.text}"`, criteria: { true: 'same reason', false: 'a different reason' } }))
  loose.forEach((c, i) => (q[`l${i}`] = { type: 'noul', instructions: `Do the new rule and this rule share the same underlying reason, so one principle would cover both: "${ruleText(c)}"`, criteria: { true: 'same reason', false: 'different reasons' } }))
  const answers = await askJev($, { new_rule: ruleText(me), why: me.why ?? '' }, q)
  if (!answers) return
  const fit = active.map((p, i) => ({ p, v: noul(answers, `a${i}`) })).sort((a, b) => b.v - a.v)[0]
  if (fit && fit.v >= 0.7) {
    await $.store.set('principles', ps.map(p => (p.id === fit.p.id ? { ...p, from: [...p.from, me.id] } : p)))
    return
  }
  const pair = loose.map((c, i) => ({ c, v: noul(answers, `l${i}`) })).sort((a, b) => b.v - a.v)[0]
  if (!pair || pair.v < 0.7) return
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 160,
    timeoutMs: 20000,
    system: '같은 이유를 가진 규칙 두 개가 주어집니다. 둘을 함께 덮는 원칙 하나를 한국어 한 문장(40자 이내, 말줄임표 금지)으로 쓰세요. 특정 화면·도구 이름 대신 행동의 이유가 드러나게. 문장만 답하세요.',
    prompt: `규칙 1: ${ruleText(pair.c)}\n이유: ${pair.c.why ?? ''}\n규칙 2: ${ruleText(me)}\n이유: ${me.why ?? ''}`,
  })
  const text = r.isAnswered ? r.text.trim().split('\n')[0].replace(/^["'“”]+|["'“”]+$/g, '') : `${ruleText(pair.c)} / ${ruleText(me)}`
  const now = await $.clock.now()
  await $.store.set('principles', [...ps, { id: `P-${now}`, text, from: [pair.c.id, me.id], status: 'candidate', ts: now }])
}

async function setPrinciple($: EngineInterface, id: string, status: Principle['status']) {
  const ps = await loadPrinciples($)
  await $.store.set('principles', ps.map(p => (p.id === id ? { ...p, status } : p)))
  if (status === 'active') $.clock.after(0, () => proposeNeeds($))
}

/**
 * Two or more principles and no need on the table: read 2–3 hypotheses of what
 * they share, each with the principles it rests on. None goes to Claude until
 * the person confirms one.
 */
async function proposeNeeds($: EngineInterface) {
  const ps = (await loadPrinciples($)).filter(p => p.status === 'active')
  const ns = await loadNeeds($)
  if (ps.length < 2 || ns.some(n => n.status !== 'discarded')) return
  const r = await $.model.complete({
    model: 'haiku',
    maxTokens: 400,
    timeoutMs: 20000,
    system:
      '한 사용자가 AI 에이전트에게 반복해서 요구해 온 원칙 목록이 주어집니다. 이 원칙들 밑에 깔린 사용자의 근원 욕구를 가설로 2~3개 쓰세요. ' +
      '각각 사용자의 1인칭 한국어 한 문장(30자 이내, 말줄임표 금지), 그리고 근거가 된 원칙 번호. 서로 다른 해석이 되게. ' +
      'JSON만 답하세요: [{"text": "...", "from": [1, 2]}]',
    prompt: ps.map((p, i) => `${i + 1}. ${p.text}`).join('\n'),
  })
  if (!r.isAnswered) return
  try {
    const list = JSON.parse(r.text.match(/\[[\s\S]*\]/)?.[0] ?? '') as { text?: string; from?: number[] }[]
    const now = await $.clock.now()
    const fresh: Need[] = list.filter(x => x.text).slice(0, 3).map((x, i) => ({
      id: `N-${now}-${i}`,
      text: x.text as string,
      from: (x.from ?? []).map(n => ps[n - 1]?.id).filter(Boolean) as string[],
      status: 'hypothesis',
      ts: now,
    }))
    await $.store.set('needs', [...ns, ...fresh])
  } catch {
    // no hypotheses this time
  }
}

/** Confirm one hypothesis (the others are set aside), or discard one. */
async function setNeed($: EngineInterface, id: string, status: Need['status']) {
  const ns = await loadNeeds($)
  await $.store.set('needs', ns.map(n => (n.id === id ? { ...n, status, misfit: 0 } : status === 'confirmed' && n.status === 'hypothesis' ? { ...n, status: 'discarded' } : n)))
}

/** The person's own words, kept as they are: "근원 욕구: …" in a prompt. */
async function writeNeed($: EngineInterface, text: string) {
  const ns = await loadNeeds($)
  const now = await $.clock.now()
  await $.store.set('needs', [...ns.map(n => (n.status === 'discarded' ? n : { ...n, status: 'discarded' as const })), { id: `N-${now}`, text, from: [], status: 'confirmed', misfit: 0, ts: now }])
}


/**
 * Run the upper ladder on the lessons as they stand, without the counts it
 * normally waits for: Haiku groups lessons that share a reason into principle
 * drafts, Jev checks each lesson belongs to its group, then Haiku reads need
 * hypotheses from the drafts. Shown as a preview; nothing is confirmed.
 */
async function previewLadder($: EngineInterface) {
  const set = async (p: Partial<Preview>) => {
    const cur = ((await $.store.get('preview')) as Preview | undefined) ?? { at: 0, status: 'running', principles: [], needs: [] }
    await $.store.set('preview', { ...cur, ...p })
  }
  const lessons = mineOf(await ownCards($)).filter(c => c.lesson && !c.isMuted).slice(0, 24)
  await $.store.set('preview', { at: await $.clock.now(), status: 'running', step: `교훈 ${lessons.length}개를 이유별로 묶는 중`, principles: [], needs: [] })
  if (lessons.length < 2) return set({ status: 'error', error: '교훈이 2개 이상 있어야 해요' })
  const g = await $.model.complete({
    model: 'haiku',
    maxTokens: 900,
    timeoutMs: 30000,
    system:
      '한 사용자가 AI 에이전트를 교정하며 쌓은 교훈 목록이 주어집니다. 같은 근본 이유를 공유하는 교훈끼리 2~4개 묶음으로 나누고, 묶음마다 원칙 하나를 쓰세요. ' +
      '원칙은 한국어 한 문장(40자 이내, 말줄임표 금지), 특정 화면·도구 이름 대신 행동의 이유가 드러나게. 묶음마다 교훈 2개 이상. 어디에도 맞지 않는 교훈은 빼도 됩니다. ' +
      'JSON만 답하세요: [{"principle": "...", "lessons": [1, 4, 7]}]',
    prompt: lessons.map((c, i) => `${i + 1}. ${c.lesson}${c.why ? ` (틀린 이유: ${c.why})` : ''}`).join('\n'),
  })
  if (!g.isAnswered) return set({ status: 'error', error: `Haiku 응답 없음 (${g.reason})` })
  let groups: { principle: string; lessons: number[] }[] = []
  try {
    groups = (JSON.parse(g.text.match(/\[[\s\S]*\]/)?.[0] ?? '') as { principle?: string; lessons?: number[] }[])
      .filter(x => x.principle && x.lessons?.length)
      .map(x => ({ principle: x.principle as string, lessons: (x.lessons as number[]).filter(n => lessons[n - 1]) }))
  } catch {
    return set({ status: 'error', error: 'Haiku 답을 읽지 못했어요' })
  }
  await set({ step: `원칙 초안 ${groups.length}개 · Jev가 묶음을 확인하는 중` })
  // Jev: does each lesson really follow from its principle?
  const q: Record<string, unknown> = {}
  groups.forEach((gr, gi) => gr.lessons.forEach(n => (q[`g${gi}_${n}`] = {
    type: 'noul',
    instructions: `Does this lesson follow from the principle "${gr.principle}" for the same underlying reason: "${lessons[n - 1].lesson}"`,
    criteria: { true: 'same reason; the principle covers it', false: 'a different reason' },
  })))
  const a = await askJev($, { lessons: lessons.length }, q)
  const principles = groups
    .map((gr, gi) => {
      const kept = gr.lessons.map(n => ({ n, v: a ? noul(a, `g${gi}_${n}`) : 1 })).filter(x => x.v >= 0.5)
      return { text: gr.principle, from: kept.map(x => lessons[x.n - 1].id), fit: kept.length ? kept.reduce((t, x) => t + x.v, 0) / kept.length : 0 }
    })
    .filter(p => p.from.length >= 2)
  await set({ principles, step: `원칙 초안 ${principles.length}개 · 근원 욕구 가설을 쓰는 중` })
  if (principles.length < 1) return set({ status: 'done', step: undefined })
  const n = await $.model.complete({
    model: 'haiku',
    maxTokens: 400,
    timeoutMs: 20000,
    system:
      '한 사용자가 AI 에이전트에게 반복해서 요구해 온 원칙 목록이 주어집니다. 이 원칙들 밑에 깔린 사용자의 근원 욕구를 가설로 2~3개 쓰세요. ' +
      '각각 사용자의 1인칭 한국어 한 문장(30자 이내, 말줄임표 금지), 그리고 근거가 된 원칙 번호. 서로 다른 해석이 되게. JSON만 답하세요: [{"text": "...", "from": [1, 2]}]',
    prompt: principles.map((p, i) => `${i + 1}. ${p.text}`).join('\n'),
  })
  let needs: Preview['needs'] = []
  if (n.isAnswered) {
    try {
      needs = (JSON.parse(n.text.match(/\[[\s\S]*\]/)?.[0] ?? '') as { text?: string; from?: number[] }[]).filter(x => x.text).slice(0, 3).map(x => ({ text: x.text as string, from: x.from ?? [] }))
    } catch {
      // principles alone
    }
  }
  await set({ status: 'done', step: undefined, needs })
}

/** Keep one previewed principle as a real one. */
async function keepPreviewPrinciple($: EngineInterface, i: number) {
  const pv = (await $.store.get('preview')) as Preview | undefined
  const p = pv?.principles[i]
  if (!pv || !p) return
  const now = await $.clock.now()
  await $.store.set('principles', [...(await loadPrinciples($)), { id: `P-${now}`, text: p.text, from: p.from, status: 'active', ts: now }])
  await $.store.set('preview', { ...pv, principles: pv.principles.filter((_, k) => k !== i) })
}

/** Confirm one previewed need, in the words shown. */
async function keepPreviewNeed($: EngineInterface, i: number) {
  const pv = (await $.store.get('preview')) as Preview | undefined
  const nd = pv?.needs[i]
  if (!pv || !nd) return
  await writeNeed($, nd.text)
  await $.store.set('preview', { ...pv, needs: [] })
}

async function attachment($: EngineInterface, r: Result): Promise<{ text: string; lessonIds: string[]; reqIds: string[] } | null> {
  const applied = r.judgments.filter(j => j.verdict === 'apply').sort((x, y) => y.same - x.same).slice(0, MAX_ATTACHED_LESSONS)
  const rules = mineOf(await ownCards($)).filter(c => c.isRule && !c.isMuted)
  const lessons = [...rules, ...applied.map(j => r.candidates.find(c => c.id === j.id)).filter((c): c is Card => !!c)]
  const reqs = (await loadReqs($)).filter(x => r.reqIds.includes(x.id) && isConcreteRequirement(x.text))
  const need = (await loadNeeds($)).find(n => n.status === 'confirmed')
  const principles = (await loadPrinciples($)).filter(p => p.status === 'active')
  if (!lessons.length && !reqs.length && !need && !principles.length) return null
  // Whatever went out in the last few requests is still in the conversation the
  // model reads: saying it again only piles up copies and over-weights it. Repeat
  // only after REATTACH_EVERY requests, or once a compaction has dropped it.
  const seq = (((await $.store.get('sendSeq')) as number | undefined) ?? 0) + 1
  const compactSeq = ((await $.store.get('compactSeq')) as number | undefined) ?? 0
  const lastAt = ((await $.store.get('lastAttached')) as Record<string, number> | undefined) ?? {}
  const isFresh = (id: string) => !(lastAt[id] && lastAt[id] > compactSeq && seq - lastAt[id] < REATTACH_EVERY)
  const ruleLines = lessons.filter(c => c.isRule && isFresh(c.id))
  const lessonLines = lessons.filter(c => !c.isRule && isFresh(c.id))
  const freshPrinciples = principles.filter(p => isFresh(p.id))
  const freshNeed = need && isFresh(need.id) ? need : undefined
  const freshReqs = reqs.filter(x => isFresh(x.id))
  await $.store.set('sendSeq', seq)
  const sentIds = [...ruleLines, ...lessonLines].map(c => c.id).concat(freshPrinciples.map(p => p.id), freshReqs.map(x => x.id), freshNeed ? [freshNeed.id] : [])
  await $.store.set('lastAttached', { ...lastAt, ...Object.fromEntries(sentIds.map(id => [id, seq])) })
  if (!ruleLines.length && !lessonLines.length && !freshPrinciples.length && !freshNeed && !freshReqs.length) {
    // All still in context from earlier requests: nothing new to add, but they still ride.
    return { text: '', lessonIds: lessons.map(c => c.id), reqIds: reqs.map(x => x.id) }
  }
  const text = [
    '[ani] From this user\'s own past corrections and standing requirements, judged to bear on this request. Follow them:',
    ...(freshNeed ? [`What this user wants underneath (their own words): ${freshNeed.text}`] : []),
    ...(freshPrinciples.length ? ['Principles (always):', ...freshPrinciples.map(p => `- ${p.text}`)] : []),
    ...(ruleLines.length ? ['Rules (always):', ...ruleLines.map(lessonLine)] : []),
    ...(lessonLines.length ? ['Lessons:', ...lessonLines.map(lessonLine)] : []),
    ...(freshReqs.length ? ['Requirements still in force:', ...freshReqs.map(x => `- ${x.text}`)] : []),
  ].join('\n')
  return { text, lessonIds: lessons.map(c => c.id), reqIds: reqs.map(x => x.id) }
}

async function label($: EngineInterface, j: Judgment, isRight: boolean) {
  const labels = ((await $.store.get('labels')) as Label[] | undefined) ?? []
  const one: Label = { cardId: j.id, verdict: j.verdict, isRight, same: j.same, satisfy: j.satisfy, flip: j.flip, ts: await $.clock.now() }
  await $.store.set('labels', [...labels, one].slice(-2000))
  // "Should apply" joins the running request (dropped at turn end); "doesn't" removes it.
  await update($, pinned, ids => (isRight ? [...new Set([...ids, j.id])] : ids.filter(x => x !== j.id)))
  await update($, view, v => ({ ...v, isLabeled: true, answers: { ...v.answers, [j.id]: isRight } }))
}

async function unanswer($: EngineInterface, id: string) {
  await update($, view, v => {
    const answers = { ...v.answers }
    delete answers[id]
    return { ...v, answers, isLabeled: Object.keys(answers).length > 0 }
  })
}

async function toggleDisplay($: EngineInterface, key: keyof Display) {
  const next = await update($, display, d => ({ ...d, [key]: !d[key] }))
  await $.store.set('display', next)
}

async function kindCounts($: EngineInterface): Promise<KindCount[]> {
  const live = mineOf(await ownCards($)).filter(c => !c.isMuted)
  return KINDS.map(k => ({ color: KIND_COLOR[k], n: live.filter(c => c.kind === k).length, label: KIND_LABEL[k] }))
}

// ── what the band says ─────────────────────────────────────────────────

type Action = { key: string; label: string; run: () => unknown; isPrimary?: boolean }
type Band = { color: string | null; head: string; sub: string; isQuiet: boolean; actions: Action[]; label?: string; quote?: string }

function triple(c: Card | undefined): string {
  if (!c) return ''
  if (!c.lesson) return c.structureError ? '정리하지 못했어요 · 패널에서 다시 정리' : '의도 → 이유 → 다음엔, 으로 정리하는 중…'
  return `의도 ${c.intent ?? '?'}  →  이유 ${c.why ?? c.did ?? '?'}  →  다음엔 ${c.lesson}`
}

/** Most urgent first; every state is a head line, a small line and at most two actions. */
async function bandModel($: EngineInterface): Promise<Band> {
  const v = await read($, view)
  const own = await ownCards($)
  const live = mineOf(own).filter(c => !c.isMuted)
  const openPane: Action = { key: 'b-open', label: '보기', run: () => $.ui.open({ id: PANE, title: TITLE }) }

  if (v.error) return { color: null, head: v.error, sub: '다음 입력 때 다시 판단해요', isQuiet: true, actions: [openPane] }
  if (v.isBusy) return { color: null, head: '이번 요청에 맞는 교훈을 찾는 중', sub: `기억 ${live.length}개에서 고르는 중`, isQuiet: true, actions: [openPane] }
  if (v.recorded) {
    const r = v.recorded
    const c = own.find(x => x.id === r.cardId)
    const other: Scope = r.scope === 'global' ? 'personal-project' : 'global'
    const repeat = (c?.count ?? 1) > 1
    return {
      color: KIND_COLOR[r.kind],
      head: c?.lesson
        ? repeat ? `같은 교정 ${c.count}번째 · 교훈을 다듬었어요: "${c.lesson}"` : `새 교훈으로 기억했어요: "${c.lesson}"`
        : repeat ? `같은 교정 ${c?.count}번째 · 교훈을 다듬는 중` : `${KIND_LABEL[r.kind]} 교정을 기억했어요 · 교훈으로 정리하는 중`,
      label: c?.lesson ? (repeat ? `같은 교정 ${c.count}번째 · 교훈을 다듬었어요` : '새 교훈으로 기억했어요') : undefined,
      quote: c?.short ?? c?.lesson,
      sub: triple(c),
      isQuiet: false,
      actions: [
        { key: 'r-sc', label: `${SCOPE_NAME[r.scope]} ▾`, run: () => editCard($, r.cardId, { scope: other }) },
        { key: 'r-rm', label: '잊기', run: () => editCard($, r.cardId, null) },
      ],
    }
  }
  if (v.applied.length) {
    const first = own.find(c => c.id === v.applied[0])
    const j = v.judgments.find(x => x.id === v.applied[0])
    const reqN = attachedReqIds.length
    return {
      color: first ? KIND_COLOR[first.kind] : STATE_COLOR.hit,
      head: `교훈 ${v.applied.length}개${reqN ? ` · 규칙 ${reqN}개` : ''}를 이번 요청에 반영했어요`,
      sub: triple(first),
      isQuiet: false,
      actions: [
        ...(j && v.answers[j.id] === undefined ? [{ key: 'q-no', label: '이건 아니에요', run: () => label($, j, false) }] : []),
        openPane,
      ],
    }
  }
  const asks: Judgment[] = []
  const ask = asks[0]
  if (ask) {
    const c = own.find(x => x.id === ask.id)
    return {
      color: KIND_COLOR[ask.kind],
      head: `이것도 적용할까요? "${c?.lesson ?? ask.label}"`,
      // The strip asks one at a time, the panel lists them all: say how many wait.
      label: asks.length > 1 ? `이것도 적용할까요? · ${asks.length}개 중 1` : '이것도 적용할까요?',
      quote: c?.short ?? c?.lesson ?? ask.label,
      sub: c ? triple(c) : `다음엔 ${ask.label}`,
      isQuiet: false,
      actions: [
        { key: 'q-yes', label: '적용', run: () => label($, ask, true), isPrimary: true },
        { key: 'q-no', label: '상관없음', run: () => label($, ask, false) },
      ],
    }
  }
  const reqN = attachedReqIds.length
  return {
    color: null,
    head: live.length ? `기억 ${live.length}개 · 이번 요청엔 해당 없음${reqN ? ` · 규칙 ${reqN}개 반영` : ''}` : '아직 기억한 교훈이 없어요',
    sub: '교정하면 의도 → 이유 → 다음엔 으로 정리해서, 다음 요청에 알아서 반영해요',
    isQuiet: true,
    actions: [openPane],
  }
}

/** The always-on status: what is remembered, what rides this request. */
/**
 * The always-on line is one sentence about the request just sent — what ani
 * attached to it — plus a dim inventory of what it keeps.
 */
type Lead = { label: string; quote?: string; color?: string; isQuiet?: boolean }

async function statusModel($: EngineInterface): Promise<{ lead: Lead; inventory: string; line: string; alt: string }> {
  const v = await read($, view)
  const pinnedIds = await read($, pinned)
  const live = mineOf(await ownCards($)).filter(c => !c.isMuted).length
  const rules = mineOf(await ownCards($)).filter(c => c.isRule && !c.isMuted).length
  const out = await read($, sent)
  const onIds = [...new Set([...(out?.lessonIds ?? []), ...pinnedIds])]
  const lessonsOn = onIds.length
  const firstOn = mineOf(await ownCards($)).find(c => c.id === onIds[0])
  const rulesOn = attachedReqIds.length
  const inventory = `교훈 ${live} · 규칙 ${rules}`
  const parts = [lessonsOn ? `교훈 ${lessonsOn}개` : '', rulesOn ? `규칙 ${rulesOn}개` : ''].filter(Boolean).join(' · ')
  const draftOn = v.isDraft ? mineOf(await ownCards($)).filter(c => v.applied.includes(c.id)) : []
  const lead: Lead = v.isDraft && !v.isBusy
    ? draftOn.length
      ? { label: `보내면 교훈 ${draftOn.length}개를 붙여요`, quote: draftOn[0].short ?? draftOn[0].lesson, color: STATE_COLOR.ask }
      : { label: '보내면 붙일 교훈 없음', isQuiet: true }
    : v.isBusy
    ? { label: '방금 보낸 요청에 붙일 교훈 · 규칙을 고르는 중…', isQuiet: true }
    : recentPrompts.length === 0
      ? { label: '요청을 보내면 해당되는 교훈 · 규칙을 골라 함께 붙여요', isQuiet: true }
      : out?.isLate && !parts
        ? { label: 'Jev가 늦어 방금 보낸 요청엔 아무것도 붙이지 못했어요', isQuiet: true }
        : parts
        ? firstOn?.lesson
          ? { label: `방금 보낸 요청에 ${parts}를 붙였어요`, quote: firstOn.short ?? firstOn.lesson, color: STATE_COLOR.hit }
          : { label: `방금 보낸 요청에 ${parts}를 붙였어요`, color: STATE_COLOR.hit }
        : { label: '방금 보낸 요청엔 붙인 게 없어요', isQuiet: true }
  const text = lead.quote ? `${lead.label} "${lead.quote}"` : lead.label
  return { lead, inventory, line: `ani  ${text}  ·  ${inventory}`, alt: `ani: ${text}. ${inventory}` }
}

/** Requirements are the part that matters most, so they persist across sessions. */
async function setReqs($: EngineInterface, fn: (rs: Requirement[]) => Requirement[]) {
  const base = await loadReqs($)
  const next = await update($, requirements, () => fn(base))
  await $.store.set('requirements', next)
  return next
}

/** Session state first; on a fresh session, what was saved before. */
async function loadReqs($: EngineInterface): Promise<Requirement[]> {
  const rs = await read($, requirements)
  if (rs.length) return rs
  const saved = ((await $.store.get('requirements')) as Requirement[] | undefined) ?? []
  return saved.filter(r => r.text.length <= 80 && isConcreteRequirement(r.text))
}

/** A tiny Jev call that only proves the line is up. */
async function ping($: EngineInterface) {
  const key = await $.env.get('TYPESAFE_API_KEY')
  const at = await $.clock.now()
  await update($, hasKey, () => Boolean(key))
  if (!key) return update($, beat, () => ({ ok: false, ms: 0, at, detail: '키 없음' }))
  try {
    const res = await $.http.fetch(JEV_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state: { ping: true }, questions: { ok: { type: 'noul', instructions: 'Is this a connectivity check?', criteria: { true: 'yes', false: 'no' } } } }),
    })
    const ms = (await $.clock.now()) - at
    await update($, beat, () => ({ ok: res.ok, ms, at, detail: res.ok ? undefined : `HTTP ${res.status}` }))
  } catch (err) {
    await update($, beat, () => ({ ok: false, ms: 0, at, detail: excerpt(String(err), 40) }))
  }
}

function pulseOf(b: Beat, now: number): Pulse {
  if (b.ok === null) return { state: 'unknown', text: 'Jev 아직 확인 전' }
  if (!b.ok) return { state: 'down', text: `Jev 연결 안 됨${b.detail ? ` · ${b.detail}` : ''}` }
  const ago = Math.max(0, Math.round((now - b.at) / 1000))
  const when = ago < 60 ? `${ago}초 전` : ago < 3600 ? `${Math.round(ago / 60)}분 전` : `${Math.round(ago / 3600)}시간 전`
  return { state: ago > 600 ? 'stale' : 'live', text: `Jev 연결됨 · ${b.ms}ms · ${when}` }
}

async function toggleSection($: EngineInterface, key: string) {
  const next = await update($, openSections, xs => (xs.includes(key) ? xs.filter(x => x !== key) : [...xs, key]))
  await $.store.set('openSections', next)
}

async function forgetRequirement($: EngineInterface, id: string) {
  await setReqs($, rs => rs.filter(r => r.id !== id))
}

// ── hooks ───────────────────────────────────────────────────────────────

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    root = await $.session.root()
    home = (await $.env.get('HOME')) ?? ''
    const remote = await $.process
      .run(['git', '-C', root, 'remote', 'get-url', 'origin'])
      .then(r => (r.exitCode === 0 ? r.stdout : ''))
      .catch(() => '')
    project = await slugOf(remote, root)
    if ((await read($, sessionStartedAt)) === 0) {
      const now = await $.clock.now()
      await update($, sessionStartedAt, () => now)
    }
    // Requirements used to be whole prompts; keep only short ones.
    const savedReqs = (await $.store.get('requirements')) as Requirement[] | undefined
    if (savedReqs && (await loadReqs($)).length === 0) await update($, requirements, () => savedReqs)
    // Drop long raw prompts and generic working rules saved before the filter.
    await setReqs($, rs => rs.filter(r => r.text.length <= 80 && isConcreteRequirement(r.text)))
    const saved = (await $.store.get('display')) as Partial<Display> | undefined
    if (saved) await update($, display, () => ({ ...DEFAULT_DISPLAY, ...saved }))
    $.clock.after(0, () => ping($))
    $.clock.after(1500, () => shorten($))
    const savedOpen = (await $.store.get('openSections')) as string[] | undefined
    if (savedOpen) await update($, openSections, () => savedOpen)
    if ((await $.store.get('isBandOpen')) === true) await update($, isBandOpen, () => true)
    await $.command.register({ name: 'steer', description: 'ani: 기억한 교훈 보기·정리' })
    await $.command.register({ name: 'ani', description: 'ani 패널 열기' })
    { const k = await $.env.get('TYPESAFE_API_KEY'); await update($, hasKey, () => Boolean(k)) }
    // The pane is where ani lives: open it beside the transcript from the start.
    if ((await read($, display)).pane) $.clock.after(0, () => $.ui.open({ id: PANE, title: TITLE }))
    $.clock.after(0, () => backfill($))
    // Feedback logged before the walk-back existed gets its context now.
    $.clock.after(0, async () => {
      const fb = ((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []
      for (const f of fb.filter(x => !x.judgment).slice(0, 10)) await enrichFeedback($, f.at, f.text)
    })
    return next(e)
  })

  // Judge before Claude answers, up to SUBMIT_WAIT_MS, and attach what applies.
  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    if (!text || text.startsWith('/')) return next(e)
    {
      const m = text.match(/^근원\s*욕구\s*[:：]\s*(.+)$/s)
      if (m) await writeNeed($, m[1].trim().slice(0, 200))
    }
    if (/(ani|애니|패널|사이드\s*패널).{0,12}(열어|띄워|보여|켜)/i.test(text)) await $.ui.open({ id: PANE, title: TITLE })
    {
      const fb = ((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []
      const last = fb[0]
      if (last && last.text !== text && (last.after?.length ?? 0) < 2) await setFeedback($, last.at, { after: [...(last.after ?? []), excerpt(text, 80)] })
    }
    recentPrompts.push(text)
    if (recentPrompts.length > 6) recentPrompts.shift()
    // A one-time import (e.g. lessons rebuilt from an earlier conversation):
    // its lessons go live, the ones they replace are archived, its cases join the log.
    {
      const raw = await $.fs.read(`${home}/.ani/jev-steer-import.json`).catch(() => '')
      const imp = raw ? (JSON.parse(String(raw)) as { id: string; cards: Card[]; cases: Feedback[] }) : null
      const done = ((await $.store.get('imports')) as string[] | undefined) ?? []
      if (imp && !done.includes(imp.id)) {
        const own = await ownCards($)
        const have = new Set(own.map(c => c.id))
        const cards = [...own.map(c => (c.source === 'jev' && !have.has(c.id) ? c : c.source === 'jev' && !imp.cards.some(x => x.id === c.id) ? { ...c, isArchived: true } : c)), ...imp.cards.filter(c => !have.has(c.id))]
        await $.store.set('cards', cards)
        const fb = ((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []
        const known = new Set(fb.map(f => f.at))
        await $.store.set('feedbackLog', [...fb, ...imp.cases.filter(f => !known.has(f.at))].sort((a, b) => b.at - a.at).slice(0, 500))
        await $.store.set('imports', [...done, imp.id])
      }
    }
    // Cases written under the 40자 limit are walked back once more, at full length.
    if (!(await $.store.get('caseV2'))) {
      await $.store.set('caseV2', true)
      $.clock.after(0, async () => {
        const fb = ((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []
        for (const f of fb.slice(0, 12)) await enrichFeedback($, f.at, f.text)
      })
    }
    // Lessons still without a short form get one in the background.
    if (mineOf(await ownCards($)).some(c => c.lesson && !c.short)) $.clock.after(0, () => shorten($))
    const t0 = await $.clock.now()
    const prevIds = (await read($, sent))?.lessonIds ?? []
    draftSeq++
    const pre = drafted && drafted.text === text ? drafted.result : null
    await update($, view, v => ({ ...v, isDraft: false }))
    drafted = null
    if (pre) $.clock.after(0, () => analyze($, text, 'commit', prevIds))
    const result = pre ?? (await Promise.race([analyze($, text, 'submit', prevIds), $.clock.sleep(SUBMIT_WAIT_MS).then(() => null)]))
    const extra = result ? await attachment($, result) : null
    attachedReqIds = extra?.reqIds ?? []
    const at = await $.clock.now()
    const record = { at, prompt: text.slice(0, 200), text: extra?.text || null, lessonIds: extra?.lessonIds ?? [], reqIds: extra?.reqIds ?? [], isLate: !result, ms: at - t0 }
    await update($, sent, () => record)
    if (record.lessonIds.length && (await read($, display)).toast) {
      const first = (await ownCards($)).find(c => c.id === record.lessonIds[0])
      $.ui.toast(record.text
        ? `ani · 교훈 ${record.lessonIds.length}개를 붙여 보냈어요: ${first?.short ?? first?.lesson ?? ''}`
        : `ani · 교훈 ${record.lessonIds.length}개는 이미 대화에 있어 다시 붙이지 않았어요`, { timeoutMs: 4000 })
    }
    const log = ((await $.store.get('sentLog')) as (typeof record)[] | undefined) ?? []
    await $.store.set('sentLog', [record, ...log].slice(0, 20))
    return next(extra?.text ? { ...e, context: [...(e.context ?? []), extra.text] } : e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const text = box.text.trim()
    const seq = ++draftSeq
    if (text.length >= 8 && !text.startsWith('/') && text !== drafted?.text)
      $.clock.after(DRAFT_IDLE_MS, async () => {
        if (seq !== draftSeq) return
        const result = await analyze($, text, 'draft')
        if (result && seq === draftSeq) drafted = { text, result }
      })
    return box
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (r?.text) lastAnswer = r.text.slice(0, 1500)
    // A lesson the person chose to apply covers the request it was asked
    // about, not the rest of the session: Jev judges the next one afresh.
    await update($, pinned, () => [])
    return r
  })

  // A lesson the person chose to apply joins the request still running (its
  // remaining model calls), then drops at the end of the turn.
  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const ids = await read($, pinned)
    if (!ids.length) return composed
    const cards = (await ownCards($)).filter(c => ids.includes(c.id) && !c.isMuted)
    if (!cards.length) return composed
    const text = ['[ani] The user confirmed these lessons apply to the current request. Follow them:', ...cards.map(lessonLine)].join('\n')
    return { sections: [...composed.sections, { id: 'jev-steer:pinned', text, scope: 'session' as const }] }
  })

  on('ui.message', async ($, e, next) => {
    if (e.module.endsWith('opener.ts') && (e.data as { open?: unknown } | null)?.open === true) {
      await $.ui.open({ id: PANE, title: TITLE })
      return next(e)
    }
    const d = e.data as { cols?: unknown } | null
    if (e.module.endsWith('probe.ts') && d && typeof d.cols === 'number' && d.cols > 0) {
      const c = Math.round(d.cols)
      if ((await read($, paneCols)) !== c) await update($, paneCols, () => c)
    }
    return next(e)
  })

  // A compaction can drop what was attached earlier: from here, attach again.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    await $.store.set('compactSeq', ((await $.store.get('sendSeq')) as number | undefined) ?? 0)
    return r
  })

  on('command.run', { command: 'steer' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: 'ani 패널을 열었어요.' }
  })
  on('command.run', { command: 'ani' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })
    return { text: 'ani 패널을 열었어요.' }
  })

  // Main surface above the prompt. Desktop: a fixed-height type-set block (a
  // head line that must be read, a small line under it) and a fixed button
  // column. Terminal: one line of text.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, display)).band) return next(e)
    const b = await bandModel($)

    if (e.surface === 'desktop') {
      // Always one quiet line. A decision appears above it as a card, the way
      // a permission prompt does, and leaves once it is answered or the next
      // request goes out.
      const { Box, Button, Svg, Client } = $.ui.resolve(e)
      const st = await statusModel($)
      const v = await read($, view)
      const own = await ownCards($)
      void v
      const promos = mineOf(own).filter(c => !c.isMuted && !c.isRule && !c.isPromotionDeclined && (c.count ?? 1) >= PROMOTE_AT)
      const promo = promos[0]
      const cands = (((await $.store.get('candidates')) as Candidate[] | undefined) ?? []).filter(c => !c.isDeclined)
      const cand = cands[0]
      const full = Math.max(280, Math.round(e.props.bodyColumns * 7.6))
      const lead: Lead = { ...st.lead, quote: undefined }
      const invCols = st.inventory.length * 2 + 6
      const strip = leadStripSvg(Math.max(240, full - invCols * 8), lead, false, pulseOf(await read($, beat), await $.clock.now()).state)
      const line = (
        <Box key="strip" flexDirection="row" alignItems="center" justifyContent="space-between" width={e.props.bodyColumns} paddingRight={2}>
          <Box flexShrink={1} minWidth={0}>
            <Svg source={strip.source} alt={st.alt} />
          </Box>
          <Client key="opener" module="./opener.ts" props={{ text: st.inventory }} />
        </Box>
      )
      // No Jev key: nothing ani does works yet. Ask once a session, like a permission prompt.
      if (!(await read($, hasKey)) && !(await read($, keyLater))) {
        const color = STATE_COLOR.ask
        const card = askCardSvg(full - 40, {
          question: 'Jev 키가 있어야 ani가 교훈을 골라 붙일 수 있어요',
          lesson: '키 없이는 교정 기록·교훈 판단·승격이 모두 멈춰 있어요',
          intent: 'typesafe.ai 에서 키를 발급받아 숨김 입력창에 붙여넣어요',
          why: '키는 채팅에 남지 않고 ~/.claude/settings.json 에만 저장돼요',
          color,
        })
        return (
          <Box flexDirection="column" width={e.props.bodyColumns} gap={1}>
            <Box key="nokey" flexDirection="column" borderStyle="round" borderColor={color} paddingX={2} paddingY={1} gap={1}>
              <Svg source={card.source} width={card.width} height={card.height} alt="Jev 키가 필요해요" />
              <Box flexDirection="row" alignItems="center" gap={1}>
                {[
                  <Button key="k-yes" variant="primary" hotkey="1" label="키 설정하기" onPress={() => { void $.prompt.submit({ text: '/jev-steer:ani-key' }) }} />,
                  <Button key="k-no" variant="secondary" hotkey="2" label="나중에" onPress={() => update($, keyLater, () => true)} />,
                ]}
              </Box>
            </Box>
            {line}
          </Box>
        )
      }
      const pCand = (await loadPrinciples($)).find(p => p.status === 'candidate')
      const misfitNeed = (await loadNeeds($)).find(n => n.status === 'confirmed' && (n.misfit ?? 0) >= 3)
      if (pCand || misfitNeed) {
        const color = STATE_COLOR.hit
        const rules = own.filter(c => pCand?.from.includes(c.id))
        const card = askCardSvg(full - 40, pCand
          ? { question: `규칙 ${pCand.from.length}개가 같은 이유를 가져요. 원칙으로 묶을까요?`, lesson: pCand.text, intent: rules[0] ? ruleText(rules[0]) : undefined, why: rules[1] ? ruleText(rules[1]) : undefined, color }
          : { question: `최근 교정 ${misfitNeed!.misfit}개가 근원 욕구와 맞지 않아요. 다시 볼까요?`, lesson: misfitNeed!.text, color })
        const id = pCand?.id ?? misfitNeed!.id
        return (
          <Box flexDirection="column" width={e.props.bodyColumns} gap={1}>
            <Box key="layer" flexDirection="column" borderStyle="round" borderColor={color} paddingX={2} paddingY={1} gap={1}>
              <Svg source={card.source} width={card.width} height={card.height} alt={pCand ? `원칙으로 묶을까요? ${pCand.text}` : `근원 욕구를 다시 볼까요? ${misfitNeed!.text}`} />
              <Box flexDirection="row" alignItems="center" gap={1}>
                {pCand
                  ? [
                      <Button key="p-yes" variant="primary" hotkey="1" label="원칙으로 묶기" onPress={() => setPrinciple($, id, 'active')} />,
                      <Button key="p-no" variant="secondary" hotkey="2" label="아직은 규칙으로" onPress={() => setPrinciple($, id, 'declined')} />,
                    ]
                  : [
                      <Button key="n-yes" variant="primary" hotkey="1" label="다시 보기" onPress={async () => { await setNeed($, id, 'hypothesis'); await update($, paneTab, () => 'needs' as Tab); await $.ui.open({ id: PANE, title: TITLE, focus: true }) }} />,
                      <Button key="n-no" variant="secondary" hotkey="2" label="그대로 두기" onPress={() => setNeed($, id, 'confirmed')} />,
                    ]}
              </Box>
            </Box>
            {line}
          </Box>
        )
      }
      if (cand) {
        const color = STATE_COLOR.weigh
        const fb = ((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []
        const js = fb.filter(f => cand.cases.includes(f.at)).map(f => f.judgment).filter(Boolean) as string[]
        const card = askCardSvg(full - 40, {
          question: '같은 판단이 2번 나왔어요. 교훈으로 만들까요?',
          counter: cands.length > 1 ? `${cands.length}개 중 1` : undefined,
          lesson: cand.lesson ?? js[0] ?? '교훈 문장을 정리하는 중',
          intent: cand.intent,
          why: cand.why ?? js[1],
          color,
        })
        return (
          <Box flexDirection="column" width={e.props.bodyColumns} gap={1}>
            <Box key="cand" flexDirection="column" borderStyle="round" borderColor={color} paddingX={2} paddingY={1} gap={1}>
              <Svg source={card.source} width={card.width} height={card.height} alt={`교훈으로 만들까요? ${cand.lesson ?? js.join('. ')}`} />
              <Box flexDirection="row" alignItems="center" gap={1}>
                {[
                  <Button key="c-yes" variant="primary" hotkey="1" label="교훈으로 만들기" onPress={() => acceptCandidate($, cand.id)} />,
                  <Button key="c-no" variant="secondary" hotkey="2" label="아직은 사례로" onPress={() => declineCandidate($, cand.id)} />,
                ]}
              </Box>
            </Box>
            {line}
          </Box>
        )
      }
      if (!promo) return line
      const color = STATE_COLOR.ask
      const card = askCardSvg(full - 40, {
        question: `같은 교정이 ${promo.count}번 쌓였어요. 규칙으로 올릴까요?`,
        counter: promos.length > 1 ? `${promos.length}개 중 1` : undefined,
        lesson: promo.lesson ?? promo.text,
        intent: promo.intent,
        why: promo.why ?? promo.did,
        color,
      })
      return (
        <Box flexDirection="column" width={e.props.bodyColumns} gap={1}>
          <Box key="ask" flexDirection="column" borderStyle="round" borderColor={color} paddingX={2} paddingY={1} gap={1}>
            <Svg source={card.source} width={card.width} height={card.height} alt={`규칙으로 올릴까요? ${promo.lesson ?? promo.text}`} />
            <Box flexDirection="row" alignItems="center" gap={1}>
              {[
                <Button key="q-yes" variant="primary" hotkey="1" label="규칙으로 올리기" onPress={async () => { await editCard($, promo.id, { isRule: true }); $.clock.after(0, () => findPrinciple($, promo.id)) }} />,
                <Button key="q-no" variant="secondary" hotkey="2" label="아직은 교훈으로" onPress={() => editCard($, promo.id, { isPromotionDeclined: true })} />,
              ]}
            </Box>
          </Box>
          {line}
        </Box>
      )
    }

    if (b.isQuiet) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" alignItems="center" height={1} overflow="hidden" width={e.props.bodyColumns}>
        <Box flexShrink={0} flexDirection="row">
          <Text bold>ani </Text>
          <Text color={b.color ?? STATE_COLOR.quiet} dimColor={!b.color}>{b.color ? '▍' : '·'} </Text>
        </Box>
        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Text dimColor={b.isQuiet} wrap="truncate-end">{b.head}</Text>
        </Box>
        <Box flexShrink={0} flexDirection="row" gap={1}>
          {b.actions.map(a => (
            <Button key={a.key} variant={a.isPrimary ? 'primary' : 'secondary'} label={a.label} onPress={a.run} />
          ))}
        </Box>
      </Box>
    )
  })

  // Terminal: the status lives under the prompt, on the hint line, and the
  // band above shows only when there is something to answer.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (!(await read($, display)).chip || e.props.isDraft) return next(e)
    const st = await statusModel($)
    const hint = e.props.hint ? `${e.props.hint}  ·  ${st.line}` : st.line
    return next({ ...e, props: { ...e.props, hint } })
  })

  // The panel. What must be read is large (each lesson), the rest is small
  // (intent, cause, meta). Every lesson block is one type-set image; every
  // control sits in one fixed-width column on the right, so rows align.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const v = await read($, view)
    const shown = await read($, display)
    const since = await read($, sessionStartedAt)
    const pinnedIds = await read($, pinned)
    const reqs = await loadReqs($)
    const labels = ((await $.store.get('labels')) as Label[] | undefined) ?? []
    const right = labels.filter(l => l.isRight).length
    const accuracy = labels.length ? `${Math.round((right / labels.length) * 100)}%` : '—'
    const mine = mineOf(await ownCards($))
    const live = mine.filter(c => !c.isMuted)
    const unstructured = mine.filter(c => !c.lesson).length
    const sentIds = (await read($, sent))?.lessonIds ?? []
    const nowApplying = mine.filter(c => !c.isRule && (sentIds.includes(c.id) || pinnedIds.includes(c.id)))
    const maybe = v.judgments.filter(j => j.verdict === 'ask' && !v.applied.includes(j.id) && !pinnedIds.includes(j.id))
    const order = (list: Card[]) => [...list].sort((a, b) => (b.count ?? 1) - (a.count ?? 1) || b.ts - a.ts)
    const groups = [
      { key: 'pp', title: '이 프로젝트에만', cap: CAPACITY['personal-project'], cards: order(mine.filter(c => c.scope === 'personal-project')) },
      { key: 'gl', title: '모든 프로젝트에', cap: CAPACITY.global, cards: order(mine.filter(c => c.scope === 'global')) },
    ]
    const meta = (c: Card) =>
      [KIND_LABEL[c.kind], (c.count ?? 1) > 1 ? `교정 ${c.count}번 반복` : null, c.ts >= since ? '이번 세션' : null, c.isMuted ? '꺼짐' : null]
        .filter(Boolean)
        .join('  ·  ')
    const rows = (c: Card) =>
      c.lesson
        ? [
            { label: '의도', value: c.intent ?? '—' },
            { label: '이유', value: c.why ?? c.did ?? '—' },
          ]
        : [{ label: '원문', value: c.text }]

    if (e.surface === 'desktop') {
      // Quiet list, three tabs. One thing per tab; hairlines between rows;
      // color only where something rides the current request.
      const { Box, Text, Button, Select, Svg, Client, Code } = $.ui.resolve(e)
      const cols = await read($, paneCols)
      const paneW = cols > 0 ? Math.max(320, Math.min(1400, Math.round(cols * PX_PER_CELL) - 8)) : Math.max(320, Math.min(680, Math.round((e.viewport?.columns ?? 90) * 6.6) - 40))
      const tab = await read($, paneTab)
      const expandedEarly = new Set(await read($, expandedSections))
      const isOpenEarly = (k: string) => !expandedEarly.has(k)
      const pulse = pulseOf(await read($, beat), await $.clock.now())
      const reqOn = reqs.filter(x => attachedReqIds.includes(x.id)).length
      const riding = reqOn || nowApplying.length ? `이번 요청에 규칙 ${reqOn} · 교훈 ${nowApplying.length} 반영` : ''
      const head = paneHeaderSvg(paneW, pulse, riding)
      const sentNow = await read($, sent)
      const nowState: { state: 'busy' | 'hit' | 'idle' | 'late'; title: string; sub?: string } = v.isBusy
        ? { state: 'busy', title: 'Jev가 이번 요청에 붙일 교훈을 고르는 중', sub: `교훈 ${live.length}개 · 규칙 ${reqs.length}개 중에서` }
        : v.isDraft
          ? (() => {
              const draftCards = mine.filter(c => v.applied.includes(c.id))
              return draftCards.length
                ? { state: 'busy' as const, title: `보내면 교훈 ${draftCards.length}개를 붙여요`, sub: draftCards.map(c => c.short ?? c.lesson ?? c.text).join(' · ') }
                : { state: 'idle' as const, title: '보내면 붙일 교훈이 없어요', sub: '쓰는 중인 요청을 Jev가 미리 봤어요' }
            })()
        : !sentNow
          ? { state: 'idle', title: '요청을 기다리는 중', sub: '보내면 해당되는 교훈 · 규칙을 골라 함께 붙여요' }
          : sentNow.isLate
            ? { state: 'late', title: 'Jev가 늦어 아무것도 붙이지 못했어요', sub: '판단은 다음 요청부터 반영돼요' }
            : sentNow.text
              ? { state: 'hit', title: `교훈 ${sentNow.lessonIds.length}개 · 규칙 ${sentNow.reqIds.length}개를 붙였어요`, sub: `"${sentNow.prompt.slice(0, 40)}${sentNow.prompt.length > 40 ? '…' : ''}"` }
              : { state: 'idle', title: '이번 요청엔 붙인 게 없어요', sub: '해당되는 교훈 · 규칙이 없었어요' }
      const nowCard = nowCardSvg(paneW, nowState)
      const rule = ruleSvg(paneW)
      const hair = (k: string) => <Svg key={k} source={rule.source} width={rule.width} height={rule.height} alt="구분선" />
      const setTab = (t: Tab) => () => update($, paneTab, () => t)
      const dateOf = (ts: number) => { const d = new Date(ts); return `${d.getMonth() + 1}월 ${d.getDate()}일` }
      // A table: one image per row draws the text and the cells at fixed x,
      // and the only native control per row is one same-label button in a
      // fixed slot, so the right edge is a straight line. 관리 opens that
      // row's actions on a line of their own beneath it.
      // No per-row buttons: rows span the pane; one 관리 switch puts every row
      // into editing at once. Only rows awaiting an answer keep a button slot.
      const actionPx = tab === 'lessons' && maybe.some(j => v.answers[j.id] === undefined) && isOpenEarly('s-maybe') ? 150 : 0
      const bodyW = paneW - actionPx
      const colScope = bodyW - 210
      const colCount = bodyW - 8
      const textW = colScope - 24
      const isManaging = (await read($, editing)) === '*'
      const toggleManage = () => update($, editing, cur => (cur === '*' ? '' : '*'))
      // The first line (title + cells) and the action share one centered axis;
      // the detail sits beneath, outside that axis.
      const row = (key: string, spec: Parameters<typeof rowSvg>[1] & { glow?: Glow; isDim?: boolean }, action: unknown, below?: unknown) => {
        const detail = detailSvg(bodyW, { textWidth: textW, lines: spec.lines, meta: spec.meta, glow: spec.glow })
        const head = titleRowSvg(bodyW, { title: spec.title, textWidth: textW, isMuted: spec.isMuted, isDim: spec.isDim, cols: spec.cols, hasDetail: Boolean(detail), glow: spec.glow })
        return (
          <Box key={key} flexDirection="column">
            <Box flexDirection="row" alignItems="center" gap={3}>
              <Box flexShrink={1} minWidth={0}>
                <Svg source={head.source} alt={spec.title} />
              </Box>
              <Box flexShrink={0} flexDirection="row" alignItems="center" gap={1}>
                {action as never}
              </Box>
            </Box>
            {detail ? <Svg source={detail.source} alt={(spec.lines ?? []).map(l => `${l.label ?? ''} ${l.value}`).join('. ') || '세부'} /> : null}
            {below ? <Box flexDirection="row" alignItems="center" gap={1} marginBottom={1}>{below as never}</Box> : null}
            {hair(`h-${key}`)}
          </Box>
        )
      }
      const expanded = new Set(await read($, expandedSections))
      const fold = (key: string) => () => update($, expandedSections, cur => (cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key]))
      const isOpen = (key: string) => !expanded.has(key)
      const section = (key: string, title: string, count?: string) => {
        const sv = sectionSvg(Math.ceil(textWidth(title) * (17 / 11) + 10 + (count ? textWidth(count) * (14 / 11) : 0) + 4), title, count)
        return (
          <Box key={key} flexDirection="row" alignItems="center" gap={2}>
            <Svg source={sv.source} width={sv.width} height={sv.height} alt={title} />
            <Button key={`${key}-fold`} variant="secondary" dimColor label={isOpen(key) ? '접기' : '열기'} onPress={fold(key)} />
          </Box>
        )
      }
      const lessonHead = (key: string) => {
        const sv = tableHeadSvg(bodyW, [{ x: 0, text: '교훈' }, { x: colScope, text: '범위' }, { x: colCount, text: '반복', anchor: 'end' }])
        return [<Svg key={key} source={sv.source} width={sv.width} height={sv.height} alt="교훈, 범위, 반복" />, hair(`${key}-h`)]
      }
      const lessonRow = (c: Card, isOn: boolean) =>
        row(
          `c-${c.id}`,
          {
            title: c.lesson ?? c.text,
            isMuted: c.isMuted,
            glow: v.isBusy && (v.weighing ?? []).includes(c.id)
              ? { color: STATE_COLOR.ask, isFresh: false, isWeighing: true }
              : isOn && out && out.lessonIds.includes(c.id) && now - out.at < 8000 ? { color: STATE_COLOR.hit, isFresh: true } : undefined,
            lines: c.lesson
              ? [
                  ...(c.intent ? [{ label: '원했던 것', value: c.intent }] : []),
                  ...(c.why ?? c.did ? [{ label: '틀린 이유', value: (c.why ?? c.did) as string }] : []),
                ]
              : [],
            meta: [...(isOn ? [{ text: '이번 요청에 반영', color: STATE_COLOR.hit }] : []), { text: c.ts >= since ? '이번 세션' : dateOf(c.ts) }],
            cols: [
              { x: colScope, text: c.isMuted ? '꺼둠' : c.scope === 'global' ? '모든 프로젝트' : '이 프로젝트' },
              v.isBusy && (v.weighing ?? []).includes(c.id) ? { x: colCount, text: '판단 중', anchor: 'end', color: STATE_COLOR.ask, isPill: true } : isOn ? { x: colCount, text: '반영 중', anchor: 'end', color: STATE_COLOR.hit, isPill: true } : { x: colCount, text: `${c.count ?? 1}회`, anchor: 'end' },
            ],
          },
          null,
          isManaging
            ? [
                <Button key={`to-pp-${c.id}`} variant={!c.isMuted && c.scope === 'personal-project' ? 'primary' : 'secondary'} label="이 프로젝트" onPress={() => editCard($, c.id, { isMuted: false, scope: 'personal-project' })} />,
                <Button key={`to-gl-${c.id}`} variant={!c.isMuted && c.scope === 'global' ? 'primary' : 'secondary'} label="모든 프로젝트" onPress={() => editCard($, c.id, { isMuted: false, scope: 'global' })} />,
                <Button key={`mute-${c.id}`} variant={c.isMuted ? 'primary' : 'secondary'} label={c.isMuted ? '켜기' : '끄기'} onPress={() => editCard($, c.id, { isMuted: !c.isMuted })} />,
                <Button key={`rm-${c.id}`} variant="secondary" label="잊기" onPress={() => editCard($, c.id, null)} />,
              ]
            : null,
        )
      const out = await read($, sent)
      const now = await $.clock.now()
      const ago = (t: number) => { const s = Math.max(0, Math.round((now - t) / 1000)); return s < 60 ? `${s}초 전` : `${Math.round(s / 60)}분 전` }
      const verdictText = { apply: '붙임', ask: '물어봄', hold: '안 붙임' } as const
      const verdictColor = { apply: STATE_COLOR.hit, ask: STATE_COLOR.ask, hold: undefined } as const
      const plain = (key: string, title: string, sub?: string) => {
        const sv = sectionSvg(bodyW, title, sub)
        return <Svg key={key} source={sv.source} width={sv.width} height={sv.height} alt={title} />
      }
      const onList = mine.filter(c => nowApplying.includes(c))
      const askIds = new Set(maybe.map(j => j.id))
      const ruleCards = mine.filter(c => c.isRule)
      const restList = [...mine.filter(c => !c.isRule && !nowApplying.includes(c) && !askIds.has(c.id))].sort((a, b) => Number(Boolean(a.isMuted)) - Number(Boolean(b.isMuted)) || (b.count ?? 1) - (a.count ?? 1) || b.ts - a.ts)

      // File-tree grammar: a small-caps label and a chevron, then one rounded
      // card of one-line rows. Detail shows only for what rides the request,
      // or for every row while managing.
      const scopeName = (c: Card) => (c.isMuted ? '꺼둠' : c.scope === 'global' ? '모든 프로젝트' : '이 프로젝트')
      const subOf = (c: Card) => [...(c.intent ? [{ label: '원했던 것', value: c.intent }] : []), ...(c.why ?? c.did ? [{ label: '틀린 이유', value: (c.why ?? c.did) as string }] : [])]
      const weighing = new Set(v.isBusy ? v.weighing ?? [] : [])
      const fresh = (c: Card) => Boolean(out && out.lessonIds.includes(c.id) && now - out.at < 8000)
      const cardRow = (c: Card, isOn: boolean): CardRow => ({
        dot: KIND_COLOR[c.kind],
        badge: { text: KIND_BADGE[c.kind], color: KIND_COLOR[c.kind] },
        tone: weighing.has(c.id) ? STATE_COLOR.weigh : isOn ? STATE_COLOR.hit : undefined,
        title: c.lesson ?? c.text,
        scope: scopeName(c),
        isMuted: c.isMuted,
        pill: weighing.has(c.id) ? { text: '판단 중', color: STATE_COLOR.weigh } : isOn ? { text: '반영 중', color: STATE_COLOR.hit } : { text: `${c.count ?? 1}회` },
        shimmer: weighing.has(c.id) ? 'weigh' : isOn && fresh(c) ? 'fresh' : undefined,
        sub: isOn || isManaging ? subOf(c) : undefined,
      })
      const labelRow = (key: string, text: string, count: number) => {
        // A section title, sized above the rows it holds.
        const lb = sectionSvg(Math.ceil(textWidth(text) * (17 / 11) + 10 + textWidth(`${count}`) * (14 / 11) + 4), text, `${count}`)
        return (
          <Box key={key} flexDirection="row" alignItems="center" gap={2} marginTop={1}>
            <Svg source={lb.source} width={lb.width} height={lb.height} alt={`${text} ${count}`} />
            <Button key={`${key}-fold`} variant="secondary" dimColor label={isOpen(key) ? '접기' : '열기'} onPress={fold(key)} />
          </Box>
        )
      }
      const cardOf = (key: string, rows: CardRow[], tone?: string) => {
        const sv = listCardSvg(paneW, rows, tone)
        return <Svg key={key} source={sv.source} width={sv.width} height={sv.height} alt={rows.map(r => r.title).join('. ')} />
      }
      const manageRow = (c: Card, isOn: boolean) => (
        <Box key={`m-${c.id}`} flexDirection="column" marginTop={1}>
          {cardOf(`mc-${c.id}`, [cardRow(c, isOn)])}
          <Box flexDirection="row" gap={1} marginTop={1}>
            {[
              <Button key={`to-pp-${c.id}`} variant={!c.isMuted && c.scope === 'personal-project' ? 'primary' : 'secondary'} label="이 프로젝트" onPress={() => editCard($, c.id, { isMuted: false, scope: 'personal-project' })} />,
              <Button key={`to-gl-${c.id}`} variant={!c.isMuted && c.scope === 'global' ? 'primary' : 'secondary'} label="모든 프로젝트" onPress={() => editCard($, c.id, { isMuted: false, scope: 'global' })} />,
              <Button key={`mute-${c.id}`} variant={c.isMuted ? 'primary' : 'secondary'} label={c.isMuted ? '켜기' : '끄기'} onPress={() => editCard($, c.id, { isMuted: !c.isMuted })} />,
              <Button key={`rm-${c.id}`} variant="secondary" label="잊기" onPress={() => editCard($, c.id, null)} />,
            ]}
          </Box>
        </Box>
      )
      const pending: typeof maybe = []
      const own = await ownCards($)
      const sentLog = (((await $.store.get('sentLog')) as Sent[] | undefined) ?? [])
      const principles = await loadPrinciples($)
      const needs = await loadNeeds($)
      const cands = ((await $.store.get('candidates')) as Candidate[] | undefined) ?? []
      const feedbackLog = (((await $.store.get('feedbackLog')) as Feedback[] | undefined) ?? []).filter(f => f.project === project || own.find(c => c.id === f.cardId)?.scope === 'global')
      // The ladder reads left to right: what was said, what was learned, what always holds.
      const ladder: { key: Tab; label: string; n: number }[] = [
        { key: 'feedback', label: '사례', n: feedbackLog.length },
        { key: 'lessons', label: '교훈', n: mine.filter(c => !c.isRule && !c.isMuted).length },
        { key: 'rules', label: '규칙', n: mine.filter(c => c.isRule).length },
        { key: 'principles', label: '원칙', n: principles.filter(p => p.status === 'active').length },
        { key: 'needs', label: '근원 욕구', n: needs.filter(n => n.status === 'confirmed').length },
      ]
      const capOnly = (key: string, text: string, count: string) => {
        const lb = capLabelSvg(text, count)
        return <Box key={key} marginTop={2} marginBottom={1}><Svg source={lb.source} width={lb.width} height={lb.height} alt={`${text} ${count}`} /></Box>
      }
      const sentView = () =>
        !out
          ? [<Box key="sent-none" paddingY={2}><Text dimColor wrap="wrap">아직 보낸 요청이 없어요. 요청을 보내면 Claude에게 실제로 함께 간 내용이 여기 그대로 보여요.</Text></Box>]
          : [
              capOnly('sent-h', '방금 보낸 요청', ago(out.at)),
              cardOf('sent-card', [
                { dot: '#8a8a8a', title: out.prompt, pill: out.text ? { text: `교훈 ${out.lessonIds.length} · 규칙 ${out.reqIds.length}`, color: STATE_COLOR.hit } : { text: out.isLate ? '시간 초과' : '붙인 것 없음' } },
              ]),
              out.text ? capOnly('sent-c', 'Claude에게 함께 간 내용', `${out.ms}ms`) : null,
              out.text ? <Code key="sent-code" source={out.text} wrap="wrap" /> : null,
              ...(sentLog.filter(x => x.text).length
                ? [
                    capOnly('sent-log', '최근에 붙여 보낸 기록', `${sentLog.filter(x => x.text).length}`),
                    cardOf('sent-logc', sentLog.filter(x => x.text).slice(0, 8).map(x => ({
                      dot: STATE_COLOR.hit,
                      title: x.prompt,
                      pill: { text: ago(x.at) },
                      sub: [
                        ...x.lessonIds.map(id => ({ label: '교훈', value: own.find(c => c.id === id)?.lesson ?? id })),
                        ...x.reqIds.map(id => ({ label: '규칙', value: reqs.find(q => q.id === id)?.text ?? id })),
                      ],
                    }))),
                  ]
                : []),
              ...(v.judgments.length
                ? [
                    capOnly('sent-j', 'Jev가 판단한 교훈', `${v.judgments.length}`),
                    cardOf('sent-jc', v.judgments.map(j => {
                      const c = mine.find(x => x.id === j.id)
                      const isOut = out.lessonIds.includes(j.id)
                      return { dot: KIND_COLOR[j.kind], title: c?.lesson ?? j.label, scope: `같은 상황 ${Math.round(j.same * 100)}%`, pill: isOut ? { text: '붙임', color: STATE_COLOR.hit } : { text: '안 붙임' } }
                    })),
                  ]
                : []),
            ]
      const ruleView = () =>
        ruleCards.length
          ? []
          : [emptyNote('rules-empty', `아직 없어요. 같은 교정이 ${PROMOTE_AT}번 쌓인 교훈은 규칙으로 올릴지 물어봐요. 규칙은 그 범위의 모든 요청에 항상 붙어요.`)]
      const preview = (await $.store.get('preview')) as Preview | undefined
      const previewBlock = (which: 'principles' | 'needs') => {
        const isRunning = preview?.status === 'running'
        const btn = (
          <Box key={`pv-btn-${which}`} flexDirection="row" marginTop={1}>
            <Button key="pv-run" variant="secondary" label="지금 데이터로 미리 보기" onPress={() => { if (!isRunning) $.clock.after(0, () => previewLadder($)) }} />
          </Box>
        )
        const note = (k: string, t: string) => <Box key={k} paddingY={1}><Text dimColor wrap="wrap">{t}</Text></Box>
        if (!preview) return [btn, note('pv-hint', `지금 쌓인 교훈 ${mine.filter(c => c.lesson).length}개로 원칙과 근원 욕구를 미리 만들어 봐요. 확정하기 전에는 Claude에게 가지 않아요.`)]
        if (isRunning) return [btn, note('pv-run-note', `미리 보는 중 · ${preview.step ?? ''}`)]
        if (preview.status === 'error') return [btn, note('pv-err', `미리 보기 실패 · ${preview.error ?? ''}`)]
        const ps = preview.principles
        const body =
          which === 'principles'
            ? ps.length
              ? [
                  labelRow('s-pv-pr', '미리 본 원칙', ps.length),
                  ...ps.map((p, i) => (
                    <Box key={`pvp-${i}`} flexDirection="column" marginTop={1}>
                      {cardOf(`pvpc-${i}`, [{ dot: '#8a8a8a', title: p.text, pill: { text: `미리 보기 · ${Math.round(p.fit * 100)}%`, color: STATE_COLOR.weigh }, sub: own.filter(c => p.from.includes(c.id)).map(c => ({ label: '교훈', value: c.lesson ?? c.text })) }])}
                      <Box flexDirection="row" marginTop={1}>{[<Button key={`pvk-${i}`} variant="secondary" label="원칙으로 확정" onPress={() => keepPreviewPrinciple($, i)} />]}</Box>
                    </Box>
                  )),
                ]
              : [note('pv-none', '같은 이유로 묶이는 교훈 묶음을 찾지 못했어요.')]
            : preview.needs.length
              ? [
                  labelRow('s-pv-nd', '미리 본 근원 욕구', preview.needs.length),
                  ...preview.needs.map((nd, i) => (
                    <Box key={`pvn-${i}`} flexDirection="column" marginTop={1}>
                      {cardOf(`pvnc-${i}`, [{ dot: '#8a8a8a', title: nd.text, pill: { text: '가설', color: STATE_COLOR.weigh }, sub: nd.from.map(k => ps[k - 1]).filter(Boolean).map(p => ({ label: '원칙', value: p.text })) }])}
                      <Box flexDirection="row" marginTop={1}>{[<Button key={`pvnk-${i}`} variant="secondary" label="이걸로 확정" onPress={() => keepPreviewNeed($, i)} />]}</Box>
                    </Box>
                  )),
                  note('pv-nd-hint', '셋 다 아니면 요청에 "근원 욕구: (내 말)"이라고 쓰세요. 그 문장 그대로 확정돼요.'),
                ]
              : [note('pv-nd-none', '원칙 초안이 있어야 근원 욕구 가설을 쓸 수 있어요.')]
        return [btn, note('pv-when', `${ago(preview.at)} 미리 봄 · 확정하기 전에는 Claude에게 가지 않아요`), ...body]
      }
      const principlesView = () => {
        const shownPs = principles.filter(p => p.status !== 'declined')
        if (!shownPs.length) return [emptyNote('pr-empty', '아직 없어요. 같은 이유를 가진 규칙이 2개 이상 모이면 원칙 후보를 보여드려요. 원칙은 모든 프로젝트에 항상 적용돼요.'), ...previewBlock('principles')]
        return [
          ...previewBlock('principles'),
          labelRow('s-pr', '원칙', shownPs.length),
          ...(isOpen('s-pr')
            ? shownPs.map(p => (
                <Box key={`pr-${p.id}`} flexDirection="column" marginTop={1}>
                  {cardOf(`prc-${p.id}`, [{
                    dot: '#8a8a8a',
                    title: p.text,
                    pill: p.status === 'active' ? { text: '항상', color: STATE_COLOR.hit } : { text: '후보', color: STATE_COLOR.weigh },
                    sub: own.filter(c => p.from.includes(c.id)).map(c => ({ label: '규칙', value: ruleText(c) })),
                  }])}
                  {(p.status === 'candidate' || isManaging) && (
                    <Box flexDirection="row" gap={1} marginTop={1}>
                      {p.status === 'candidate'
                        ? [
                            <Button key={`pa-${p.id}`} variant="primary" label="원칙으로 묶기" onPress={() => setPrinciple($, p.id, 'active')} />,
                            <Button key={`pd-${p.id}`} variant="secondary" label="아직은 규칙으로" onPress={() => setPrinciple($, p.id, 'declined')} />,
                          ]
                        : [<Button key={`pr-rm-${p.id}`} variant="secondary" label="풀기" onPress={() => setPrinciple($, p.id, 'declined')} />]}
                    </Box>
                  )}
                </Box>
              ))
            : []),
        ]
      }
      const needsView = () => {
        const live = needs.filter(n => n.status !== 'discarded')
        const conf = live.find(n => n.status === 'confirmed')
        const hyps = live.filter(n => n.status === 'hypothesis')
        const pText = (ids: string[]) => principles.filter(p => ids.includes(p.id)).map(p => ({ label: '원칙', value: p.text }))
        if (!live.length)
          return [emptyNote('nd-empty', '아직 없어요. 원칙이 2개 이상 쌓이면 그 밑에 깔린 이유를 가설로 2~3개 보여드려요. 고른 문장만 확정되고, 요청에 "근원 욕구: (내 말)"이라고 쓰면 그 문장 그대로 확정돼요.'), ...previewBlock('needs')]
        return [
          ...previewBlock('needs'),
          ...(conf
            ? [
                labelRow('s-nd', '확정', 1),
                cardOf('nd-conf', [{ dot: '#8a8a8a', title: conf.text, pill: (conf.misfit ?? 0) >= 3 ? { text: `안 맞음 ${conf.misfit}`, color: STATE_COLOR.ask } : { text: '항상', color: STATE_COLOR.hit }, sub: pText(conf.from) }]),
              ]
            : []),
          ...(hyps.length
            ? [
                labelRow('s-hy', '가설', hyps.length),
                ...hyps.map(n => (
                  <Box key={`hy-${n.id}`} flexDirection="column" marginTop={1}>
                    {cardOf(`hyc-${n.id}`, [{ dot: '#8a8a8a', title: n.text, pill: { text: '가설', color: STATE_COLOR.weigh }, sub: pText(n.from) }])}
                    <Box flexDirection="row" gap={1} marginTop={1}>
                      {[
                        <Button key={`ny-${n.id}`} variant="primary" label="이걸로 확정" onPress={() => setNeed($, n.id, 'confirmed')} />,
                        <Button key={`nn-${n.id}`} variant="secondary" label="버리기" onPress={() => setNeed($, n.id, 'discarded')} />,
                      ]}
                    </Box>
                  </Box>
                )),
                <Box key="hy-note" paddingY={1}><Text dimColor wrap="wrap">셋 다 아니면 요청에 "근원 욕구: (내 말)"이라고 쓰세요. 그 문장 그대로 확정돼요.</Text></Box>,
              ]
            : []),
        ]
      }
      const settingsView = () => [
        capOnly('set-h', '설정', ''),
        cardOf('set-card', [
          { dot: pulse.state === 'live' ? STATE_COLOR.hit : '#8a8a8a', title: `Jev 연결 · ${pulse.text}`, pill: { text: pulse.state === 'live' ? '정상' : '확인 필요', color: pulse.state === 'live' ? STATE_COLOR.hit : STATE_COLOR.ask } },
          { dot: '#8a8a8a', title: '프롬프트 위 상태 줄', pill: shown.band ? { text: '켜짐', color: STATE_COLOR.hit } : { text: '꺼짐' } },
          { dot: '#8a8a8a', title: 'ani 패널 자동으로 열기 · 언제든 /ani', pill: shown.pane ? { text: '켜짐', color: STATE_COLOR.hit } : { text: '꺼짐' } },
          { dot: '#8a8a8a', title: '토스트 알림', pill: shown.toast ? { text: '켜짐', color: STATE_COLOR.hit } : { text: '꺼짐' } },
          { dot: '#8a8a8a', title: labels.length ? `판단 정확도 · 답한 ${labels.length}건 중 ${right}건 맞음` : '판단 정확도 · 아직 기록 없음', pill: { text: accuracy } },
        ]),
        <Box key="set-btns" flexDirection="row" gap={1} marginTop={1}>
          {[
            <Button key="ping" variant="secondary" label="Jev 지금 확인" onPress={() => ping($)} />,
            <Button key="d-band" variant="secondary" label={`상태 줄 ${shown.band ? '끄기' : '켜기'}`} onPress={() => toggleDisplay($, 'band')} />,
            <Button key="d-pane" variant="secondary" label={`자동 열기 ${shown.pane ? '끄기' : '켜기'}`} onPress={() => toggleDisplay($, 'pane')} />,
            <Button key="d-toast" variant="secondary" label={`토스트 ${shown.toast ? '끄기' : '켜기'}`} onPress={() => toggleDisplay($, 'toast')} />,
            ...(unstructured > 0 ? [<Button key="backfill" variant="secondary" label={`정리 안 된 교정 ${unstructured}개 정리`} onPress={() => backfill($)} />] : []),
          ]}
        </Box>,
      ]
      const emptyNote = (key: string, text: string) => <Box key={key} paddingY={2}><Text dimColor wrap="wrap">{text}</Text></Box>
      const feedbackView = () => [
        ...(feedbackLog.length
          ? [
              labelRow('s-fb', '사례', feedbackLog.length),
              ...(isOpen('s-fb')
                ? [(() => {
                    const sv = caseCardSvg(paneW, feedbackLog.slice(0, 30).map(f => {
                      const c = own.find(x => x.id === f.cardId)
                      const cd = cands.find(x => x.id === f.candidateId)
                      return { dot: c ? KIND_COLOR[c.kind] : '#8a8a8a', said: f.said ?? f.text, raw: f.text, when: ago(f.at), before: f.before, did: f.did, after: f.after, understood: f.understood, meant: f.meant, judgment: f.judgment, lesson: c?.lesson ?? (cd ? `후보 · ${cd.lesson ?? '정리하는 중'}` : f.judgment ? '판단 1개 · 같은 판단이 한 번 더 나오면 교훈 후보' : undefined) }
                    }))
                    return <Svg key="card-fb" source={sv.source} width={sv.width} height={sv.height} alt={feedbackLog.map(f => f.said ?? f.text).join('. ')} />
                  })()]
                : []),
            ]
          : [emptyNote('fb-empty', '아직 없어요. "아니 그게 아니라…"처럼 교정하면 사례로 쌓이고, 사례마다 판단 하나를 남겨요. 같은 판단이 2번 나오면 교훈 후보가 돼요.')]),
        ...(reqs.length
          ? [
              labelRow('s-reqs', '직접 말한 지시', reqs.length),
              ...(isOpen('s-reqs')
                ? isManaging
                  ? reqs.map(rq => (
                      <Box key={`mrq-${rq.id}`} flexDirection="column" marginTop={1}>
                        {cardOf(`mrqc-${rq.id}`, [{ dot: '#8a8a8a', title: rq.text, pill: attachedReqIds.includes(rq.id) ? { text: '반영 중', color: STATE_COLOR.hit } : { text: dateOf(rq.ts) } }])}
                        <Box flexDirection="row" marginTop={1}>{[<Button key={`rq-rm-${rq.id}`} variant="secondary" label="잊기" onPress={() => forgetRequirement($, rq.id)} />]}</Box>
                      </Box>
                    ))
                  : [cardOf('card-reqs', reqs.map(rq => ({ dot: '#8a8a8a', title: rq.text, pill: attachedReqIds.includes(rq.id) ? { text: '반영 중', color: STATE_COLOR.hit } : { text: dateOf(rq.ts) } })))]
                : []),
            ]
          : []),
      ]
      const lessonCards = [
        ...(pending.length
          ? [
              labelRow('s-maybe', '답 필요', pending.length),
              ...(isOpen('s-maybe')
                ? pending.flatMap((j, i) => {
                    const c = mine.find(x => x.id === j.id)
                    if (!c) return []
                    return [
                      cardOf(`ask-${c.id}`, [{ ...cardRow(c, false), pill: { text: '답 필요', color: STATE_COLOR.ask }, sub: subOf(c) }], STATE_COLOR.ask),
                      <Box key={`ask-b-${c.id}`} flexDirection="row" gap={1} marginTop={1}>
                        {[
                          <Button key={`yes-${i}`} variant="primary" label="적용" onPress={() => label($, j, true)} />,
                          <Button key={`no-${i}`} variant="secondary" label="이번엔 아님" onPress={() => label($, j, false)} />,
                        ]}
                      </Box>,
                    ]
                  })
                : []),
            ]
          : []),
        ...(onList.length
          ? [labelRow('s-on', '반영 중', onList.length), ...(isOpen('s-on') ? (isManaging ? onList.map(c => manageRow(c, true)) : [cardOf('card-on', onList.map(c => cardRow(c, true)))]) : [])]
          : []),
        ...(restList.length
          ? [labelRow('s-rest', onList.length ? '그 밖의 교훈' : '기억 중인 교훈', restList.length), ...(isOpen('s-rest') ? (isManaging ? restList.map(c => manageRow(c, false)) : [cardOf('card-rest', restList.map(c => cardRow(c, false)))]) : [])]
          : []),
      ]

      return (
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          <Client key="probe" module="./probe.ts" width="100%" />
          <Svg source={head.source} width={head.width} height={head.height} alt={`ani. ${pulse.text}. ${riding}`} />
          <Box marginTop={2}>
            <Svg source={nowCard.source} width={nowCard.width} height={nowCard.height} alt={`지금: ${nowState.title}`} />
          </Box>
          <Box flexDirection="row" flexWrap="wrap" alignItems="center" gap={1} marginTop={3} marginBottom={2}>
            {[
              ...ladder.flatMap((t, i) => [
                ...(i > 0 ? [<Text key={`arr-${t.key}`} dimColor>→</Text>] : []),
                <Button key={`tab-${t.key}`} variant={tab === t.key ? 'primary' : 'secondary'} dimColor={tab !== t.key && t.n === 0} label={`${t.label} ${t.n}`} onPress={setTab(t.key)} />,
              ]),
              <Text key="tab-sep" dimColor>│</Text>,
              <Button key="tab-sent" variant={tab === 'sent' ? 'primary' : 'secondary'} dimColor={tab !== 'sent'} label="보낸 내용" onPress={setTab('sent')} />,
              <Button key="tab-settings" variant={tab === 'settings' ? 'primary' : 'secondary'} dimColor={tab !== 'settings'} label="설정" onPress={setTab('settings')} />,
            ]}
          </Box>
          {hair('h-top')}

          {tab === 'sent' && sentView()}

          {tab === 'rules' && reqs.length === 0 && (
            <Box paddingY={2}><Text dimColor wrap="wrap">아직 없어요. "이미지는 Astra로"처럼 대상이 분명한 지시를 말하면 여기에 저장돼요.</Text></Box>
          )}
          {tab === 'rules' && ruleCards.length > 0 && [
            labelRow('s-rules', '교훈에서 올라온 규칙', ruleCards.length),
            ...(isOpen('s-rules')
              ? isManaging
                ? ruleCards.map(c => manageRow(c, false))
                : [cardOf('card-rules', ruleCards.map(c => ({ ...cardRow(c, false), pill: c.isMuted ? { text: '꺼둠' } : { text: '항상', color: STATE_COLOR.hit }, sub: subOf(c) })))]
              : []),
          ]}
          {(tab === 'lessons' || tab === 'rules' || tab === 'feedback') && (mine.length > 0 || reqs.length > 0) && (
            <Box key="lesson-tools" flexDirection="row" justifyContent="flex-start" marginTop={1}>
              <Button key="manage" variant={isManaging ? 'primary' : 'secondary'} dimColor={!isManaging} label="한 번에 관리" onPress={toggleManage} />
            </Box>
          )}
          {(tab === 'lessons' || tab === 'rules' || tab === 'feedback') && (mine.length > 0 || reqs.length > 0) && <Box key="tools-rule" marginTop={1}>{hair('tools-hair')}</Box>}
          {tab === 'feedback' && feedbackView()}
          {tab === 'rules' && ruleView()}
          {tab === 'principles' && principlesView()}
          {tab === 'needs' && needsView()}

          {tab === 'lessons' && mine.length === 0 && (
            <Box paddingY={2}><Text dimColor wrap="wrap">아직 없어요. "아니 그게 아니라…"처럼 교정하면 원했던 것, 틀린 이유, 다음엔 할 일로 정리해 둬요.</Text></Box>
          )}
          {tab === 'lessons' && lessonCards}

          {tab === 'settings' && settingsView()}
        </Box>
      )
    }

    // Terminal: same order, text only.
    const { Box, Text, Button } = $.ui.resolve(e)
    const heading = (title: string, right?: string) => (
      <Box flexDirection="row" marginTop={1}>
        <Text bold>{title}</Text>
        {right && <Text dimColor>{`  ${right}`}</Text>}
      </Box>
    )
    const row = (c: Card) => (
      <Box key={`t-${c.id}`} flexDirection="column" marginBottom={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={KIND_COLOR[c.kind]} dimColor={c.isMuted}>▍</Text>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Text bold={!c.isMuted} dimColor={c.isMuted} wrap="wrap">
              {c.lesson ? `다음엔 ${c.lesson}` : c.text}
            </Text>
          </Box>
          <Box flexShrink={0} flexDirection="row" gap={1}>
            <Button key={`mv-${c.id}`} label={c.scope === 'global' ? '이 프로젝트로' : '전체로'} onPress={() => editCard($, c.id, { scope: c.scope === 'global' ? 'personal-project' : 'global' })} />
            <Button key={`mu-${c.id}`} label={c.isMuted ? '켜기' : '끄기'} onPress={() => editCard($, c.id, { isMuted: !c.isMuted })} />
            <Button key={`rm-${c.id}`} label="잊기" onPress={() => editCard($, c.id, null)} />
          </Box>
        </Box>
        {rows(c).map(r => (
          <Text dimColor wrap="wrap">{`   ${r.label}  ${r.value}`}</Text>
        ))}
        <Text dimColor>{`   ${meta(c)}`}</Text>
      </Box>
    )
    return (
      <Box flexDirection="column">
        <Text bold>ani</Text>
        <Text dimColor>{`기억 중 ${live.length} · 지금 반영 중 ${nowApplying.length} · 판단 정확도 ${accuracy}`}</Text>
        {nowApplying.length > 0 && heading('지금 반영 중')}
        {nowApplying.map(row)}
        {maybe.length > 0 && heading('해당될 수도 있어요')}
        {maybe.map((j, i) => (
          <Box key={`tm-${j.id}`} flexDirection="row" gap={1}>
            <Box flexGrow={1} flexShrink={1} minWidth={0}>
              <Text wrap="wrap">{`다음엔 ${j.label}`}</Text>
            </Box>
            <Button key={`yes-${i}`} variant="primary" label="적용" onPress={() => label($, j, true)} />
            <Button key={`no-${i}`} label="상관없음" onPress={() => label($, j, false)} />
          </Box>
        ))}
        {groups.map(g => (
          <Box key={`tg-${g.key}`} flexDirection="column">
            {heading(`${g.title} · ${g.cards.length}/${g.cap}`)}
            {g.cards.length === 0 && <Text dimColor>아직 없어요</Text>}
            {g.cards.map(row)}
          </Box>
        ))}
        {heading(`내 규칙 · ${reqs.length}`)}
        {reqs.map(r => (
          <Text dimColor wrap="wrap">{`·  ${r.text}`}</Text>
        ))}
        <Box flexDirection="row" marginTop={1} gap={1}>
          <Text dimColor>표시</Text>
          <Button key="d-band" label={`프롬프트 위 ${shown.band ? '✓' : '—'}`} onPress={() => toggleDisplay($, 'band')} />
          <Button key="d-chip" label={`프롬프트 아래 상태 ${shown.chip ? '✓' : '—'}`} onPress={() => toggleDisplay($, 'chip')} />
          <Button key="d-toast" label={`토스트 ${shown.toast ? '✓' : '—'}`} onPress={() => toggleDisplay($, 'toast')} />
        </Box>
      </Box>
    )
  })
}
