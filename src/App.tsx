import { useState } from 'react'
import Studio from '../fl_studio_web_daw'
import { StudioHome } from './studio/StudioHome'
import { createBlankProject, createDemoProjects, type ProjectEntry } from './studio/projects'

// Home screen -> pick a project -> studio. HOME in the studio comes back here.
function App() {
  const [projects, setProjects] = useState<ProjectEntry[]>(createDemoProjects)
  const [openId, setOpenId] = useState<string | null>(null)
  const [deleted, setDeleted] = useState<ProjectEntry[]>([])
  const [lastDeletedId, setLastDeletedId] = useState<string>()
  const open = projects.find((p) => p.id === openId)

  if (open) {
    return (
      <Studio
        // A new key gives each project a fresh studio (its own audio, tabs, selection).
        key={open.id}
        initialProject={open.project}
        projectName={open.name}
        onProjectChange={(project) =>
          setProjects((all) =>
            all.map((p) => (p.id === open.id ? { ...p, project, updatedAt: Date.now() } : p)),
          )
        }
        onHome={() => setOpenId(null)}
      />
    )
  }

  return (
    <StudioHome
      projects={projects}
      onOpenProject={setOpenId}
      onRenameProject={async (entry, name) => setProjects(all => all.map(project => project.id === entry.id ? { ...project, name: name.trim(), updatedAt: Date.now() } : project))}
      onDeleteProject={async entry => { setProjects(all => all.filter(project => project.id !== entry.id)); setDeleted(all => [entry, ...all]); setLastDeletedId(entry.id) }}
      deletedProjects={deleted}
      lastDeletedId={lastDeletedId}
      onRestoreProject={async id => { const entry = deleted.find(project => project.id === id); if (entry) setProjects(all => [...all, entry]); setDeleted(all => all.filter(project => project.id !== id)) }}
      onNewProject={() => {
        const entry = createBlankProject(projects)
        setProjects([entry, ...projects])
        setOpenId(entry.id)
      }}
    />
  )
}

export default App
