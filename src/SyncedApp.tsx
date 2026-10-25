import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import Studio from '../fl_studio_web_daw'
import { AssistantChat } from './assistant/AssistantChat'
import type { ActiveSuggestions } from './assistant/noteCoach'
import type { SuggestionSet } from '../convex/noteSuggestions'
import { StudioHome } from './studio/StudioHome'
import { createBlankProject, createDemoProjects, type ProjectEntry } from './studio/projects'
import { toStored } from './studio/projectSync'
import { useProjectSync } from './studio/useProjectSync'
import type { StudioProject } from './studio/types'
import { AeroBackground, GlassButton, GlassPanel } from './ui/Glass'
import { credentialFor, finishCredential, forgetCredential, newCredential, rememberCredential, useManagementCredentials } from './studio/projectManagement'
import type { Id } from '../convex/_generated/dataModel'

// The app with projects saved in Convex. A project's link (?project=<id>)
// opens it directly, and everyone with the link edits the same project live.

const projectIdFromUrl = () => new URLSearchParams(window.location.search).get('project')
const projectPath = (id: string) => `${window.location.pathname}?project=${encodeURIComponent(id)}`

function SyncedApp() {
  const [openId, setOpenId] = useState(projectIdFromUrl)
  const [creating, setCreating] = useState(false)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [seedError, setSeedError] = useState(false)
  const deleted = useManagementCredentials()
  // Only the home screen needs every project; skipping it in the studio keeps
  // each save from re-sending the whole list to every open browser.
  const projects = useQuery(api.projects.list, openId ? 'skip' : {})
  const hasAny = useQuery(api.projects.hasAny, !openId && projects?.length === 0 ? {} : 'skip')
  const create = useMutation(api.projects.create)
  const seedDemos = useMutation(api.projects.seedDemos)
  const rename = useMutation(api.projects.rename)
  const remove = useMutation(api.projects.remove)
  const restore = useMutation(api.projects.restore)

  // Back and Forward move between the home screen and projects.
  useEffect(() => {
    const onPopState = () => setOpenId(projectIdFromUrl())
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])
  const openProject = (id: string) => {
    window.history.pushState(null, '', projectPath(id))
    setOpenId(id)
  }
  const goHome = () => {
    window.history.pushState(null, '', window.location.pathname)
    setOpenId(null)
  }

  // A brand-new database starts with the demo projects.
  const seeded = useRef(false)
  useEffect(() => {
    if (projects?.length !== 0 || hasAny !== false || seeded.current) return
    seeded.current = true
    const demos = createDemoProjects().map(({ name, color, updatedAt, project }) => ({ name, color, updatedAt, data: toStored(project) }))
    seedDemos({ projects: demos }).then(() => setSeedError(false)).catch((error: unknown) => {
      seeded.current = false
      setSeedError(true)
      console.warn('Adding the demo projects failed:', error)
    })
  }, [projects, seedDemos, hasAny])

  if (openId) return <ProjectSession key={openId} id={openId} onHome={goHome} />
  if (projects === undefined) return <Message text="Loading projects..." />

  const entries: ProjectEntry[] = projects.map((doc) => ({
    id: doc._id, name: doc.name, color: doc.color, updatedAt: doc.updatedAt, project: doc.data as StudioProject,
    version: doc.version, lifecycle: doc.lifecycle ?? 0, canManage: !!credentialFor(doc._id),
  }))
  return (
    <StudioHome
      projects={entries}
      onOpenProject={openProject}
      creating={creating}
      error={creationError ?? (seedError ? 'Demo projects could not be created. You can still create a new project.' : null)}
      onRenameProject={async (entry, name) => {
        await rename({ id: entry.id as Id<'projects'>, key: credentialFor(entry.id)?.key ?? '', name, expectedName: entry.name })
      }}
      onDeleteProject={async entry => {
        // Permanent: the server deletes the project and its chat. The key has nothing left to manage.
        await remove({ id: entry.id as Id<'projects'>, key: credentialFor(entry.id)?.key ?? '' })
        forgetCredential(entry.id)
      }}
      // Only projects soft-deleted before permanent deletion existed can still be restored.
      deletedProjects={deleted}
      onRestoreProject={async id => {
        const recovery = deleted.find(entry => entry.id === id)
        const credential = credentialFor(id)
        if (!recovery || !credential) throw new Error('Management access unavailable')
        await restore({ id: id as Id<'projects'>, key: credential.key, expectedLifecycle: recovery.lifecycle })
        rememberCredential(id, { key: credential.key })
      }}
      onNewProject={() => {
        if (creating) return
        setCreating(true)
        setCreationError(null)
        const entry = createBlankProject(entries)
        newCredential().then(async credential => {
          const id = await create({ name: entry.name, color: entry.color, data: toStored(entry.project), managementKeyHash: credential.hash })
          finishCredential(id, credential.key)
          openProject(id)
        })
          .catch(() => {
            setCreationError('The project could not be opened. Check your connection and allow browser storage before trying again. Existing projects were preserved.')
          })
          .finally(() => setCreating(false))
      }}
    />
  )
}

/** One open project: loads it, then keeps the studio and Convex in sync. */
function ProjectSession({ id, onHome }: { id: string; onHome: () => void }) {
  const sync = useProjectSync(id)
  // AI note highlights are this browser's own view: they never sync or save.
  const [coach, setCoach] = useState<ActiveSuggestions | null>(null)
  const showSuggestions = useCallback((messageId: string, set: SuggestionSet) => {
    setCoach((current) => ({ messageId, set, focus: (current?.focus ?? 0) + 1 }))
  }, [])
  const clearSuggestions = useCallback(() => setCoach(null), [])
  if (sync.status === 'missing') {
    return <Message text="This project doesn't exist or this session is out of date. The link may be wrong, or the project was deleted. Reopen restored projects from the dashboard."
      onHome={onHome} onRecover={sync.initialProject ? () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(sync.getRecoveryProject(), null, 2)], { type: 'application/json' }))
        const link = document.createElement('a')
        link.href = url; link.download = 'remixrelay-recovery.json'; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      } : undefined} />
  }
  if (!sync.initialProject) return <Message text="Opening project..." />
  return (
    <>
      <Studio
        initialProject={sync.initialProject}
        projectName={sync.name}
        onProjectChange={sync.onLocalChange}
        connectRemote={sync.connectStudio}
        saveState={sync.saveState}
        shareUrl={new URL(projectPath(id), window.location.origin).href}
        onHome={onHome}
        noteCoach={coach ? { active: coach, onClear: clearSuggestions } : undefined}
      />
      {/* Claude chat, saved per project in Convex. Floats over the studio. */}
      <AssistantChat
        projectId={id}
        projectReady={sync.saveState === 'saved'}
        highlightedId={coach?.messageId ?? null}
        onShowSuggestions={showSuggestions}
        onHideSuggestions={clearSuggestions}
      />
    </>
  )
}

function Message({ text, onHome, onRetry, onRecover }: { text: string; onHome?: () => void; onRetry?: () => void; onRecover?: () => void }) {
  return (
    <AeroBackground className="grid min-h-dvh place-items-center p-6 text-aero-ink">
    <GlassPanel className="flex flex-col items-center gap-4 rounded-2xl p-8 text-center text-sm" role="status">
      <p>{text}</p>
      {onRecover && <GlassButton onClick={onRecover} className="px-4 py-2 text-xs">Download recovery copy</GlassButton>}
      {onHome && (
        <GlassButton onClick={onHome} className="px-4 py-2 text-xs">
          Back to projects
        </GlassButton>
      )}
      {onRetry && <GlassButton onClick={onRetry} className="px-4 py-2 text-xs">Retry</GlassButton>}
    </GlassPanel>
    </AeroBackground>
  )
}

export default SyncedApp
