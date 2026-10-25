import { useState } from 'react'
import { Check, ChevronDown, ChevronUp, Minus, MoveVertical, Plus, Sparkles, Wand2, X } from 'lucide-react'
import { describeSuggestion } from '../../convex/noteSuggestions'
import type { NoteSuggestion, ResolvedSuggestion } from '../../convex/noteSuggestions'
import { isInView, type StudioView } from './noteCoach'

type Props = {
  items: ResolvedSuggestion[]
  summary?: string
  /** Suggestions Claude made that couldn't be shown. */
  skipped: number
  view: StudioView
  pattern: number
  pianoChannelId: string | undefined
  onGo: (item: ResolvedSuggestion) => void
  /** Makes the changes. Only ever called from a button the user pressed. */
  onApply: (items: NoteSuggestion[]) => void
  onClear: () => void
}

const ICONS = { add: Plus, remove: Minus, change: MoveVertical }

/**
 * The AI coach strip above the editor: what Claude suggested, where it is,
 * and buttons to go there, make a change, or clear the highlights. Nothing in
 * the project changes until the user presses Apply (and confirms Apply all).
 */
export function CoachBar({ items, summary, skipped, view, pattern, pianoChannelId, onGo, onApply, onClear }: Props) {
  const [open, setOpen] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const pending = items.filter((item) => item.status === 'pending')
  const done = items.filter((item) => item.status === 'done').length
  const here = pending.filter((item) => isInView(item, view, pattern, pianoChannelId)).length
  const elsewhere = pending.find((item) => !isInView(item, view, pattern, pianoChannelId))
  const finished = items.length > 0 && pending.length === 0

  return (
    <section aria-label="AI note suggestions" className="aero-glass-dark relative z-10 mx-auto mb-3 w-full max-w-6xl rounded-xl px-3 py-2 text-xs text-sky-50">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 shrink-0 text-[#ffd447]" />
        <span className="font-semibold tracking-wide text-white">AI Coach</span>
        {summary && <span className="min-w-0 truncate text-sky-100/80">{summary}</span>}
        <span className="rounded-full bg-white/10 px-2 py-0.5 font-mono text-[10px]" aria-live="polite">
          {finished ? 'All done!' : `${done} of ${items.length} done`}
        </span>
        {!finished && (
          <span className="text-sky-100/70">
            {here ? `${here} highlighted here` : 'None in this view'}
          </span>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {elsewhere && (
            <button type="button" onClick={() => onGo(elsewhere)} className="aero-pill aero-aqua px-2.5 py-1 text-[11px]">
              Show {elsewhere.channelName} · Pattern {elsewhere.pattern}
            </button>
          )}
          {pending.length > 0 && !confirming && (
            <button type="button" onClick={() => setConfirming(true)} className="aero-pill aero-smoke px-2.5 py-1 text-[11px]">
              <Wand2 className="h-3 w-3" /> Apply all ({pending.length})
            </button>
          )}
          {confirming && (
            <span role="group" aria-label="Confirm applying all suggestions" className="flex items-center gap-1.5 rounded-full bg-[#ffd447]/15 px-2 py-0.5">
              <span>Change {pending.length} {pending.length === 1 ? 'note' : 'notes'} in your song?</span>
              <button type="button" onClick={() => { onApply(pending); setConfirming(false) }} className="aero-pill aero-amber px-2 py-0.5 text-[11px]">
                Yes, apply
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="aero-pill aero-smoke px-2 py-0.5 text-[11px]">Cancel</button>
            </span>
          )}
          <button type="button" aria-expanded={open} aria-label={open ? 'Hide suggestion list' : 'Show suggestion list'} onClick={() => setOpen(!open)} className="aero-pill aero-smoke h-6 w-6">
            {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
          <button type="button" onClick={onClear} className="aero-pill aero-smoke px-2.5 py-1 text-[11px]">
            <X className="h-3 w-3" /> Clear highlights
          </button>
        </div>
      </div>

      {open && (
        <>
          <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {items.map((item, index) => {
              const Icon = item.status === 'done' ? Check : ICONS[item.action]
              return (
                <li key={index} className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1 ${item.status === 'pending' ? 'bg-white/5' : 'opacity-60'}`}>
                  <Icon className={`h-3.5 w-3.5 shrink-0 ${item.status === 'done' ? 'text-emerald-300' : item.action === 'remove' ? 'text-[#ff8a98]' : 'text-[#ffd447]'}`} />
                  <span className={item.status === 'done' ? 'line-through' : ''}>
                    <span className="font-semibold text-white">{describeSuggestion(item)}</span>
                    <span className="text-sky-100/60"> · {item.channelName} · Pattern {item.pattern}</span>
                  </span>
                  {item.why && <span className="text-sky-100/70">— {item.why}</span>}
                  <span className="ml-auto flex gap-1">
                    {item.status === 'pending' && (
                      <>
                        {/* Only moves the view to this note or step; never edits the song. */}
                        <button
                          type="button"
                          onClick={() => onGo(item)}
                          aria-label={`Show: ${describeSuggestion(item)} on ${item.channelName}`}
                          className="aero-pill aero-aqua px-2 py-0.5 text-[10px]"
                        >
                          Show
                        </button>
                        <button
                          type="button"
                          onClick={() => onApply([item])}
                          aria-label={`Apply: ${describeSuggestion(item)} on ${item.channelName}`}
                          className="aero-pill aero-smoke px-2 py-0.5 text-[10px]"
                        >
                          Apply
                        </button>
                      </>
                    )}
                    {item.status === 'done' && <span className="text-emerald-300">Done</span>}
                    {item.status === 'unavailable' && <span className="text-sky-100/60">No longer fits this song</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-sky-100/60">
            <span><span className="mr-1 inline-block h-2.5 w-4 rounded-sm border-2 border-dashed border-[#ffd447] align-middle" />add</span>
            <span><span className="mr-1 inline-block h-2.5 w-4 rounded-sm border-2 border-dashed border-[#ff5a6e] align-middle" />remove</span>
            <span><span className="mr-1 inline-block h-2.5 w-4 rounded-sm border-2 border-[#ffd447] align-middle" />change pitch</span>
            <span>Click a highlight to place the note yourself, or press Apply.</span>
            {skipped > 0 && <span>{skipped} {skipped === 1 ? 'idea' : 'ideas'} from Claude didn't fit this song and {skipped === 1 ? 'was' : 'were'} left out.</span>}
          </p>
        </>
      )}
    </section>
  )
}
