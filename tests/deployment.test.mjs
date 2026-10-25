import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { deploymentEnvironment } from '../scripts/deployment-env.mjs'

const approved = {
  REMIXRELAY_DEPLOYMENT_MODE: 'collaborative-demo',
  REMIXRELAY_CONVEX_PRODUCTION_NAME: 'demo-production-123',
  VITE_CONVEX_URL: 'https://demo-production-123.convex.cloud',
}
const developmentDeployment = 'watchful-sockeye-395'
const developmentUrl = `https://${developmentDeployment}.convex.cloud`

test('hosted builds require an explicit deployment mode', () => {
  for (const mode of [undefined, '', 'production', 'collaboration']) {
    assert.throws(() => deploymentEnvironment({ ...approved, REMIXRELAY_DEPLOYMENT_MODE: mode }), /DEPLOYMENT_MODE/)
  }
})

test('local builds override inherited Convex URLs without mutating their caller', () => {
  const env = { ...approved, REMIXRELAY_DEPLOYMENT_MODE: 'local', VITE_CONVEX_URL: 'https://development-456.convex.cloud' }
  assert.equal(deploymentEnvironment(env).VITE_CONVEX_URL, '')
  assert.equal(env.VITE_CONVEX_URL, 'https://development-456.convex.cloud')
})

test('collaborative builds accept only the dashboard-confirmed production host', () => {
  assert.equal(deploymentEnvironment(approved).VITE_CONVEX_URL, approved.VITE_CONVEX_URL)
  assert.equal(deploymentEnvironment({ ...approved, VITE_CONVEX_URL: `${approved.VITE_CONVEX_URL}/` }).VITE_CONVEX_URL, approved.VITE_CONVEX_URL)
  for (const name of [undefined, '', 'prod:name', '../name', 'name.convex.cloud']) {
    assert.throws(() => deploymentEnvironment({ ...approved, REMIXRELAY_CONVEX_PRODUCTION_NAME: name }), /PRODUCTION_NAME/)
  }
})

test('the prepared Vercel Production settings target the owner-confirmed backend and reject a dev URL swap', () => {
  const settings = Object.fromEntries(
    readFileSync(new URL('../.env.vercel-production.example', import.meta.url), 'utf8')
      .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }),
  )
  assert.equal(settings.REMIXRELAY_CONVEX_PRODUCTION_NAME, 'silent-butterfly-873')
  assert.equal(deploymentEnvironment(settings).VITE_CONVEX_URL, 'https://silent-butterfly-873.convex.cloud')
  assert.deepEqual(Object.keys(settings).sort(), ['REMIXRELAY_CONVEX_PRODUCTION_NAME', 'REMIXRELAY_DEPLOYMENT_MODE', 'VITE_CONVEX_URL'])
  assert.throws(() => deploymentEnvironment({ ...settings, VITE_CONVEX_URL: developmentUrl }), /VITE_CONVEX_URL/)
})

test('development mismatches, site URLs, and malformed or credential-bearing URLs are rejected', () => {
  for (const url of [
    undefined, '', 'not a URL',
    'https://development-456.convex.cloud',
    'https://demo-production-123.convex.site',
    'https://demo-production-123.convex.cloud.attacker.example',
    'http://demo-production-123.convex.cloud',
    'https://demo-production-123.convex.cloud:8443',
    'https://user:password@demo-production-123.convex.cloud',
    'https://demo-production-123.convex.cloud/path',
    'https://demo-production-123.convex.cloud/?key=secret',
    'https://demo-production-123.convex.cloud/#fragment',
  ]) {
    assert.throws(() => deploymentEnvironment({ ...approved, VITE_CONVEX_URL: url }), /VITE_CONVEX_URL/)
  }
})

test('the known development database is blocked even when both production settings name it', () => {
  const dev = {
    ...approved,
    REMIXRELAY_CONVEX_PRODUCTION_NAME: developmentDeployment,
    VITE_CONVEX_URL: developmentUrl,
  }
  assert.throws(() => deploymentEnvironment(dev), /existing development deployment/)
  const result = spawnSync(process.execPath, ['scripts/vercel-build.mjs'], {
    cwd: new URL('../', import.meta.url), env: { ...process.env, ...dev }, encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /existing development deployment/)
  assert.doesNotMatch(result.stdout, /building client/)
  assert.equal(deploymentEnvironment({ ...dev, REMIXRELAY_DEPLOYMENT_MODE: 'local' }).VITE_CONVEX_URL, '')
})

test('deployment errors do not echo supplied credentials', () => {
  const secret = 'test-only-private-marker'
  assert.throws(
    () => deploymentEnvironment({ ...approved, VITE_CONVEX_URL: `https://user:${secret}@demo-production-123.convex.cloud` }),
    (error) => !error.message.includes(secret),
  )
})

test('the actual hosted build fails before compilation when configuration is missing', () => {
  const env = { ...process.env }
  delete env.REMIXRELAY_DEPLOYMENT_MODE
  const result = spawnSync(process.execPath, ['scripts/vercel-build.mjs'], {
    cwd: new URL('../', import.meta.url), env, encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /REMIXRELAY_DEPLOYMENT_MODE/)
  assert.doesNotMatch(result.stdout, /building client/)
})

test('the standard npm build cannot default to local mode on Vercel', () => {
  const env = { ...process.env, VERCEL: '1' }
  delete env.REMIXRELAY_DEPLOYMENT_MODE
  const result = spawnSync(process.execPath, ['scripts/vercel-build.mjs', '--local-default'], {
    cwd: new URL('../', import.meta.url), env, encoding: 'utf8',
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /REMIXRELAY_DEPLOYMENT_MODE/)
  assert.doesNotMatch(result.stdout, /building client/)
})

test('the standard hosted build rejects the known dev deployment', () => {
  const result = spawnSync(process.execPath, ['scripts/vercel-build.mjs', '--local-default'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
    env: { ...process.env, VERCEL: '1', REMIXRELAY_DEPLOYMENT_MODE: 'collaborative-demo', REMIXRELAY_CONVEX_PRODUCTION_NAME: developmentDeployment, VITE_CONVEX_URL: developmentUrl },
  })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /existing development deployment/)
  assert.doesNotMatch(result.stdout, /building client/)
})

test('Vercel uses the guarded build and leaves automatic Git publishing disabled', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(config.buildCommand, 'npm run build')
  assert.equal(pkg.scripts.build, 'node scripts/vercel-build.mjs --local-default')
  assert.equal(config.outputDirectory, 'dist')
  assert.equal(config.git.deploymentEnabled, false)
  assert.equal(config.framework, 'vite')
  assert.equal(config.installCommand, 'npm ci')
  assert.equal(config.builds, undefined, 'legacy builders must not bypass the frontend build')
  assert.equal(config.routes, undefined, 'no catch-all Python routing')
  assert.equal(config.functions, undefined, 'Convex is the only active backend')
  assert.deepEqual(config.rewrites, [{ source: '/((?!api(?:/|$)|assets(?:/|$)).*)', destination: '/index.html' }])
})

test('SPA fallback covers navigation but cannot swallow API or missing asset requests', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  const fallback = new RegExp(`^${config.rewrites[0].source}$`)
  for (const path of ['/', '/studio', '/studio/shared-project', '/apiary']) assert.equal(fallback.test(path), true, path)
  for (const path of ['/api', '/api/main', '/api/aiAssist', '/api/startInquiry', '/assets', '/assets/missing.js']) {
    assert.equal(fallback.test(path), false, path)
  }
  // Vercel serves existing filesystem entries before applying this fallback.
  const vite = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')
  assert.match(vite, /audioTest:.*audio-test\.html/)
})

test('Python experiments and dependencies cannot be auto-discovered as Vercel functions', () => {
  for (const path of ['api', 'requirements.txt', 'pyproject.toml', 'main.py', 'app.py']) {
    assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), false, path)
  }
  for (const path of ['main.py', 'claude_reader.py', 'requirements.txt']) {
    assert.equal(existsSync(new URL(`../experiments/python-api/${path}`, import.meta.url)), true, path)
  }
  const ignored = readFileSync(new URL('../.vercelignore', import.meta.url), 'utf8').split(/\r?\n/)
  assert.ok(ignored.includes('/experiments/'))
  assert.ok(ignored.includes('/backend/'))
})
