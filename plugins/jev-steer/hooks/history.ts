/**
 * Past conversations, read back from Claude Code's session transcripts
 * (`<config>/projects/<slug>/<session>.jsonl`): every request the person typed,
 * with the conversation around it (the requests before and after, what the
 * agent said and did in between), so a correction made before ani was
 * installed can still become a case.
 */

/** One request the person typed, with what it answered and what came next. */
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
  /** Up to EARLIER_MAX of the person's requests before this one, oldest first. */
  earlier?: string[]
  /** What the agent said between the request before and this one. */
  reply?: string
  /** What the agent did in between: tool names with the file or command they touched. */
  tools?: string[]
  /** The person's next requests in the same session (up to AFTER_MAX). */
  after?: string[]
  /** What the agent said between this request and the next. */
  next?: string
  /** Typed by the person in their own session: false for an engine block, a scheduled or scripted session. */
  isTyped: boolean
}

/** Turns the engine, other sessions and the app's helpers (a role prompt: "You are a commit message generator") write as the user's. */
const NOT_TYPED = /^\s*(<|\/|Base directory for this skill|Another Claude session|Caveat:|This session is being continued|\[Request interrupted|Implement the following plan|Stop hook feedback|# |USER: |You are an? )/
/** Blocks the engine or the app puts in the person's turn, around what was typed. */
const ENGINE_BLOCK = /<(system-reminder|ci-monitor-event|task-notification|command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|user-prompt-submit-hook|bash-input|bash-stdout|bash-stderr)\b[^>]*>[\s\S]*?<\/\1>/g
/** An attached snippet: a header comment, then quoted lines. */
const ATTACHMENT = /<!--\s*attach:[^>]*-->[^\n]*\n?(?:>[^\n]*(?:\n|$))*/g
/** Sessions another program started (`claude -p`, the SDKs): their prompts were written by an agent or a script. */
const isScripted = (entrypoint?: string) => Boolean(entrypoint?.startsWith('sdk-'))
/** Workspaces of tools that run their own Claude sessions over the person's. */
const AGENT_CWD = /[\\/]\.claude-mem([\\/]|$)/
const MAX_TEXT = 1500
const EARLIER_MAX = 3
const AFTER_MAX = 2
const TOOLS_MAX = 8

/** What the person typed in a turn: attached snippets and engine blocks taken out. */
export function typedText(text: string): string {
  return text.replace(ENGINE_BLOCK, '').replace(ATTACHMENT, '').trim()
}

/** The person's own words in a turn, or '' when the turn is the engine's, a skill's or another session's. */
export function personText(text: string): string {
  const typed = typedText(text)
  return typed && !NOT_TYPED.test(typed) ? typed : ''
}

/** Whether a session was started by another program (`claude -p`, the SDKs), from its entrypoint. */
export const isScriptedEntry = isScripted

/**
 * Where a submitted prompt came from (the engine's `origin.kind`) when it is
 * never the person's words. `sdk` is not among them: an app hosting the
 * session through the SDK (the desktop app) sends what the person typed that
 * way; a session another program started is known by its entrypoint instead.
 */
const NOT_PERSON_ORIGINS = new Set(['task-notification', 'scheduled-trigger', 'peer', 'peer-send-message', 'projects-relay', 'coordinator', 'observer', 'observer-activity', 'auto-continuation'])
export const isPersonOrigin = (origin?: { kind: string; asUser?: boolean }) =>
  !origin || (origin.kind === 'plugin' ? origin.asUser === true : !NOT_PERSON_ORIGINS.has(origin.kind))

type Line = {
  type?: string
  uuid?: string
  timestamp?: string
  sessionId?: string
  cwd?: string
  entrypoint?: string
  /** Who sent the turn, where the transcript records it: `human` is the person at the prompt. */
  origin?: { kind?: string }
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
 * The tool calls on an agent line, read from the raw text: a tool call's input
 * (a whole file for a write) is never parsed.
 */
function toolsOf(raw: string): string[] {
  const out: string[] = []
  for (const m of raw.matchAll(/"type":"tool_use","id":"[^"]*","name":"([^"]+)","input":\{/g)) {
    const rest = raw.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 600)
    const file = rest.match(/"(?:file_path|path|notebook_path)":"((?:[^"\\]|\\.){1,200})"/)?.[1]
    const cmd = rest.match(/"command":"((?:[^"\\]|\\.){1,200})/)?.[1]
    const what = file ? file.replace(/\\\\/g, '\\').split(/[\\/]/).slice(-2).join('/') : cmd ? cmd.replace(/\\n[\s\S]*$/, '').replace(/\\"/g, '"').slice(0, 60) : ''
    out.push(what ? `${m[1]} ${what}` : (m[1] as string))
  }
  return out
}

/**
 * Reads one transcript line by line. Lines are checked as text before any is
 * parsed: tool results and tool calls, most of a transcript's bytes, are never
 * parsed at all. isTypedOnly false also takes what a scheduled task, a script
 * or the app sent in the person's turn, marked `isTyped: false`: where
 * something was said, not only what was typed.
 */
export function pastPromptReader(since: number, until = Infinity, isTypedOnly = true) {
  const earlier: string[] = []
  let reply = ''
  let tools: string[] = []
  const out: PastPrompt[] = []
  /** Typed requests still collecting the requests after them. */
  let open: PastPrompt[] = []
  /** The last typed request, when it was taken: the agent's next reply is its `next`. */
  let pending: PastPrompt | null = null
  const closeReply = () => {
    if (pending && pending.next === undefined && reply) pending.next = reply.slice(-400)
  }
  /** The session's folder, for a queued prompt, whose line has none. */
  let folder = ''
  return {
    line(raw: string) {
      if (!folder && raw.includes('"cwd":"')) folder = raw.match(/"cwd":"((?:[^"\\]|\\.)*)"/)?.[1]?.replace(/\\\\/g, '\\') ?? ''
      // A queued prompt is delivered when it leaves the queue: an app's message (a CI event) may be found only there.
      if (!isTypedOnly && raw.includes('"type":"queue-operation"') && raw.includes('"operation":"remove"')) {
        let q: Line & { content?: unknown }
        try {
          q = JSON.parse(raw) as Line & { content?: unknown }
        } catch {
          return
        }
        const at = Date.parse(q.timestamp ?? '')
        if (typeof q.content === 'string' && at >= since && at < until)
          out.push({ uuid: `q-${q.sessionId ?? ''}-${at}`, at, session: q.sessionId ?? '', cwd: '', text: q.content.trim().slice(0, 400), isTyped: Boolean(personText(q.content)) })
        return
      }
      const isUser = raw.includes('"type":"user"')
      const isAgent = !isUser && raw.includes('"type":"assistant"')
      if (!isUser && !isAgent) return
      if (isAgent) {
        if (raw.includes('"isSidechain":true')) return
        if (raw.includes('"type":"tool_use"')) tools = [...tools, ...toolsOf(raw)].slice(-TOOLS_MAX)
        if (!raw.includes('"type":"text"')) return
      }
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
        reply = `${reply}\n${text}`.trim().slice(-600)
        return
      }
      if (r.type !== 'user') return
      const typed = personText(text)
      const isTyped = Boolean(typed) && (!r.origin?.kind || r.origin.kind === 'human') && !isScripted(r.entrypoint) && !AGENT_CWD.test(r.cwd ?? '')
      if (!isTyped && isTypedOnly) return
      closeReply()
      const at = Date.parse(r.timestamp ?? '')
      const said = isTyped ? typed : text.trim()
      if (isTyped) {
        for (const p of open) if ((p.after?.length ?? 0) < AFTER_MAX) p.after = [...(p.after ?? []), said.slice(0, 300)]
        open = open.filter(p => (p.after?.length ?? 0) < AFTER_MAX)
      }
      if (at >= since && at < until && (!isTypedOnly || said.length <= MAX_TEXT) && r.uuid) {
        const p: PastPrompt = {
          uuid: r.uuid,
          at,
          session: r.sessionId ?? '',
          cwd: r.cwd ?? '',
          text: isTypedOnly ? said : said.slice(0, 400),
          before: earlier[earlier.length - 1],
          earlier: earlier.length ? [...earlier] : undefined,
          reply: reply || undefined,
          tools: tools.length ? tools : undefined,
          isTyped,
        }
        out.push(p)
        if (isTyped) open.push(p)
        if (isTyped) pending = p
      } else if (isTyped) pending = null
      if (isTyped) {
        earlier.push(said.slice(0, 400))
        if (earlier.length > EARLIER_MAX) earlier.shift()
      }
      reply = ''
      tools = []
    },
    prompts: () => {
      closeReply()
      for (const p of out) if (!p.cwd) p.cwd = folder
      return out
    },
  }
}

/** One past request as Jev and the small model read it: the conversation around it, in order. */
export function contextOf(p: Pick<PastPrompt, 'earlier' | 'reply' | 'tools' | 'after' | 'next'>): string {
  const lines: string[] = []
  for (const e of p.earlier ?? []) lines.push(`사용자: ${e.slice(0, 300)}`)
  if (p.tools?.length) lines.push(`에이전트가 한 작업: ${p.tools.join(', ')}`)
  if (p.reply) lines.push(`에이전트: ${p.reply.slice(-500)}`)
  lines.push('▶ 판단할 피드백 (아래 "피드백"에 전문)')
  if (p.next) lines.push(`에이전트: ${p.next.slice(-300)}`)
  for (const a of p.after ?? []) lines.push(`사용자 (다음): ${a.slice(0, 200)}`)
  return lines.join('\n')
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
