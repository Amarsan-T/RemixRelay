import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ConvexError } from 'convex/values'
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
  const [initialLifecycle, setInitialLifecycle] = useState<number | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [unavailable, setUnavailable] = useState(false)
  const stopped = useRef(false)
  const sessionLifecycle = useRef<number | null>(null)
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
  const stopSession = useCallback(() => {
    stopped.current = true
    clearTimeout(timer.current)
    setUnavailable(true)
  }, [])
  // A restored project starts a new session. Never replay an old tab's queue,
  // even if it was offline for the entire delete/restore interval.
  useLayoutEffect(() => {
    if (doc === null || (doc && sessionLifecycle.current !== null && sessionLifecycle.current !== (doc.lifecycle ?? 0))) {
      stopped.current = true
      clearTimeout(timer.current)
      // Preserve the terminal external subscription event across a later restore.
      // eslint-disable-next-line react/set-state-in-effect
      setUnavailable(true)
    } else if (doc) sessionLifecycle.current = doc.lifecycle ?? 0
  }, [doc])

  const send = useCallback(() => {
    clearTimeout(timer.current)
    if (stopped.current || !projectId || sending.current || !unsent.current.size) return
    const queued = [...unsent.current.values()]
    const changes = queued.slice(0, MAX_CHANGES_PER_SAVE)
    sending.current = changes
    unsent.current = new Map()
    for (const change of queued.slice(MAX_CHANGES_PER_SAVE)) queueChange(unsent.current, change)
    save({ id: projectId, clientId: CLIENT_ID, changes: changes.map(toStoredChange), lifecycle: sessionLifecycle.current ?? 0 })
      .then((version) => {
        if (stopped.current) return
        newestVersion.current = Math.max(newestVersion.current, version)
        sending.current = null
        if (unsent.current.size) sendRef.current()
        else setSaveState('saved')
      })
      .catch((error: unknown) => {
        if (stopped.current) return
        if (error instanceof ConvexError && typeof error.data === 'object' && error.data?.code === 'PROJECT_UNAVAILABLE') {
          stopSession()
          return
        }
        console.warn('Saving the project failed; retrying.', error)
        // Put the failed changes back ahead of newer ones, which still win.
        const retry = new Map<string, ProjectChange>()
        for (const change of [...changes, ...unsent.current.values()]) queueChange(retry, change)
        unsent.current = retry
        sending.current = null
        setSaveState('error')
        timer.current = setTimeout(() => sendRef.current(), RETRY_MS)
      })
  }, [projectId, save, stopSession])
  useEffect(() => { sendRef.current = send }, [send])

  const onLocalChange = useCallback((next: StudioProject) => {
    const previous = local.current
    local.current = next
    if (!previous || stopped.current) return
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
    if (stopped.current || !doc || doc.version < newestVersion.current) return
    newestVersion.current = doc.version
    const server = doc.data as StudioProject
    if (!local.current) {
      local.current = server
      setInitialProject(server)
      setInitialLifecycle(doc.lifecycle ?? 0)
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
    status: unavailable || doc === null || (doc && initialLifecycle !== null && initialLifecycle !== (doc.lifecycle ?? 0)) ? 'missing' as const : doc === undefined ? 'loading' as const : 'ready' as const,
    getRecoveryProject: () => local.current,
    name: doc?.name,
    initialProject,
    saveState,
    onLocalChange,
    connectStudio,
  }
}
