import { readFileSync } from 'node:fs'

const env = readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
export const deployment = env.match(/^CONVEX_DEPLOYMENT=(dev:[a-z]+-[a-z]+-\d+)/m)?.[1]
export const CONVEX_URL = env.match(/^VITE_CONVEX_URL=(.+)$/m)?.[1].trim()
// These checks create test projects. Refuse any production or mismatched URL,
// including a URL override left over in the caller's environment.
if (!deployment || CONVEX_URL !== `https://${deployment.slice(4)}.convex.cloud` ||
    (process.env.CONVEX_URL && process.env.CONVEX_URL !== CONVEX_URL)) {
  throw new Error('Browser/backend checks require a matching Convex DEVELOPMENT deployment in .env.local')
}
