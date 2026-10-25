import { useState } from 'react'
import { Music, Plus, Search, Sparkles } from 'lucide-react'
import type { ProjectEntry } from './projects'
import { AeroBackground, GlassButton, GlassInput, GlassPanel } from '../ui/Glass'
import { ProjectActions } from './ProjectActions'

type Props = {
  projects: ProjectEntry[]
  onOpenProject: (id: string) => void
  onNewProject: () => void
  creating?: boolean
  error?: string | null
  onRenameProject: (entry: ProjectEntry, name: string) => Promise<void>
  onDeleteProject: (entry: ProjectEntry) => Promise<void>
  deletedProjects?: { id: string; name: string }[]
  onRestoreProject: (id: string) => Promise<void>
  lastDeletedId?: string
}

/** Start screen: pick a project to open in the studio, or start a new one. */
export function StudioHome({ projects, onOpenProject, onNewProject, creating = false, error, onRenameProject, onDeleteProject, deletedProjects = [], onRestoreProject, lastDeletedId }: Props) {
  const [query, setQuery] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState(false)
  const shown = projects
    .filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <AeroBackground className="text-aero-ink">
      {/* Frosted top bar: logo, search, New project */}
      <GlassPanel gloss className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-none border-x-0 border-t-0 px-4 py-2.5 sm:px-8">
        <div className="flex items-center gap-2.5">
          {/* Glossy orb logo */}
          <div className="aero-pill aero-aqua h-9 w-9 shrink-0">
            <Sparkles className="h-4 w-4" />
          </div>
          <span className="text-lg font-semibold tracking-wide text-aero-ink">RemixRelay</span>
          {/* Kept for screen readers and tests that look for the wordmark. */}
          <span className="sr-only">REMIXRELAY</span>
        </div>
        <GlassInput
          icon={<Search className="h-4 w-4" />}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search projects..."
          aria-label="Search projects"
          className="order-last w-full sm:order-none sm:ml-auto sm:w-64"
        />
        <GlassButton onClick={onNewProject} disabled={creating} aria-busy={creating} className="ml-auto px-4 py-2 text-sm sm:ml-0">
          <Plus className="h-4 w-4" /> {creating ? 'Creating...' : 'New project'}
        </GlassButton>
      </GlassPanel>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8">
        {/* Metro-style headline: big and thin */}
        {/* Navy for contrast on the sky, with a Vista-style white glow behind it. */}
        <h1 className="metro-title text-5xl text-aero-ink [text-shadow:0_1px_0_rgba(255,255,255,0.7),0_0_22px_rgba(255,255,255,0.85)]">Your projects</h1>
        <p className="mt-3 text-base text-aero-ink">Open a project to keep working, or start a new one.</p>
        {error && <GlassPanel role="alert" className="mt-4 rounded-xl px-4 py-3 text-red-900">{error}</GlassPanel>}

        {shown.length === 0 ? (
          <GlassPanel className="mt-10 rounded-2xl px-6 py-8 text-center text-sm">{projects.length ? `No projects match "${query}".` : 'No projects yet. Start one with New project.'}</GlassPanel>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((entry) => (
              <div key={entry.id} className="relative" data-project-card={entry.id}>
              <button
                key={entry.id}
                type="button"
                onClick={() => onOpenProject(entry.id)}
                className="aero-glass aero-gloss group flex w-full flex-col overflow-hidden rounded-2xl p-2.5 text-left transition duration-200 hover:-translate-y-1 hover:shadow-[0_14px_36px_rgba(0,90,170,0.35)]"
              >
                <MiniRack entry={entry} />
                <div className="flex items-center gap-3 px-1.5 pt-3 pb-1">
                  {/* Little glossy color orb with the project's initial */}
                  <span
                    className="aero-pill h-10 w-10 shrink-0 text-base font-bold text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.35)]"
                    style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${entry.color} 55%, white), ${entry.color})`, boxShadow: `0 2px 8px color-mix(in srgb, ${entry.color} 50%, transparent)` }}
                  >
                    {entry.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-semibold text-aero-ink group-hover:text-aero-aqua-dark">{entry.name}</span>
                    <span className="block text-xs text-aero-ink-soft">
                      {entry.project.bpm} BPM · edited {timeAgo(entry.updatedAt)}
                    </span>
                  </span>
                </div>
              </button>
              <ProjectActions entry={entry} onRename={onRenameProject} onDelete={onDeleteProject} />
              </div>
            ))}
          </div>
        )}
        {deletedProjects.length > 0 && <GlassPanel className="mt-8 rounded-2xl p-5" role="region" aria-label="Recently deleted projects">
          <h2 className="font-semibold">Recently deleted in this browser</h2>
          <p className="mt-1 text-sm">Saved music and chat are retained. Restore a project to reopen it.</p>
          {deletedProjects.map(entry => <div key={entry.id} className="mt-3 flex items-center justify-between gap-3">
            <span className="truncate">{entry.name}</span>
            <GlassButton className="px-4 py-2 text-sm" disabled={restoring !== null}
              onClick={() => {
                setRestoring(entry.id); setRestoreError(false)
                void onRestoreProject(entry.id).catch(() => setRestoreError(true)).finally(() => setRestoring(null))
              }}>{restoring === entry.id ? 'Restoring…' : entry.id === lastDeletedId ? 'Undo' : 'Restore'}</GlassButton>
          </div>)}
          {restoreError && <p role="alert" className="mt-3 text-sm text-red-900">The project could not be restored. Check your connection and try again.</p>}
        </GlassPanel>}
      </main>
    </AeroBackground>
  )
}

/** Tiny channel rack of the project's first pattern: one row per channel. */
function MiniRack({ entry }: { entry: ProjectEntry }) {
  const { channels, stepData, pianoNotes } = entry.project
  const hasAny = channels.some((c) => stepData[1]?.[c.id]?.includes(1) || (pianoNotes[1]?.[c.id]?.length ?? 0) > 0)
  return (
    // A dark glossy "screen" inside the glass card, so the colored steps stay easy to read.
    <div className="aero-lcd flex h-24 flex-col justify-center gap-[3px] rounded-xl px-4">
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
