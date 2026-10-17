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
  source: 'jev' | 'ani' | 'memory'
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
  /** Made by the AI from its cases, never confirmed by the person: kept and corrected, not attached to requests. */
  isAuto?: boolean
  /** Archived because this newer lesson asks the opposite in the same situation. */
  replacedBy?: string
  /** The person said not yet to promoting it. */
  isPromotionDeclined?: boolean
  /** How often the person corrected in the opposite direction right after it was attached. */
  reversals?: number
  /** Over capacity: kept, not attached, still matched against new corrections so a repeat can revive it. */
  isArchived?: boolean
  /** Other projects the person attached it to. */
  alsoIn?: string[]
  /** Projects where the person decided it should not ride. */
  skipIn?: string[]
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

/**
 * A standing instruction. It rides in the project it was said in; elsewhere it
 * is listed as another project's, and rides only where the person attaches it.
 * Requirements saved before `project` existed belong to no project yet.
 */
/** scope: Jev's judgment, at saving, of whether it holds in every project; absent until judged. */
export type Requirement = { id: string; text: string; ts: number; active: number; project?: string; scope?: Scope; alsoIn?: string[]; skipIn?: string[] }

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
  /** The ani pattern (F-…) it was brought in from. */
  aniId?: string
  /** Found in a past conversation, before ani was recording: `before` and `did` hold that conversation's context. */
  fromHistory?: boolean
  /** The conversation around a case found in a past conversation: requests before and after, what the agent said and did. */
  context?: string
  /** The working habit the case shows, one level above this incident: what cases are paired by. */
  pattern?: string
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
      /** Which service carries Jev: 'OpenRouter', 'TypeSafe', or '' with no key. */
      jevVia: string
      /** The past-conversation run as it goes, in this session: kept off the store, written every few seconds. */
      histNow: { file: string; mb: number; step: string; startedAt: number; filesDone: number; files: number; prompts: number; found: number; ofRun: number; skipped: number } | null
      listLimit: number
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
  /** The project of the case that made it; a lesson made from it belongs there. */
  project?: string
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

/**
 * What every principle serves: the state the person wants from working with an
 * AI, read from the principles and judged by Jev to cover most of them. One at a
 * time; once confirmed it rides every request.
 */
export type Goal = {
  id: string
  text: string
  /** The principles Jev judged it to serve. */
  from: string[]
  /** How many of the active principles it served, out of how many, when it was read. */
  covers: number
  of: number
  status: 'hypothesis' | 'confirmed' | 'discarded'
  /** Corrections since confirming that Jev judged not to fit it. */
  misfit?: number
  ts: number
}

/**
 * Why the goal matters to the person: a value, below anything corrections can
 * show. Several can hold; one is marked the largest. Only the person's own pick
 * or own words are confirmed.
 */
export type Need = {
  id: string
  text: string
  /** The goal and principles it was read from or that serve it. */
  from: string[]
  status: 'hypothesis' | 'confirmed' | 'discarded'
  /** The one the person calls the largest. */
  isMain?: boolean
  /** No longer counted: misfits are judged against the goal. */
  misfit?: number
  ts: number
}

/** A dry run of principles from today's rules. Nothing in it rides a request until confirmed. */
export type Preview = {
  at: number
  status: 'running' | 'done' | 'error'
  step?: string
  error?: string
  principles: { text: string; from: string[]; fit: number }[]
  /** From before the goal layer; no longer drawn. */
  needs?: { text: string; from: number[] }[]
}
