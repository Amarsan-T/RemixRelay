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
/** One click on Delete: no dialog, no confirmation, and the card is gone. */
async function deleteNow(page, id) {
  await action(page, id, 'Delete')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(card(page, id)).toHaveCount(0)
}

test.beforeEach(async ({ page }, info) => {
  test.skip(!info.config.metadata.syncOrigin, 'Requires the anonymous local Convex fixture')
  await page.route(cloud, route => route.abort())
})

// This file runs first on the fresh fixture. Deleting the only project must not
// make the database look brand-new; no admin/reset helper or public ownership claim.
test('an empty cloud dashboard after deleting the only project does not seed or hang', async ({ page }, info) => {
  const db = client(), key = randomBytes(32).toString('hex')
  const id = await db.mutation(anyApi.projects.create, { name: 'Only project', color: '#22d3ee', data: { bpm: 97, channels: [], stepData: {}, pianoNotes: {} }, managementKeyHash: createHash('sha256').update(key).digest('hex') })
  await db.mutation(anyApi.projects.remove, { id, key, permanent: true })
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
    await peer.getByRole('button', { name: 'Home', exact: true }).click()
    await card(peer, id).getByRole('button', { name: /^Project actions/ }).click()
    await expect(peer.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled()
    await expect(peer.getByRole('menuitem', { name: 'Rename', exact: true })).toBeDisabled()
    await expect(db.mutation(anyApi.projects.remove, { id, key: 'f'.repeat(64), permanent: true })).rejects.toThrow('Management access')
    // An outdated page (confirm-and-undo version) is refused even with the owner's key: nothing is deleted.
    await expect(db.mutation(anyApi.projects.remove, { id, key, expectedName: after.name, expectedVersion: after.version, expectedLifecycle: 0 })).rejects.toThrow('Refresh RemixRelay')
    expect(await db.query(anyApi.projects.get, { id })).toEqual(after)
    await page.reload()
    await expect(card(page, id)).toContainText('Shared renamed song')
  } finally { await second.close() }
})

test('one-click Delete is permanent: music and chat are gone, collaborators stop, others untouched', async ({ page, browser }, info) => {
  const db = client(), origin = info.config.metadata.syncOrigin
  const other = await create(page, origin)
  const otherBefore = await db.query(anyApi.projects.get, { id: other.id })
  const { id, url } = await create(page, origin)
  await page.getByRole('button', { name: 'Kick 808 step 3', exact: true }).click()
  await expect(page.getByLabel('Save status')).toHaveText('Saved')
  await db.mutation(anyApi.chat.send, { projectId: id, requestId: 'local-memory-1234', content: 'Delete this conversation' })
  await expect.poll(async () => (await db.query(anyApi.chat.list, { projectId: id })).at(-1).status).toBe('error')
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
    await deleteNow(page, id)
    // Gone for good: no Undo, no Restore, nothing left on the server.
    await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Recently deleted projects' })).toHaveCount(0)
    expect(await db.query(anyApi.projects.get, { id })).toBeNull()
    expect(await db.query(anyApi.chat.list, { projectId: id })).toEqual([])
    expect(await page.evaluate(id => Object.keys(localStorage).some(key => key.startsWith('remixrelay:management:') && key.endsWith(':' + id)), id)).toBe(false)
    // The collaborator's session closes in real time and its audio stops.
    await expect(peer.getByText(/This project doesn't exist or this session is out of date/)).toBeVisible()
    await expect.poll(() => peer.evaluate(() => window.__contexts.filter(context => context.state !== 'closed').length)).toBe(baseline)
    const visitor = await second.newPage()
    await visitor.goto(url)
    await expect(visitor.getByRole('button', { name: 'Back to projects' })).toBeVisible()
    await visitor.close()
    await page.reload()
    await expect(card(page, id)).toHaveCount(0)
    await expect(card(page, other.id)).toBeVisible()
    expect(await db.query(anyApi.projects.get, { id: other.id })).toEqual(otherBefore)
  } finally { await second.close() }
})

test('a save queued while offline cannot recreate a permanently deleted project', async ({ page, browser }, info) => {
  const db = client(), origin = info.config.metadata.syncOrigin
  const { id, url } = await create(page, origin)
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
    await deleteNow(page, id)
    await second.setOffline(false)
    // The collaborator keeps their own unsaved copy as a local download; the server project stays deleted.
    await expect(peer.getByRole('button', { name: 'Download recovery copy' })).toBeVisible()
    expect(await db.query(anyApi.projects.get, { id })).toBeNull()
    const download = peer.waitForEvent('download')
    await peer.getByRole('button', { name: 'Download recovery copy' }).click()
    const recovery = await download
    expect(recovery.suggestedFilename()).toBe('remixrelay-recovery.json')
    const chunks = []
    for await (const chunk of await recovery.createReadStream()) chunks.push(chunk)
    expect(JSON.parse(Buffer.concat(chunks).toString()).stepData[1].kick[6]).toBe(1)
    await peer.reload()
    await expect(peer.getByRole('button', { name: 'Back to projects' })).toBeVisible()
    expect(await db.query(anyApi.projects.get, { id })).toBeNull()
  } finally { await second.setOffline(false); await second.close() }
})
