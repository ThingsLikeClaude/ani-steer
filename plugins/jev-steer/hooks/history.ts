/**
 * Past conversations, read back from Claude Code's session transcripts
 * (`<config>/projects/<slug>/<session>.jsonl`): every request the person typed,
 * with the request before it and the agent's reply in between, so a correction
 * made before ani was installed can still become a case.
 */

/** One request the person typed, with what it answered. */
export type PastPrompt = {
  /** The transcript line's uuid: the same message copied into a resumed session stays one. */
  uuid: string
  at: number
  session: string
  /** The session's working directory: the project it was said in. */
  cwd: string
  text: string
  /** The person's request before this one. */
  before?: string
  /** What the agent said last before this one. */
  reply?: string
}

/** Turns the engine and other sessions write as the user's: never the person's own words. */
const NOT_TYPED = /^\s*(<|\/|Base directory for this skill|Another Claude session|Caveat:|This session is being continued|\[Request interrupted|Implement the following plan|Stop hook feedback|# )/
const MAX_TEXT = 1500

type Line = {
  type?: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  isSidechain?: boolean
  isMeta?: boolean
  message?: { content?: unknown }
}

function textOf(content: unknown): { text: string; isToolResult: boolean } {
  if (typeof content === 'string') return { text: content, isToolResult: false }
  if (!Array.isArray(content)) return { text: '', isToolResult: false }
  const blocks = content as { type?: string; text?: string }[]
  return {
    text: blocks.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n'),
    isToolResult: blocks.some(b => b?.type === 'tool_result'),
  }
}

/**
 * Reads one transcript line by line. Lines are checked as text before any is
 * parsed: tool results and tool calls, most of a transcript's bytes, are never
 * parsed at all. isTypedOnly false also takes what a scheduled task or the app
 * sent in the person's turn: where something was said, not only what was typed.
 */
export function pastPromptReader(since: number, until = Infinity, isTypedOnly = true) {
  let before = ''
  let reply = ''
  const out: PastPrompt[] = []
  return {
    line(raw: string) {
      const isUser = raw.includes('"type":"user"')
      const isAgent = !isUser && raw.includes('"type":"assistant"') && raw.includes('"type":"text"')
      if (!isUser && !isAgent) return
      if (isUser && raw.includes('"tool_result"')) return
      let r: Line
      try {
        r = JSON.parse(raw) as Line
      } catch {
        return
      }
      if (r.isSidechain || r.isMeta) return
      const { text, isToolResult } = textOf(r.message?.content)
      if (isToolResult || !text.trim()) return
      if (r.type === 'assistant') {
        reply = text.slice(-600)
        return
      }
      if (r.type !== 'user' || (isTypedOnly && NOT_TYPED.test(text))) return
      const at = Date.parse(r.timestamp ?? '')
      if (at >= since && at < until && (!isTypedOnly || text.length <= MAX_TEXT) && r.uuid)
        out.push({ uuid: r.uuid, at, session: r.sessionId ?? '', cwd: r.cwd ?? '', text: isTypedOnly ? text.trim() : text.trim().slice(0, 400), before: before || undefined, reply: reply || undefined })
      before = text.trim().slice(0, 400)
      reply = ''
    },
    prompts: () => out,
  }
}

/** Splits streamed text into whole lines; the last, unfinished line waits for the next piece. */
export function lineSplitter() {
  let rest = ''
  return {
    push(chunk: string): string[] {
      const parts = (rest + chunk).split('\n')
      rest = parts.pop() ?? ''
      return parts
    },
    end(): string[] {
      const last = rest
      rest = ''
      return last ? [last] : []
    },
  }
}
