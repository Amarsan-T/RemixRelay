import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { changesBetween, queueChange, remoteChanges, toStoredChange, withChanges } from './projectSync'
import type { ProjectChange } from './projectSync'
import type { StudioProject } from './types'
import { MAX_CHANGES_PER_SAVE } from '../../convex/projectChanges'

export type SaveState = 'saved' | 'saving' | 'error'

/** Edits within this window go out as one save, so dragging a knob isn't dozens of writes. */
const SAVE_DELAY_MS = 250
const RETRY_MS = 2000

/** Identifies this tab's saves. randomUUID needs https or localhost, so fall back elsewhere (e.g. a LAN IP). */
const CLIENT_ID = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

/** Applies edits from other browsers to the studio's state. */
export type ApplyRemote = (changes: readonly ProjectChange[]) => void

/**
 * Keeps one open project in sync with Convex. The studio reports every edit
 * through onLocalChange; the changes are saved after a short pause. The studio
 * also connects an ApplyRemote, through which every edit saved by another
 * browser is handed over, in order.
 */
export function useProjectSync(id: string) {
  const doc = useQuery(api.projects.get, { id })
  const save = useMutation(api.projects.save)
  const [initialProject, setInitialProject] = useState<StudioProject | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  /** The project as the studio last reported it, plus every edit handed to it since. */
  const local = useRef<StudioProject | null>(null)
  /**
   * Hands edits straight to the studio. They must not wait in React state: a
   * second update would replace the first before the studio saw it, and the
   * studio would then save its stale copy over someone else's work.
   */
  const applyRemote = useRef<ApplyRemote | null>(null)
  /** Edits that arrived before the studio connected. */
  const heldForStudio = useRef<ProjectChange[]>([])
  /** Changed here, not yet sent, in the order made. */
  const unsent = useRef(new Map<string, ProjectChange>())
  /** Sent, waiting for the server to confirm. One save is in flight at a time. */
  const sending = useRef<ProjectChange[] | null>(null)
  /**
   * Newest server version seen or saved. Copies older than this are skipped: an
   * effect for a copy from before this tab's last save can still run after the
   * save is confirmed, and applying it would roll that save back on screen.
   */
  const newestVersion = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sendRef = useRef(() => {})
  const projectId = doc?._id

  const send = useCallback(() => {
    clearTimeout(timer.current)
    if (!projectId || sending.current || !unsent.current.size) return
    const queued = [...unsent.current.values()]
    const changes = queued.slice(0, MAX_CHANGES_PER_SAVE)
    sending.current = changes
    unsent.current = new Map()
    for (const change of queued.slice(MAX_CHANGES_PER_SAVE)) queueChange(unsent.current, change)
    save({ id: projectId, clientId: CLIENT_ID, changes: changes.map(toStoredChange) })
      .then((version) => {
        newestVersion.current = Math.max(newestVersion.current, version)
        sending.current = null
        if (unsent.current.size) sendRef.current()
        else setSaveState('saved')
      })
      .catch((error: unknown) => {
        console.warn('Saving the project failed; retrying.', error)
        // Put the failed changes back ahead of newer ones, which still win.
        const retry = new Map<string, ProjectChange>()
        for (const change of [...changes, ...unsent.current.values()]) queueChange(retry, change)
        unsent.current = retry
        sending.current = null
        setSaveState('error')
        timer.current = setTimeout(() => sendRef.current(), RETRY_MS)
      })
  }, [projectId, save])
  useEffect(() => { sendRef.current = send }, [send])

  const onLocalChange = useCallback((next: StudioProject) => {
    const previous = local.current
    local.current = next
    if (!previous) return
    const changes = changesBetween(previous, next)
    if (!changes.length) return // an incoming edit, already in sync
    for (const change of changes) queueChange(unsent.current, change)
    setSaveState((state) => (state === 'error' ? state : 'saving'))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => sendRef.current(), SAVE_DELAY_MS)
  }, [])

  // The first copy opens the studio; later copies bring in what other browsers
  // saved, except changes this tab is still saving.
  useEffect(() => {
    if (!doc || doc.version < newestVersion.current) return
    newestVersion.current = doc.version
    const server = doc.data as StudioProject
    if (!local.current) {
      local.current = server
      setInitialProject(server)
      return
    }
    const changes = remoteChanges(local.current, server, [...(sending.current ?? []), ...unsent.current.values()])
    if (!changes) return
    local.current = withChanges(local.current, changes)
    if (applyRemote.current) applyRemote.current(changes)
    else heldForStudio.current.push(...changes)
  }, [doc])

  /** The studio calls this once mounted; the returned function disconnects it. */
  const connectStudio = useCallback((apply: ApplyRemote) => {
    applyRemote.current = apply
    if (heldForStudio.current.length) apply(heldForStudio.current.splice(0))
    return () => {
      if (applyRemote.current === apply) applyRemote.current = null
    }
  }, [])

  // Leaving the project or closing the tab sends what's left right away.
  useEffect(() => {
    const sendNow = () => sendRef.current()
    window.addEventListener('pagehide', sendNow)
    return () => {
      window.removeEventListener('pagehide', sendNow)
      sendNow()
    }
  }, [])

  return {
    status: doc === undefined ? 'loading' as const : doc === null ? 'missing' as const : 'ready' as const,
    name: doc?.name,
    initialProject,
    saveState,
    onLocalChange,
    connectStudio,
  }
}
