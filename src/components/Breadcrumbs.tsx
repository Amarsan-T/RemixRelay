import { ChevronRight } from 'lucide-react'

export type Crumb = { label: string; onClick?: () => void }

/** "Home › Pop Sketch › Chords". Every crumb but the last is a link back up. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="flex min-w-0 items-center gap-1.5 text-sm text-muted">
      {items.map((crumb, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1.5">
          {i > 0 && <ChevronRight size={14} className="shrink-0" />}
          {crumb.onClick ? (
            <button type="button" onClick={crumb.onClick} className="truncate hover:text-ink">
              {crumb.label}
            </button>
          ) : (
            <span className="truncate font-medium text-ink">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
