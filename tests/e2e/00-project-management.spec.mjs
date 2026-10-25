import { test, expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'
import { createHash, randomBytes } from 'node:crypto'

const cloud = /https?:\/\/[^/]*\.convex\.(cloud|site)\//
function client() {
  const url = process.env.REMIXRELAY_E2E_CONVEX_URL
  if (!url || !/^http:\/\/127\.0\.0\.1:\d+$/.test(url)) throw new Error('Only disposable anonymous loopback Convex is permitted')
  return new ConvexHttpClient(url)
}
const card = (page, id) => page.locator(`[data-project-card="${id}"]`)
async function action(page, id, name) {
  await card(page, id).getByRole('button', { name: 'Project actions', exact: true }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
async function create(page, origin) {
  await page.goto(origin)
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Tempo BPM')).toBeVisible()
  return { id: new URL(page.url()).searchParams.get('project'), url: page.url() }
}
async function credential(page, id) {
  return page.evaluate(id => {
    const storageKey = Object.keys(localStorage).find(key => key.startsWith('remixrelay:management:') && key.endsWith(':' + id))
    return JSON.parse(localStorage.getItem(storageKey)).key
  }, id)
}
async function confirmDelete(page, id, name) {
  await action(page, id, 'Delete')
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Delete project', exact: true })).toBeDisabled()
  await dialog.getByLabel('Confirm project name').fill(name)
  await dialog.getByRole('button', { name: 'Delete project', exact: true }).click()
  await expect(dialog).toHaveCount(0)
}

test.beforeEach(async ({ page }, info) => {
  test.skip(!info.config.metadata.syncOrigin, 'Requires the anonymous local Convex fixture')
  await page.route(cloud, route => route.abort())
})

// This file runs first on the fresh fixture. A tombstone must not be mistaken
// for a brand-new database; no admin/reset helper or public ownership claim.
test('an empty cloud dashboard with a deleted project does not seed or hang', async ({ page }, info) => {
  const db = client(), key = randomBytes(32).toString('hex')
  const id = await db.mutation(anyApi.projects.create, { name: 'Only project', color: '#22d3ee', data: { bpm: 97, channels: [], stepData: {}, pianoNotes: {} }, managementKeyHash: createHash('sha256').update(key).digest('hex') })
  await db.mutation(anyApi.projects.remove, { id, key, expectedName: 'Only project', expectedVersion: 1, expectedLifecycle: 0 })
  await page.goto(info.config.metadata.syncOrigin)
  await expect(page.getByText('No projects yet. Start one with New project.')).toBeVisible()
  await page.reload()
  await expect(page.getByText('No projects yet. Start one with New project.')).toBeVisible()
  expect(await db.query(anyApi.projects.list, {})).toEqual([])
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException('Test storage denial', 'SecurityError') } })
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('allow browser storage')
  expect(await db.query(anyApi.projects.list, {})).toEqual([])
  await page.reload()
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Tempo BPM')).toBeVisible()
})

test('rename updates a collaborator without changing music; share links confer no management access', async ({ page, browser }, info) => {
  const db = client(), origin = info.config.metadata.syncOrigin
  const { id, url } = await create(page, origin)
  const key = await credential(page, id)
  expect(url).not.toContain(key)
  const second = await browser.newContext()
  await second.route(cloud, route => route.abort())
  const peer = await second.newPage()
  try {
    await peer.goto(url)
    await expect(peer.getByLabel('Tempo BPM')).toBeVisible()
    await peer.getByLabel('Tempo BPM').fill('113'); await peer.getByLabel('Tempo BPM').press('Enter')
    await expect(peer.getByLabel('Save status')).toHaveText('Saved')
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    const before = await db.query(anyApi.projects.get, { id })
    expect(before).not.toHaveProperty('managementKeyHash')
    await action(page, id, 'Rename')
    const dialog = page.getByRole('dialog', { name: 'Rename project' })
    await page.screenshot({ path: 'test-results/project-management-rename.png' })
    await dialog.getByLabel('Project name').fill('   ')
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    expect((await db.query(anyApi.projects.get, { id })).name).toBe(before.name)
    await action(page, id, 'Rename')
    await dialog.getByLabel('Project name').fill('  Shared renamed song  ')
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(card(page, id)).toContainText('Shared renamed song')
    await expect(peer.locator('header')).toContainText('Shared renamed song')
    const after = await db.query(anyApi.projects.get, { id })
    expect(after.data).toEqual(before.data)
    expect(after.version).toBe(before.version)
    await action(page, id, 'Delete')
    await peer.getByLabel('Tempo BPM').fill('119'); await peer.getByLabel('Tempo BPM').press('Enter')
    await expect(peer.getByLabel('Save status')).toHaveText('Saved')
    await page.getByLabel('Confirm project name').fill(after.name)
    await page.getByRole('dialog').getByRole('button', { name: 'Delete project', exact: true }).click()
    await expect(page.getByRole('dialog').getByRole('alert')).toContainText('project changed')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    await peer.getByRole('button', { name: 'Home', exact: true }).click()
    await card(peer, id).getByRole('button', { name: /^Project actions/ }).click()
    await expect(peer.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled()
    await expect(peer.getByRole('menuitem', { name: 'Rename', exact: true })).toBeDisabled()
    await expect(db.mutation(anyApi.projects.remove, { id, key: 'f'.repeat(64), expectedName: after.name, expectedVersion: after.version, expectedLifecycle: 0 })).rejects.toThrow('Management access')
    await page.reload()
    await expect(card(page, id)).toContainText('Shared renamed song')
  } finally { await second.close() }
})

test('delete stops collaborators and preserves chat/music; Undo and refresh Restore work', async ({ page, browser }, info) => {
  const db = client(), origin = info.config.metadata.syncOrigin
  const { id, url } = await create(page, origin)
  await page.getByRole('button', { name: 'Kick 808 step 3', exact: true }).click()
  await expect(page.getByLabel('Save status')).toHaveText('Saved')
  await db.mutation(anyApi.chat.send, { projectId: id, requestId: 'local-memory-1234', content: 'Keep this conversation' })
  await expect.poll(async () => (await db.query(anyApi.chat.list, { projectId: id })).at(-1).status).toBe('error')
  const before = await db.query(anyApi.projects.get, { id })
  const second = await browser.newContext()
  await second.route(cloud, route => route.abort())
  await second.addInitScript(() => {
    const Native = window.AudioContext
    window.__contexts = []
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__contexts.push(this) } }
  })
  const peer = await second.newPage()
  try {
    await peer.goto(url)
    await expect(peer.getByLabel('Tempo BPM')).toBeVisible()
    const baseline = await peer.evaluate(() => window.__contexts.filter(context => context.state !== 'closed').length)
    await peer.getByRole('button', { name: 'Play', exact: true }).click()
    await expect(peer.locator('footer')).toContainText('AUDIO: PLAYING')
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await action(page, id, 'Delete')
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click()
    expect(await db.query(anyApi.projects.get, { id })).not.toBeNull()
    await confirmDelete(page, id, before.name)
    await expect(card(page, id)).toHaveCount(0)
    await expect(peer.getByText(/This project doesn't exist or this session is out of date/)).toBeVisible()
    await expect.poll(() => peer.evaluate(() => window.__contexts.filter(context => context.state !== 'closed').length)).toBe(baseline)
    await expect(peer.getByRole('button', { name: 'Download recovery copy' })).toBeVisible()
    expect(await db.query(anyApi.chat.list, { projectId: id })).toEqual([])
    const visitor = await second.newPage()
    await visitor.goto(url)
    await expect(visitor.getByRole('button', { name: 'Back to projects' })).toBeVisible()
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(card(page, id)).toBeVisible()
    expect((await db.query(anyApi.projects.get, { id })).data).toEqual(before.data)
    expect((await db.query(anyApi.chat.list, { projectId: id }))[0].content).toBe('Keep this conversation')
    // An old session stays stopped until explicitly reopened, even after Undo.
    await expect(peer.getByLabel('Tempo BPM')).toHaveCount(0)
    await expect(visitor.getByRole('button', { name: 'Back to projects' })).toBeVisible()
    await expect(visitor.getByText('Opening project...', { exact: true })).toHaveCount(0)
    await visitor.close()
    await peer.reload()
    await expect(peer.getByRole('button', { name: 'Kick 808 step 3', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await confirmDelete(page, id, before.name)
    await page.reload()
    await page.getByRole('region', { name: 'Recently deleted projects' }).getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(card(page, id)).toBeVisible()
    expect((await db.query(anyApi.projects.get, { id })).data).toEqual(before.data)
    await peer.goto(origin + '/?project=invalid-link')
    await expect(peer.getByRole('button', { name: 'Back to projects' })).toBeVisible()
  } finally { await second.close() }
})

test('a save queued while offline cannot replay across delete and restore', async ({ page, browser }, info) => {
  const db = client(), origin = info.config.metadata.syncOrigin
  const { id, url } = await create(page, origin)
  const before = await db.query(anyApi.projects.get, { id })
  const second = await browser.newContext()
  await second.route(cloud, route => route.abort())
  const peer = await second.newPage()
  try {
    await peer.goto(url)
    await expect(peer.getByLabel('Tempo BPM')).toBeVisible()
    await second.setOffline(true)
    await peer.getByRole('button', { name: 'Kick 808 step 7', exact: true }).click()
    await expect(peer.getByLabel('Save status')).toHaveText('Saving')
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await confirmDelete(page, id, before.name)
    await page.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(card(page, id)).toBeVisible()
    await second.setOffline(false)
    await expect(peer.getByRole('button', { name: 'Download recovery copy' })).toBeVisible()
    expect((await db.query(anyApi.projects.get, { id })).data).toEqual(before.data)
    const download = peer.waitForEvent('download')
    await peer.getByRole('button', { name: 'Download recovery copy' }).click()
    const recovery = await download
    expect(recovery.suggestedFilename()).toBe('remixrelay-recovery.json')
    const chunks = []
    for await (const chunk of await recovery.createReadStream()) chunks.push(chunk)
    expect(JSON.parse(Buffer.concat(chunks).toString()).stepData[1].kick[6]).toBe(1)
    await peer.reload()
    await expect(peer.getByRole('button', { name: 'Kick 808 step 7', exact: true })).toHaveAttribute('aria-pressed', 'false')
  } finally { await second.setOffline(false); await second.close() }
})
