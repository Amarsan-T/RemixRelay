import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
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

test('Vercel uses the guarded build and leaves automatic Git publishing disabled', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
  assert.equal(config.buildCommand, 'npm run build:vercel')
  assert.equal(config.outputDirectory, 'dist')
  assert.equal(config.git.deploymentEnabled, false)
  assert.equal(config.rewrites, undefined, 'the standalone audio-test HTML must remain directly accessible')
})
