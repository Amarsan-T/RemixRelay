import { ConvexError } from 'convex/values'
import type { Doc } from './_generated/dataModel'

export const isActive = (project: Doc<'projects'> | null): project is Doc<'projects'> =>
  project !== null && project.deletedAt === undefined

export const unavailable = () => new ConvexError({ code: 'PROJECT_UNAVAILABLE', message: 'This project is unavailable. Reopen it from the dashboard.' })

export async function keyHash(key: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key))))
    .map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Possession of a share URL, clientId or project ID is never management permission. */
export async function requireManagement(project: Doc<'projects'> | null, key: string) {
  if (!project?.managementKeyHash || !/^[a-f0-9]{64}$/.test(key) || await keyHash(key) !== project.managementKeyHash) {
    throw new ConvexError('Management access is unavailable in this browser. Contact the project owner.')
  }
  return project
}

export function publicProject(project: Doc<'projects'>) {
  const { managementKeyHash: _managementKeyHash, ...safe } = project
  return safe
}
