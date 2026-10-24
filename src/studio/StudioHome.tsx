import { useState } from 'react'
import { Music, Plus, Search, Sparkles } from 'lucide-react'
import type { ProjectEntry } from './projects'

type Props = {
  projects: ProjectEntry[]
  onOpenProject: (id: string) => void
  onNewProject: () => void
}

/** Start screen: pick a project to open in the studio, or start a new one. */
export function StudioHome({ projects, onOpenProject, onNewProject }: Props) {
  const [query, setQuery] = useState('')
  const shown = projects
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="min-h-screen bg-[#16181b] text-zinc-200">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-zinc-800 bg-[#1e2125]/95 px-4 py-3 backdrop-blur sm:px-8">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-amber-600 via-orange-500 to-yellow-400 shadow-lg shadow-orange-500/20">
            <Sparkles className="h-4 w-4 text-zinc-950" />
          </div>
          <span className="font-mono text-sm font-black tracking-wider text-orange-400">REMIXRELAY</span>
        </div>
        <label className="ml-auto hidden h-9 w-64 items-center gap-2 rounded-md border border-zinc-700/80 bg-zinc-900 px-3 text-sm sm:flex">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects..."
            aria-label="Search projects"
            className="w-full bg-transparent outline-none placeholder:text-zinc-500"
          />
        </label>
        <button
          type="button"
          onClick={onNewProject}
          className="ml-auto flex items-center gap-1.5 rounded-md bg-orange-500 px-3 py-2 text-xs font-bold text-zinc-950 shadow hover:bg-orange-400 sm:ml-0"
        >
          <Plus className="h-4 w-4" /> New project
        </button>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <h1 className="text-2xl font-bold text-zinc-100">Your projects</h1>
        <p className="mt-1 text-sm text-zinc-400">Open a project to keep working, or start a new one.</p>

        {shown.length === 0 ? (
          <p className="mt-10 text-center text-sm text-zinc-500">No projects match "{query}".</p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => onOpenProject(entry.id)}
                className="group flex flex-col overflow-hidden rounded-lg border border-zinc-700/70 bg-[#202428] text-left shadow-lg transition hover:-translate-y-0.5 hover:border-orange-500/60"
              >
                <MiniRack entry={entry} />
                <div className="flex items-center gap-3 px-4 py-3">
                  <span
                    className="grid h-9 w-9 shrink-0 place-items-center rounded-md font-mono text-sm font-black text-zinc-950"
                    style={{ background: entry.color }}
                  >
                    {entry.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-zinc-100 group-hover:text-orange-300">{entry.name}</span>
                    <span className="block font-mono text-[11px] text-zinc-400">
                      {entry.project.bpm} BPM · edited {timeAgo(entry.updatedAt)}
                    </span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

/** Tiny channel rack of the project's first pattern: one row per channel. */
function MiniRack({ entry }: { entry: ProjectEntry }) {
  const { channels, stepData, pianoNotes } = entry.project
  const hasAny = channels.some((c) => stepData[1]?.[c.id]?.includes(1) || (pianoNotes[1]?.[c.id]?.length ?? 0) > 0)
  return (
    <div className="flex h-24 flex-col justify-center gap-[3px] border-b border-zinc-800 bg-[#181a1d] px-4">
      {hasAny ? (
        channels.map((channel) => {
          const gates = stepData[1]?.[channel.id] ?? []
          return (
            <div key={channel.id} className="grid grid-cols-16 gap-[3px]">
              {Array.from({ length: 16 }, (_, step) => {
                const on = gates[step] === 1 || pianoNotes[1]?.[channel.id]?.some((n) => n.step === step)
                return (
                  <span
                    key={step}
                    className="h-[7px] rounded-[2px]"
                    style={{ background: on ? channel.color : 'rgba(255,255,255,.05)' }}
                  />
                )
              })}
            </div>
          )
        })
      ) : (
        <span className="flex items-center justify-center gap-2 text-xs text-zinc-500">
          <Music className="h-4 w-4" /> Empty project
        </span>
      )}
    </div>
  )
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** "just now", "12 minutes ago", "yesterday"... */
function timeAgo(time: number) {
  const minutes = Math.round((time - Date.now()) / 60_000)
  if (minutes > -1) return 'just now'
  if (minutes > -60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}
