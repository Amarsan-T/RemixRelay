import { Disc3, Headphones, Mic2, Music2, Piano, Radio, Speaker, Waves } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

// Metro (Windows Phone / Windows 8) touches behind the studio panels: a cluster
// of flat live tiles and the current view's name in huge thin letters. It's all
// static, so it costs nothing while music plays.

/** Classic Metro accent colors. */
const CYAN = '#1ba1e2', LIME = '#8cbf26', MAGENTA = '#ff0097', ORANGE = '#f09609', PURPLE = '#a200ff', TEAL = '#00aba9'

/** Tiles on a 4-column grid: cols/rows are the tile's size in grid cells, like Metro's small, wide and large tiles. */
const TILES: { color: string; icon: LucideIcon; label?: string; cols: number; rows: number }[] = [
  { color: CYAN, icon: Music2, label: 'beats', cols: 2, rows: 2 },
  { color: MAGENTA, icon: Mic2, cols: 1, rows: 1 },
  { color: LIME, icon: Headphones, cols: 1, rows: 1 },
  { color: ORANGE, icon: Radio, label: 'mix', cols: 2, rows: 1 },
  { color: PURPLE, icon: Piano, label: 'keys', cols: 2, rows: 1 },
  { color: TEAL, icon: Disc3, cols: 1, rows: 1 },
  { color: CYAN, icon: Waves, cols: 1, rows: 1 },
  { color: LIME, icon: Speaker, label: 'relay', cols: 2, rows: 1 },
]

/**
 * Sits behind the workspace. Put it first inside an `isolate` container:
 * it draws at z-index -10, under the panels but over the sky.
 */
export function MetroBackdrop({ title }: { title: string }) {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {/* The view's name, huge and faint, running off the bottom-left edge */}
      <div className="metro-watermark absolute -bottom-4 -left-2 text-[11rem]">{title}</div>

      {/* A Start-screen style tile cluster in the bottom-right corner */}
      <div className="absolute right-6 bottom-6 grid grid-cols-4 gap-2 opacity-45" style={{ gridAutoRows: 72, width: 4 * 72 + 3 * 8 }}>
        {TILES.map(({ color, icon: Icon, label, cols, rows }, i) => (
          <div key={i} className="metro-tile" style={{ background: color, gridColumn: `span ${cols}`, gridRow: `span ${rows}` }}>
            <div className="flex w-full items-end justify-between">
              <Icon className={rows > 1 ? 'h-10 w-10' : 'h-6 w-6'} strokeWidth={1.5} />
              {label && <span className="text-sm font-light lowercase">{label}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
