import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated/api'
import Studio from '../fl_studio_web_daw'
import { StudioHome } from './studio/StudioHome'
import { createBlankProject, createDemoProjects, type ProjectEntry } from './studio/projects'
import { toStored } from './studio/projectSync'
import { useProjectSync } from './studio/useProjectSync'
import type { StudioProject } from './studio/types'

// The app with projects saved in Convex. A project's link (?project=<id>)
// opens it directly, and everyone with the link edits the same project live.

const projectIdFromUrl = () => new URLSearchParams(window.location.search).get('project')
const projectPath = (id: string) => `${window.location.pathname}?project=${encodeURIComponent(id)}`

function SyncedApp() {
  const [openId, setOpenId] = useState(projectIdFromUrl)
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
    seedDemos({ projects: demos }).catch((error: unknown) => {
      seeded.current = false
      console.warn('Adding the demo projects failed:', error)
    })
  }, [projects, seedDemos])

  if (openId) return <ProjectSession key={openId} id={openId} onHome={goHome} />
  if (!projects?.length) return <Message text="Loading projects..." />

  const entries: ProjectEntry[] = projects.map((doc) => ({
    id: doc._id, name: doc.name, color: doc.color, updatedAt: doc.updatedAt, project: doc.data as StudioProject,
  }))
  return (
    <StudioHome
      projects={entries}
      onOpenProject={openProject}
      onNewProject={() => {
        const entry = createBlankProject(entries)
        create({ name: entry.name, color: entry.color, data: toStored(entry.project) })
          .then(openProject)
          .catch((error: unknown) => console.warn('Creating the project failed:', error))
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

function Message({ text, onHome }: { text: string; onHome?: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#16181b] text-sm text-zinc-400">
      <p>{text}</p>
      {onHome && (
        <button type="button" onClick={onHome} className="rounded-md bg-orange-500 px-3 py-2 text-xs font-bold text-zinc-950 hover:bg-orange-400">
          Back to projects
        </button>
      )}
    </div>
  )
}

export default SyncedApp
