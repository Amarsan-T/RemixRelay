import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { deploymentEnvironment } from './deployment-env.mjs'

try {
  // Read only explicit process settings, so a forgotten local .env cannot select
  // a shared development database. No Convex deploy command runs in this build.
  const settings = { ...process.env }
  // Preserve a safe zero-configuration local build. Vercel sets VERCEL=1;
  // hosted builds must still supply an explicit mode and pass every check.
  if (process.argv.includes('--local-default') && settings.VERCEL !== '1' && settings.REMIXRELAY_DEPLOYMENT_MODE === undefined) {
    settings.REMIXRELAY_DEPLOYMENT_MODE = 'local'
  }
  const env = deploymentEnvironment(settings)
  const cwd = fileURLToPath(new URL('../', import.meta.url))
  console.log(`[deployment] ${env.REMIXRELAY_DEPLOYMENT_MODE}; backend deployment is a separate approved step.`)
  for (const args of [['node_modules/typescript/bin/tsc', '-b'], ['node_modules/vite/bin/vite.js', 'build']]) {
    const result = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
} catch (error) {
  console.error(`[deployment] ${error.message}`)
  process.exit(1)
}
