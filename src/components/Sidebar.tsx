import { Home } from 'lucide-react'
import type { Song } from '../music/types'

type Props = {
  songs: Song[]
  /** Song currently open, highlighted in the list. null on the home screen. */
  activeSongId: string | null
  onHome: () => void
  onOpenSong: (songId: string) => void
}

// Left navigation from the Figma design: logo, Home, and a quick list of songs.
export function Sidebar({ songs, activeSongId, onHome, onOpenSong }: Props) {
  const item = 'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition'
  const idle = 'text-ink/80 hover:bg-black/[.04]'
  const active = 'bg-black/[.06] font-medium text-ink'

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[248px] flex-col border-r border-line bg-panel p-5 md:flex">
      <button type="button" onClick={onHome} className="mb-8 flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-xl bg-ink text-sm font-semibold text-white">
          R
        </span>
        <span className="text-[17px] font-semibold">RemixRelay</span>
      </button>

      <nav className="flex flex-col gap-1">
        <button
          type="button"
          onClick={onHome}
          className={`${item} ${activeSongId === null ? active : idle}`}
        >
          <Home size={18} strokeWidth={1.75} /> Home
        </button>
      </nav>

      <p className="mt-8 mb-2 px-3 text-xs font-medium tracking-wide text-muted uppercase">Songs</p>
      <nav className="-mx-1 flex flex-col gap-0.5 overflow-y-auto px-1">
        {songs.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpenSong(s.id)}
            className={`${item} ${s.id === activeSongId ? active : idle}`}
          >
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
            <span className="truncate">{s.name}</span>
          </button>
        ))}
      </nav>
    </aside>
  )
}
