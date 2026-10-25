import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import Studio from '../fl_studio_web_daw'
import { StudioHome } from './studio/StudioHome'
import { createBlankProject, createDemoProjects, type ProjectEntry } from './studio/projects'
import { toStored } from './studio/projectSync'
import { useProjectSync } from './studio/useProjectSync'
import type { StudioProject } from './studio/types'
import { AeroBackground, GlassButton, GlassPanel } from './ui/Glass'

// The app with projects saved in Convex. A project's link (?project=<id>)
// opens it directly, and everyone with the link edits the same project live.

const projectIdFromUrl = () => new URLSearchParams(window.location.search).get('project')
const projectPath = (id: string) => `${window.location.pathname}?project=${encodeURIComponent(id)}`

function SyncedApp() {
  const [openId, setOpenId] = useState(projectIdFromUrl)
  const [creating, setCreating] = useState(false)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [seedError, setSeedError] = useState(false)
  // Only the home screen needs every project; skipping it in the studio keeps
  // each save from re-sending the whole list to every open browser.
  const projects = useQuery(api.projects.list, openId ? 'skip' : {})
  const create = useMutation(api.projects.create)
  const seedDemos = useMutation(api.projects.seedDemos)

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
    if (projects?.length !== 0 || seeded.current) return
    seeded.current = true
    const demos = createDemoProjects().map(({ name, color, updatedAt, project }) => ({ name, color, updatedAt, data: toStored(project) }))
    seedDemos({ projects: demos }).then(() => setSeedError(false)).catch((error: unknown) => {
      seeded.current = false
      setSeedError(true)
      console.warn('Adding the demo projects failed:', error)
    })
  }, [projects, seedDemos])

  if (openId) return <ProjectSession key={openId} id={openId} onHome={goHome} />
  if (!projects?.length) return <Message text={seedError ? 'Demo projects could not be created. Check your connection and retry.' : 'Loading projects...'} onRetry={seedError ? () => window.location.reload() : undefined} />

  const entries: ProjectEntry[] = projects.map((doc) => ({
    id: doc._id, name: doc.name, color: doc.color, updatedAt: doc.updatedAt, project: doc.data as StudioProject,
  }))
  return (
    <StudioHome
      projects={entries}
      onOpenProject={openProject}
      creating={creating}
      error={creationError}
      onNewProject={() => {
        if (creating) return
        setCreating(true)
        setCreationError(null)
        const entry = createBlankProject(entries)
        create({ name: entry.name, color: entry.color, data: toStored(entry.project) })
          .then(openProject)
          .catch((error: unknown) => {
            setCreationError('The project could not be created. Check your connection and try again.')
            console.warn('Creating the project failed:', error)
          })
          .finally(() => setCreating(false))
      }}
    />
  )
}

/** One open project: loads it, then keeps the studio and Convex in sync. */
function ProjectSession({ id, onHome }: { id: string; onHome: () => void }) {
  const sync = useProjectSync(id)
  if (sync.status === 'missing') {
    return <Message text="This project doesn't exist. The link may be wrong, or the project was deleted." onHome={onHome} />
  }
  if (!sync.initialProject) return <Message text="Opening project..." />
  return (
    <Studio
      initialProject={sync.initialProject}
      projectName={sync.name}
      onProjectChange={sync.onLocalChange}
      connectRemote={sync.connectStudio}
      saveState={sync.saveState}
      shareUrl={new URL(projectPath(id), window.location.origin).href}
      onHome={onHome}
    />
  )
}

function Message({ text, onHome, onRetry }: { text: string; onHome?: () => void; onRetry?: () => void }) {
  return (
    <AeroBackground className="grid min-h-dvh place-items-center p-6 text-aero-ink">
    <GlassPanel className="flex flex-col items-center gap-4 rounded-2xl p-8 text-center text-sm" role="status">
      <p>{text}</p>
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
