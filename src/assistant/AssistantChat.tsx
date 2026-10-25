import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { Eye, EyeOff, RotateCcw, Send, Sparkles, X } from 'lucide-react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { MAX_MESSAGE_CHARS } from '../../convex/chatLimits'
import { describeSuggestion } from '../../convex/noteSuggestions'
import type { SuggestionSet } from '../../convex/noteSuggestions'
import { UNCOVER_EVENT } from '../ui/Reveal'

const STARTERS = [
  'I want a dreamy, relaxing melody.',
  'Make this beat sound more energetic.',
  'What notes should I add to create a darker atmosphere?',
  'Should I start in the Piano Roll or the Channel Rack?',
]

const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`

const errorText = (error: unknown) =>
  error instanceof ConvexError ? String(error.data) : "Couldn't send your message. Check your connection and try again."

/**
 * Claude chat for the open project. The conversation is stored in Convex
 * (convex/chat.ts), so it survives refreshes and is shared by everyone with
 * the project's link; Claude sees the project and the recent conversation.
 */
export function AssistantChat({ projectId, projectReady = true, highlightedId = null, onShowSuggestions, onHideSuggestions }: {
  projectId: string
  projectReady?: boolean
  /** The reply whose note suggestions the editor is highlighting. */
  highlightedId?: string | null
  onShowSuggestions?: (messageId: string, suggestions: SuggestionSet) => void
  onHideSuggestions?: () => void
}) {
  const [open, setOpen] = useState(false)
  const messages = useQuery(api.chat.list, open ? { projectId } : 'skip')
  const send = useMutation(api.chat.send)
  const retry = useMutation(api.chat.retry)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A message keeps its request id until it's sent, so resending after an error can't save it twice.
  const request = useRef<{ text: string; id: string } | null>(null)
  const busy = useRef(false)
  const scroller = useRef<HTMLDivElement>(null)

  const answering = messages?.some((message) => message.status === 'pending') ?? false
  const lastKey = messages?.length ? `${messages.length}:${messages[messages.length - 1].status}` : ''
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [lastKey, open])

  // Step aside when a note shown by the AI coach would be hidden under this panel.
  // The draft and conversation are kept; the AI Chat button reopens it.
  useEffect(() => {
    const minimize = () => setOpen(false)
    window.addEventListener(UNCOVER_EVENT, minimize)
    return () => window.removeEventListener(UNCOVER_EVENT, minimize)
  }, [])

  // When Claude answers a question asked in this browser with note
  // suggestions, highlight them right away. Highlighting never edits the song.
  const awaiting = useRef<string | null>(null)
  useEffect(() => {
    if (!awaiting.current || !messages) return
    const asked = messages.findIndex((message) => message._id === awaiting.current)
    const answer = asked >= 0 ? messages[asked + 1] : undefined
    if (!answer || answer.role !== 'assistant' || answer.status === 'pending') return
    awaiting.current = null
    if (answer.status === 'complete' && answer.suggestions?.items.length) onShowSuggestions?.(answer._id, answer.suggestions)
  }, [messages, onShowSuggestions])

  async function ask(text: string) {
    const content = text.trim()
    if (!content || content.length > MAX_MESSAGE_CHARS || busy.current || answering || !projectReady || messages === undefined) return
    if (request.current?.text !== content) request.current = { text: content, id: newRequestId() }
    busy.current = true
    setSending(true)
    setError(null)
    try {
      const { messageId } = await send({ projectId, requestId: request.current.id, content })
      awaiting.current = messageId
      request.current = null
      setDraft((current) => current.trim() === content ? '' : current)
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      busy.current = false
      setSending(false)
    }
  }

  async function retryReply(replyId: Id<'chatMessages'>) {
    if (busy.current || answering || !projectReady) return
    busy.current = true
    setSending(true)
    setError(null)
    try {
      await retry({ replyId })
    } catch (failure) {
      setError(errorText(failure))
    } finally {
      busy.current = false
      setSending(false)
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open AI chat"
        onClick={() => setOpen(true)}
        className="aero-pill aero-aqua fixed bottom-12 right-4 z-40 px-4 py-2 text-sm"
      >
        <Sparkles className="h-4 w-4" /> AI Chat
      </button>
    )
  }

  const tooLong = draft.trim().length > MAX_MESSAGE_CHARS
  return (
    <section
      aria-label="AI chat"
      data-floating-panel
      className="aero-panel fixed bottom-12 right-4 z-40 flex h-[min(36rem,calc(100vh-7rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden text-sm text-zinc-100"
    >
      <header className="aero-panel-header flex items-center gap-2 px-4 py-2.5">
        <Sparkles className="h-4 w-4 text-aero-glow" />
        <h2 className="font-semibold tracking-wide">AI Chat</h2>
        <span className="text-xs text-aero-sky-light/60">Claude</span>
        <button type="button" aria-label="Close AI chat" onClick={() => setOpen(false)} className="aero-pill aero-smoke ml-auto h-7 w-7">
          <X className="h-3.5 w-3.5" />
        </button>
      </header>

      <div ref={scroller} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {messages === undefined && <p className="text-zinc-400">Loading the conversation...</p>}
        {messages?.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-zinc-300">Ask Claude about this song. It can see the tempo, instruments, patterns and arrangement.</p>
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => void ask(starter)}
                disabled={sending || !projectReady}
                className="aero-pill aero-smoke justify-start rounded-xl px-3 py-2 text-left text-xs"
              >
                {starter}
              </button>
            ))}
          </div>
        )}
        {messages?.map((message) => message.role === 'user' ? (
          <p key={message._id} className="ml-8 self-end whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-aero-aqua-dark/80 px-3 py-2 text-white shadow">
            {message.content}
          </p>
        ) : message.status === 'pending' ? (
          <p key={message._id} role="status" className="mr-8 self-start rounded-2xl rounded-bl-sm bg-white/10 px-3 py-2 text-aero-sky-light/80">
            Claude is thinking<span className="animate-pulse">...</span>
          </p>
        ) : message.status === 'error' ? (
          <div key={message._id} className="mr-8 flex flex-col items-start gap-1.5 self-start rounded-2xl rounded-bl-sm border border-red-400/40 bg-red-500/10 px-3 py-2">
            <p className="text-red-200">{message.content}</p>
            {messages.at(-1)?._id === message._id && <button
              type="button"
              onClick={() => void retryReply(message._id)}
              disabled={answering || sending || !projectReady}
              className="aero-pill aero-smoke px-2.5 py-1 text-xs"
            >
              <RotateCcw className="h-3 w-3" /> Retry
            </button>}
          </div>
        ) : message.suggestions ? (
          <div key={message._id} className="mr-8 flex flex-col gap-2 self-start rounded-2xl rounded-bl-sm bg-white/10 px-3 py-2 text-zinc-100">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
            <SuggestionCard
              suggestions={message.suggestions}
              highlighted={highlightedId === message._id}
              onShow={() => onShowSuggestions?.(message._id, message.suggestions!)}
              onHide={() => onHideSuggestions?.()}
            />
          </div>
        ) : (
          <p key={message._id} className="mr-8 self-start whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-white/10 px-3 py-2 text-zinc-100">
            {message.content}
          </p>
        ))}
      </div>

      <form
        className="flex flex-col gap-1.5 border-t border-white/10 px-3 py-2.5"
        onSubmit={(event) => {
          event.preventDefault()
          void ask(draft)
        }}
      >
        {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
        {!projectReady && <p role="status" className="text-xs text-aero-sky-light/80">Waiting for your music edits to save...</p>}
        <div className="flex items-end gap-2">
          <textarea
            aria-label="Message Claude"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void ask(draft)
              }
            }}
            rows={2}
            placeholder={answering ? 'Claude is answering...' : 'Ask about your song...'}
            className="aero-lcd min-h-10 flex-1 resize-none rounded-xl px-3 py-2 text-sm text-aero-sky-light outline-none"
          />
          <button
            type="submit"
            aria-label="Send message"
            disabled={!draft.trim() || tooLong || sending || answering || !projectReady || messages === undefined}
            className="aero-pill aero-aqua h-10 w-10"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
        <p className={`text-[10px] ${tooLong ? 'text-red-300' : 'text-zinc-500'}`}>
          {tooLong ? `Too long: ${draft.trim().length}/${MAX_MESSAGE_CHARS} characters. ` : ''}
          Everyone with this project's link can see this chat. Claude can make mistakes.
        </p>
      </form>
    </section>
  )
}

/** Under a reply with note suggestions: what Claude suggested, and a button to highlight it in the editor. */
function SuggestionCard({ suggestions, highlighted, onShow, onHide }: {
  suggestions: SuggestionSet
  highlighted: boolean
  onShow: () => void
  onHide: () => void
}) {
  const { items, skipped } = suggestions
  if (!items.length) {
    return <p className="text-xs text-aero-sky-light/70">Claude's note ideas didn't fit this song, so nothing is highlighted. Try asking again.</p>
  }
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-[#ffd447]/40 bg-[#ffd447]/10 px-2.5 py-2 text-xs">
      <p className="font-semibold text-[#ffe58a]">
        <Sparkles className="mr-1 inline h-3 w-3" />
        {items.length} {items.length === 1 ? 'note' : 'notes'} to try{suggestions.summary ? `: ${suggestions.summary}` : ''}
      </p>
      <ul className="flex flex-col gap-0.5 text-zinc-200">
        {items.slice(0, 4).map((item, index) => (
          <li key={index}>{describeSuggestion(item)} <span className="text-zinc-400">· {item.channelName}, pattern {item.pattern}</span></li>
        ))}
        {items.length > 4 && <li className="text-zinc-400">and {items.length - 4} more</li>}
      </ul>
      {skipped > 0 && <p className="text-zinc-400">{skipped} more {skipped === 1 ? "idea didn't" : "ideas didn't"} fit this song and {skipped === 1 ? 'was' : 'were'} left out.</p>}
      <div className="flex gap-1.5">
        {highlighted ? (
          <button type="button" onClick={onHide} className="aero-pill aero-smoke px-2.5 py-1 text-[11px]">
            <EyeOff className="h-3 w-3" /> Hide highlights
          </button>
        ) : (
          <button type="button" onClick={onShow} className="aero-pill aero-aqua px-2.5 py-1 text-[11px]">
            <Eye className="h-3 w-3" /> Show in editor
          </button>
        )}
      </div>
      <p className="text-[10px] text-zinc-400">Highlights only show you where to look. Your song changes only when you edit or press Apply.</p>
    </div>
  )
}
