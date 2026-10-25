import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import './index.css'
import App from './App.tsx'
import SyncedApp from './SyncedApp.tsx'

// With a Convex deployment configured, projects are saved and shared live.
// Without one, the app still runs, keeping projects in memory.
const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {convexUrl ? (
      <ConvexProvider client={new ConvexReactClient(convexUrl)}>
        <SyncedApp />
      </ConvexProvider>
    ) : (
      <App />
    )}
  </StrictMode>,
)
