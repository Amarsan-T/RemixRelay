import { useEffect, useId, useRef, useState } from 'react'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { ConvexError } from 'convex/values'
import { GlassButton, GlassInput } from '../ui/Glass'
import { MAX_PROJECT_NAME, validProjectName } from '../../convex/projectRules'
import type { ProjectEntry } from './projects'

export function ProjectActions({ entry, onRename, onDelete }: {
  entry: ProjectEntry
  onRename: (entry: ProjectEntry, name: string) => Promise<void>
  onDelete: (entry: ProjectEntry) => Promise<void>
}) {
  const [menu, setMenu] = useState(false)
  const [action, setAction] = useState<{ kind: 'rename' | 'delete'; entry: ProjectEntry } | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const projectDescription = useId()
  useEffect(() => {
    if (!menu) return
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setMenu(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [menu])
  const close = () => { setAction(null); setMenu(false); trigger.current?.focus() }
  const allowed = entry.canManage !== false
  return (
    <div ref={root} className="absolute right-3 top-3 z-10" onKeyDown={event => {
      if (event.key === 'Escape' && menu) { setMenu(false); trigger.current?.focus() }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false) }}>
      <span id={projectDescription} className="sr-only">{entry.name}</span>
      <button ref={trigger} type="button" aria-label="Project actions" aria-describedby={projectDescription} aria-haspopup="menu" aria-expanded={menu}
        className="aero-pill aero-frost h-10 w-10" onClick={() => setMenu(!menu)}>
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {/* Real sibling controls: no buttons nested inside the card's open button. */}
      {menu && <div role="menu" aria-label={`Actions for ${entry.name}`} className="aero-menu absolute right-0 mt-2 w-56 rounded-xl p-1 shadow-xl"
        onKeyDown={event => {
          if (event.key === 'Escape') { setMenu(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus() }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
          }
        }}>
        <button role="menuitem" disabled={!allowed} className="aero-menu-item text-aero-ink enabled:hover:bg-sky-200/70 enabled:focus-visible:bg-sky-200/70"
          onClick={() => { setMenu(false); setAction({ kind: 'rename', entry }) }}><Pencil className="h-4 w-4 text-aero-aqua-dark" />Rename</button>
        <button role="menuitem" disabled={!allowed} className="aero-menu-item text-red-700 enabled:hover:bg-red-100/80 enabled:hover:text-red-800 enabled:focus-visible:bg-red-100/80 enabled:focus-visible:text-red-800"
          onClick={() => { setMenu(false); setAction({ kind: 'delete', entry }) }}><Trash2 className="h-4 w-4" />Delete</button>
        {!allowed && <p className="mt-1 border-t border-aero-ink/10 px-3 pb-1.5 pt-2 text-xs text-aero-ink-soft">Management access is unavailable in this browser.</p>}
      </div>}
      {action && <ProjectDialog kind={action.kind} entry={action.entry} onClose={close}
        onConfirm={name => action.kind === 'rename' ? onRename(action.entry, name) : onDelete(action.entry)} />}
    </div>
  )
}

function ProjectDialog({ kind, entry, onClose, onConfirm }: {
  kind: 'rename' | 'delete'; entry: ProjectEntry; onClose: () => void; onConfirm: (name: string) => Promise<void>
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const title = useId()
  const description = useId()
  const [name, setName] = useState(kind === 'rename' ? entry.name : '')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const element = dialog.current!
    element.showModal()
    const target = element.querySelector<HTMLElement>('[data-initial-focus]')
    target?.focus()
    if (target instanceof HTMLInputElement) target.select()
    return () => element.close()
  }, [])
  const valid = kind === 'rename' ? validProjectName(name) !== null : name === entry.name
  async function confirm() {
    if (!valid || submitting.current) return
    submitting.current = true
    setBusy(true)
    setError(null)
    try { await onConfirm(name.trim()); onClose() }
    catch (failure) {
      // Convex errors are controlled messages; never render raw transport/argument details.
      setError(failure instanceof ConvexError && typeof failure.data === 'string' ? failure.data : 'The action could not be completed. Check your connection and try again.')
    } finally { submitting.current = false; setBusy(false) }
  }
  return <dialog ref={dialog} aria-labelledby={title} aria-describedby={description}
    className="aero-glass m-auto w-[min(28rem,calc(100%-2rem))] rounded-2xl p-6 text-aero-ink shadow-2xl backdrop:bg-slate-950/40"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}>
    <form onSubmit={event => { event.preventDefault(); if (kind === 'rename') void confirm() }}>
      <h2 id={title} className="text-xl font-semibold">{kind === 'rename' ? 'Rename project' : `Delete “${entry.name}”?`}</h2>
      <p id={description} className="my-3 text-sm">{kind === 'rename'
        ? 'The new name will appear for everyone using this project.'
        : 'This removes the shared project for everyone. Saved music and chat are retained for recovery. Type the project name to confirm.'}</p>
      <GlassInput aria-label={kind === 'rename' ? 'Project name' : 'Confirm project name'} value={name} disabled={busy}
        maxLength={kind === 'rename' ? MAX_PROJECT_NAME : undefined} data-initial-focus={kind === 'rename' ? '' : undefined}
        onChange={event => setName(event.target.value)} />
      {kind === 'rename' && !valid && <p className="mt-2 text-sm text-red-900">Use 1–80 characters on one line.</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-900">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <GlassButton variant="frost" data-initial-focus={kind === 'delete' ? '' : undefined} disabled={busy} onClick={onClose} className="px-4 py-2">Cancel</GlassButton>
        <GlassButton type={kind === 'rename' ? 'submit' : 'button'} disabled={!valid || busy} aria-busy={busy}
          onClick={kind === 'delete' ? () => void confirm() : undefined} className={`px-4 py-2 ${kind === 'delete' ? 'text-red-950' : ''}`}>
          {busy ? 'Working…' : kind === 'rename' ? 'Save' : 'Delete project'}
        </GlassButton>
      </div>
    </form>
  </dialog>
}
