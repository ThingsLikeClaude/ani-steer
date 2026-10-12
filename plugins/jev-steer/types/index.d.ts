export type Scope = 'global' | 'personal-project' | 'team-project'
export type Verdict = 'apply' | 'ask' | 'hold'
export type Kind = 'intent' | 'effort' | 'missed' | 'autonomy' | 'buried'

/**
 * One remembered correction, ani's triple: what the user meant, why the agent
 * got it wrong, what to do next time. `text` is the correction verbatim.
 */
export type Card = {
  id: string
  ts: number
  text: string
  kind: Kind
  scope: Scope
  project: string
  source: 'jev' | 'ani'
  keywords: string[]
  isMuted?: boolean
  /** What the user meant. ani's Intent. */
  intent?: string
  /** Why the agent got it wrong. ani's Misreading. */
  why?: string
  /** Older cards: what the agent did. Read through `why ?? did`. */
  did?: string
  /** What to do next time in that situation. */
  lesson?: string
  /** The lesson re-summarized to fit one short line (≤ 18자), never cut. */
  short?: string
  /** Why structuring failed, when it did. */
  structureError?: string
  /** How many corrections this lesson consolidates (1 when new). */
  count?: number
  /** Up to three verbatim corrections merged into it, newest first. */
  examples?: string[]
  /** Promoted by the person: a rule, attached to every request in its scope without asking Jev. */
  isRule?: boolean
  /** The person said not yet to promoting it. */
  isPromotionDeclined?: boolean
  /** How often the person corrected in the opposite direction right after it was attached. */
  reversals?: number
}

export type Judgment = {
  id: string
  label: string
  kind: Kind
  verdict: Verdict
  same: number
  satisfy: number
  flip: number
}

export type Requirement = { id: string; text: string; ts: number; active: number }

export type Recorded = { cardId: string; kind: Kind; scope: Scope; until: number }

export type Label = { cardId: string; verdict: Verdict; isRight: boolean; same: number; satisfy: number; flip: number; ts: number }

export type View = {
  isBusy: boolean
  isLabeled: boolean
  /** The person's answer per judged card id: true = it should apply. */
  answers: Record<string, boolean>
  judgments: Judgment[]
  recorded: Recorded | null
  error: string | null
  lastMs: number
  /** Card ids whose lessons were attached to the prompt just sent. */
  applied: string[]
  /** Card ids Jev is judging for the request in flight. */
  weighing?: string[]
  /** The judgment is of the draft being typed, not of a sent request. */
  isDraft?: boolean
}

/** What actually went out with the last request: the exact text, or nothing and why. */
export type Sent = { at: number; prompt: string; text: string | null; lessonIds: string[]; reqIds: string[]; isLate: boolean; ms: number }

/** One correction, verbatim: the evidence every higher layer points back to. */
export type Feedback = {
  at: number
  /** The correction, verbatim. Kept whole; shown summarized. */
  text: string
  /** The lesson it went into; empty while it is still only a case with a judgment. */
  cardId: string
  project: string
  kind?: Kind
  scope?: Scope
  /** Paired with another case into a lesson candidate. */
  candidateId?: string
  /** The request it points back to, found by walking back the conversation. */
  before?: string
  /** What the agent did in between. */
  did?: string
  /** The correction itself, in one line. */
  said?: string
  /** What the person said next (up to two turns): resolved, pressed again, or reversed. */
  after?: string[]
  /** What the agent took the request to mean. */
  understood?: string
  /** What the person actually meant. The gap between the two is the case. */
  meant?: string
  /** The judgment this one case supports; judgments add up to a lesson. */
  judgment?: string
}

export type Display = { chip: boolean; band: boolean; toast: boolean; pane: boolean }

declare module 'claude-code' {
  interface PluginState {
    'jev-steer': {
      view: View
      requirements: Requirement[]
      isInjecting: boolean
      isBandOpen: boolean
      openSections: string[]
      expandedSections: string[]
      ackedLead: string
      beat: { ok: boolean | null; ms: number; at: number; detail?: string }
      paneTab: "feedback" | "lessons" | "rules" | "principles" | "needs" | "sent" | "settings"
      paneCols: number
      sent: Sent | null
      editing: string
      display: Display
      sessionStartedAt: number
      /** Card ids the person said should apply: sent with every request this session. */
      pinned: string[]
      keyLater: boolean
      hasKey: boolean
    }
  }
}

/** Two cases whose judgments say the same thing: a lesson waiting for the person's yes. */
export type Candidate = {
  id: string
  cases: number[]
  kind: Kind
  scope: Scope
  intent?: string
  why?: string
  lesson?: string
  short?: string
  isDeclined?: boolean
}

/** Rules that share one reason, said once. Rides every request in every project once accepted. */
export type Principle = {
  id: string
  text: string
  /** The rules (card ids) it stands on. */
  from: string[]
  status: 'candidate' | 'active' | 'declined'
  ts: number
}

/** The want under the principles. Only the person's confirmed sentence goes to Claude. */
export type Need = {
  id: string
  text: string
  /** The principles it was read from. */
  from: string[]
  status: 'hypothesis' | 'confirmed' | 'discarded'
  /** Corrections since confirming that Jev judged not to fit it. */
  misfit?: number
  ts: number
}

/** A dry run of the upper ladder on today's lessons. Nothing in it rides a request until confirmed. */
export type Preview = {
  at: number
  status: 'running' | 'done' | 'error'
  step?: string
  error?: string
  principles: { text: string; from: string[]; fit: number }[]
  needs: { text: string; from: number[] }[]
}
