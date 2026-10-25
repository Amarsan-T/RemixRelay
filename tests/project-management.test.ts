import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from '../convex/_generated/api'
import schema from '../convex/schema'
import { keyHash } from '../convex/projectAccess'

const modules = import.meta.glob('../convex/**/*.ts')
const key = 'a1'.repeat(32)
const otherKey = 'b2'.repeat(32)
const music = { bpm: 97, stepData: { 1: { kick: [1, 0, 1] } }, pianoNotes: { 1: { synth: [{ pitch: 'C4', step: 2 }] } } }
const createTest = () => convexTest(schema, modules)
let t: ReturnType<typeof createTest>
let id: Awaited<ReturnType<typeof create>>
const create = async (managed = true) => t.mutation(api.projects.create, {
  name: 'Test song', color: '#22d3ee', data: music, ...(managed ? { managementKeyHash: await keyHash(key) } : {}),
})
const raw = () => t.run(ctx => ctx.db.get(id))
const get = () => t.query(api.projects.get, { id })
const remove = (projectId = id) => t.mutation(api.projects.remove, { id: projectId, key, permanent: true })
const messagesOf = (projectId: typeof id) => t.run(ctx => ctx.db.query('chatMessages').withIndex('by_project', q => q.eq('projectId', projectId)).collect())
const attemptsOf = (projectId: typeof id) => t.run(ctx => ctx.db.query('chatAttempts').withIndex('by_project_started', q => q.eq('projectId', projectId)).collect())
const ask = (projectId: typeof id, content = 'Question', requestId: string = crypto.randomUUID()) => t.mutation(api.chat.send, { projectId, content, requestId })
/** A project soft-deleted by the earlier delete-with-undo flow. */
const legacyTombstone = async () => t.run(async ctx => ctx.db.insert('projects', {
  name: 'Old deleted song', color: 'red', data: music, version: 3, updatedAt: Date.now(),
  managementKeyHash: await keyHash(key), deletedAt: Date.now() - 1000, lifecycle: 1,
}))
const save = (lifecycle = 0) => t.mutation(api.projects.save, { id, clientId: 'peer', lifecycle, changes: [{ path: ['bpm'], value: 109 }] })

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubEnv('AI_SERVICE_URL', '')
  vi.stubEnv('AI_SERVICE_TOKEN', '')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network permitted in project-management tests') }))
  t = createTest()
  id = await create()
})
afterEach(async () => {
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals()
})

test('public reads never reveal credential hashes or keys', async () => {
  const hash = (await raw())!.managementKeyHash!
  for (const result of [await get(), await t.query(api.projects.list, {}), await t.query(internal.projects.load, { id })]) {
    expect(JSON.stringify(result)).not.toContain(hash)
    expect(JSON.stringify(result)).not.toContain(key)
    expect(JSON.stringify(result)).not.toContain('managementKeyHash')
  }
  expect(hash).not.toBe(key)
})

test('management requires the secret, not a share ID or the stored hash', async () => {
  const before = await raw()
  for (const badKey of ['', id, otherKey, before!.managementKeyHash!]) {
    await expect(t.mutation(api.projects.rename, { id, key: badKey, name: 'Stolen', expectedName: 'Test song' })).rejects.toThrow('Management access')
    await expect(t.mutation(api.projects.remove, { id, key: badKey, permanent: true })).rejects.toThrow('Management access')
  }
  expect(await raw()).toEqual(before)
})

test('legacy projects cannot be publicly claimed or managed; music saves remain compatible', async () => {
  id = await create(false)
  const before = await raw()
  await expect(remove()).rejects.toThrow('Management access')
  await expect(t.mutation(api.projects.rename, { id, key, name: 'Claimed', expectedName: 'Test song' })).rejects.toThrow('Management access')
  expect(await raw()).toEqual(before)
  for (const field of ['managementKeyHash', 'deletedAt', 'lifecycle']) {
    await expect(t.mutation(api.projects.save, { id, clientId: 'attacker', changes: [{ path: [field], value: field === 'managementKeyHash' ? key : 1 }] })).rejects.toThrow('Not a project field')
  }
  await save()
  expect((await get())!.data.bpm).toBe(109)
})

test('rename validates names and preserves concurrent music and synchronization version', async () => {
  for (const name of ['', '   ', 'x'.repeat(81), 'two\nlines', '\u0000']) {
    await expect(t.mutation(api.projects.rename, { id, key, name, expectedName: 'Test song' })).rejects.toThrow('project name')
  }
  await save()
  const before = (await raw())!
  await t.mutation(api.projects.rename, { id, key, name: '  New title  ', expectedName: 'Test song' })
  const after = (await get())!
  expect(after.name).toBe('New title')
  expect(after.data).toEqual(before.data)
  expect(after.version).toBe(before.version)
  await expect(t.mutation(api.projects.rename, { id, key, name: 'Stale', expectedName: 'Test song' })).rejects.toThrow('renamed elsewhere')
  await t.mutation(api.projects.rename, { id, key, name: 'New title', expectedName: 'Test song' })
})

test('one Delete permanently removes the project, its music and its chat; other projects are untouched', async () => {
  const otherId = await create()
  await ask(otherId, 'Other question')
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const otherBefore = { project: await t.run(ctx => ctx.db.get(otherId)), messages: await messagesOf(otherId), attempts: await attemptsOf(otherId) }
  await ask(id, 'Remember my phrase')
  expect(await messagesOf(id)).toHaveLength(2)
  await remove()
  expect(await raw()).toBeNull()
  expect(await get()).toBeNull()
  expect(await t.query(internal.projects.load, { id })).toBeNull()
  expect(await t.query(api.chat.list, { projectId: id })).toEqual([])
  expect(await messagesOf(id)).toEqual([])
  expect((await t.query(api.projects.list, {})).map(project => project._id)).toEqual([otherId])
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect({ project: await t.run(ctx => ctx.db.get(otherId)), messages: await messagesOf(otherId), attempts: await attemptsOf(otherId) }).toEqual(otherBefore)
})

test('deleting the last project never re-seeds the demo projects', async () => {
  await remove()
  expect(await t.run(ctx => ctx.db.query('projects').collect())).toEqual([])
  expect(await t.query(api.projects.hasAny, {})).toBe(true)
  expect(await t.mutation(api.projects.seedDemos, { projects: [{ name: 'Must not seed', color: 'red', data: {}, updatedAt: 1 }] })).toBe(0)
  // A second deletion adds no duplicate marker.
  id = await create()
  await remove()
  expect(await t.run(ctx => ctx.db.query('appState').collect())).toHaveLength(1)
})

test('recent chat attempts keep counting toward the hourly AI budget, then are purged', async () => {
  await ask(id)
  await remove()
  expect(await attemptsOf(id)).toHaveLength(1)
  vi.advanceTimersByTime(30 * 60_000)
  await t.finishInProgressScheduledFunctions()
  expect(await attemptsOf(id)).toHaveLength(1)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await attemptsOf(id)).toEqual([])
})

test('large chat histories are deleted in bounded batches', async () => {
  await t.run(async ctx => {
    for (let index = 0; index < 450; index++) await ctx.db.insert('chatMessages', {
      projectId: id, role: 'user', content: 'Message ' + index, status: 'complete', createdAt: index,
    })
  })
  await remove()
  expect(await raw()).toBeNull()
  expect(await messagesOf(id)).toHaveLength(250)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await messagesOf(id)).toEqual([])
})

test('only the manager can delete; a repeated delete is a harmless no-op', async () => {
  const before = await raw()
  for (const badKey of ['', id, otherKey]) await expect(t.mutation(api.projects.remove, { id, key: badKey, permanent: true })).rejects.toThrow('Management access')
  expect(await raw()).toEqual(before)
  await remove()
  expect(await raw()).toBeNull()
  await remove()
  await t.mutation(api.projects.remove, { id, key: otherKey, permanent: true })
  expect(await t.query(api.projects.hasAny, {})).toBe(true)
})

test('an outdated page that still promises Undo can never delete; it is told to update', async () => {
  await ask(id, 'Keep me')
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  const before = { project: await raw(), messages: await messagesOf(id), attempts: await attemptsOf(id) }
  // Exactly what the confirm-and-undo version sends: the current name, version and lifecycle, owner's key.
  const legacy = { id, key, expectedName: before.project!.name, expectedVersion: before.project!.version, expectedLifecycle: 0 }
  await expect(t.mutation(api.projects.remove, legacy)).rejects.toThrow('Refresh RemixRelay')
  await expect(t.mutation(api.projects.remove, { id, key })).rejects.toThrow('Nothing was deleted')
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect({ project: await raw(), messages: await messagesOf(id), attempts: await attemptsOf(id) }).toEqual(before)
  expect(await t.run(ctx => ctx.db.query('appState').collect())).toEqual([])
})

test('a deleted project rejects queued saves, chat sends, retries and late AI results', async () => {
  await ask(id, 'Question', 'question-12345')
  const reply = (await t.query(api.chat.list, { projectId: id })).at(-1)!
  expect(await t.mutation(internal.chat.claim, { replyId: reply._id, attempt: 1 })).toBe(true)
  await remove()
  await expect(save()).rejects.toThrow('PROJECT_UNAVAILABLE')
  await expect(t.mutation(internal.projects.saveFromServer, { id, source: 'old assistant', fields: { bpm: 240 } })).rejects.toThrow('PROJECT_UNAVAILABLE')
  await expect(ask(id, 'New', 'question-67890')).rejects.toThrow('no longer exists')
  await expect(t.mutation(api.chat.retry, { replyId: reply._id })).rejects.toThrow()
  expect(await t.query(internal.chat.forReply, { replyId: reply._id, attempt: 1 })).toBeNull()
  await t.mutation(internal.chat.finish, { replyId: reply._id, attempt: 1, status: 'complete', content: 'Late paid answer' })
  expect(await messagesOf(id)).toEqual([])
  expect(await raw()).toBeNull()
})

test('an unclaimed scheduled reply never starts a provider request after deletion', async () => {
  vi.stubEnv('AI_SERVICE_URL', 'https://preview.vercel.app/api/ai')
  vi.stubEnv('AI_SERVICE_TOKEN', 'test-only-service-token-abcdefghijklmnopqrstuvwxyz')
  await ask(id, 'Queued request')
  const reply = (await t.query(api.chat.list, { projectId: id })).at(-1)!
  await remove()
  expect(await t.mutation(internal.chat.claim, { replyId: reply._id, attempt: 1 })).toBe(false)
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(fetch).not.toHaveBeenCalled()
})

test('projects soft-deleted before permanent deletion are never purged and stay restorable', async () => {
  const oldId = await legacyTombstone()
  await t.run(ctx => ctx.db.insert('chatMessages', { projectId: oldId, role: 'user', content: 'Old chat', status: 'complete', createdAt: 1 }))
  const before = await t.run(ctx => ctx.db.get(oldId))
  await expect(remove(oldId)).rejects.toThrow('PROJECT_UNAVAILABLE')
  expect(await t.run(ctx => ctx.db.get(oldId))).toEqual(before)
  expect(await messagesOf(oldId)).toHaveLength(1)
  // Deleting a different project leaves the tombstone and its chat alone too.
  await remove()
  await t.finishAllScheduledFunctions(vi.runAllTimers)
  expect(await t.run(ctx => ctx.db.get(oldId))).toEqual(before)
  await t.mutation(api.projects.restore, { id: oldId, key, expectedLifecycle: 1 })
  expect((await t.query(api.projects.get, { id: oldId }))!.data).toEqual(music)
  expect(await t.query(api.chat.list, { projectId: oldId })).toHaveLength(1)
})

test('active list remains correct with more than 200 newer tombstones', async () => {
  await t.run(async ctx => {
    for (let index = 0; index < 205; index++) await ctx.db.insert('projects', {
      name: 'Deleted', color: 'red', data: {}, version: 1, updatedAt: Date.now() + index, deletedAt: Date.now(), lifecycle: 1,
    })
  })
  expect((await t.query(api.projects.list, {})).map(project => project._id)).toEqual([id])
  expect(await t.query(api.projects.get, { id: 'invalid-link' })).toBeNull()
})
