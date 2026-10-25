/**
 * A hosted build must explicitly choose the local editor or the anonymous demo.
 * Convex dev/prod URLs have the same shape: the production name must first be
 * confirmed in the dashboard by the deployment owner. This is a configuration
 * cross-check, not backend authentication or proof of the deployment's type.
 */
export function deploymentEnvironment(env) {
  const mode = env.REMIXRELAY_DEPLOYMENT_MODE
  if (mode === 'local') {
    // An explicit empty value overrides Vite's .env files, including .env.local.
    return { ...env, VITE_CONVEX_URL: '' }
  }
  if (mode !== 'collaborative-demo') {
    throw new Error('Set REMIXRELAY_DEPLOYMENT_MODE to local or collaborative-demo before a hosted build.')
  }

  const name = env.REMIXRELAY_CONVEX_PRODUCTION_NAME?.trim()
  if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('Set REMIXRELAY_CONVEX_PRODUCTION_NAME to the dashboard-confirmed production deployment name.')
  }
  // The owner identified this deployment as the existing test/dev database.
  // Reject it even when someone mistakenly puts the same name in both settings.
  if (name === 'watchful-sockeye-395') {
    throw new Error('The existing development deployment cannot be used for a hosted collaborative demo.')
  }
  let url
  try {
    url = new URL(env.VITE_CONVEX_URL)
  } catch {
    throw new Error('Set VITE_CONVEX_URL to the approved production HTTPS deployment URL.')
  }
  const expected = `https://${name}.convex.cloud`
  if (url.origin !== expected || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_CONVEX_URL must match the confirmed production name at https://<name>.convex.cloud without a path or credentials.')
  }
  return { ...env, VITE_CONVEX_URL: expected }
}
