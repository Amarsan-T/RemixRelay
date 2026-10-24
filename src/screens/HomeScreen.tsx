import { useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { Song } from '../music/types'

type Props = {
  songs: Song[]
  onOpenSong: (songId: string) => void
  onNewSong: () => void
}

// The dashboard from the Figma Make design: greeting, search, and song cards.
export function HomeScreen({ songs, onOpenSong, onNewSong }: Props) {
  const [query, setQuery] = useState('')

  const shown = songs
    .filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt)

  // Read the clock once when the screen opens, not on every re-render.
  const [now] = useState(() => new Date())
  const today = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-canvas/90 px-4 py-4 backdrop-blur sm:px-8">
        <label className="flex h-10 w-full max-w-sm items-center gap-2 rounded-xl border border-line bg-white px-3 text-sm focus-within:border-line-strong">
          <Search size={16} className="text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search songs..."
            className="w-full bg-transparent outline-none placeholder:text-muted"
          />
        </label>
        <button
          type="button"
          onClick={onNewSong}
          className="ml-auto flex shrink-0 items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:bg-accent-hover active:scale-[.98]"
        >
          <Plus size={16} /> New project
        </button>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-8">
        <p className="text-sm text-muted">{today}</p>
        <h1 className="mt-1 text-3xl font-semibold">{greeting(now)}</h1>
        <p className="mt-2 text-muted">Pick up where you left off, or start something new.</p>

        <section className="mt-8 rounded-2xl border border-line bg-white">
          <div className="border-b border-line px-5 py-4">
            <h2 className="font-semibold">Recent projects</h2>
            <p className="text-sm text-muted">Your team's latest work</p>
          </div>

          {shown.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted">
              {songs.length === 0 ? 'No songs yet. Start one with New project.' : `No songs match "${query}".`}
            </p>
          ) : (
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {shown.map((song) => (
                <button
                  key={song.id}
                  type="button"
                  onClick={() => onOpenSong(song.id)}
                  className="flex min-h-[96px] w-full items-center gap-4 rounded-xl border border-line px-5 py-4 text-left transition hover:border-line-strong hover:bg-[#fafaf8]"
                >
                  <span
                    className="grid size-11 shrink-0 place-items-center rounded-xl text-sm font-semibold text-white"
                    style={{ background: song.color }}
                  >
                    {song.name.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{song.name}</span>
                    <span className="block text-sm text-muted">
                      Last edited {timeAgo(song.updatedAt)}
                    </span>
                    <span className="block text-xs text-muted">
                      {song.patterns.length} {song.patterns.length === 1 ? 'pattern' : 'patterns'} ·{' '}
                      {song.bpm} BPM
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  )
}

function greeting(date: Date) {
  const hour = date.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** 12 minutes ago, 3 hours ago, yesterday... */
function timeAgo(time: number) {
  const minutes = Math.round((time - Date.now()) / 60_000)
  if (minutes > -1) return 'just now'
  if (minutes > -60) return relative.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours > -24) return relative.format(hours, 'hour')
  return relative.format(Math.round(hours / 24), 'day')
}
