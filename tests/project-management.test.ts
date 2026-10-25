import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { api, internal } from '../convex/_generated/api'
import schema from '../convex/schema'
import { keyHash } from '../convex/projectAccess'

const modules = import.meta.glob('../convex/**/*.ts')
const key = 'a1'.repeat(32)
const otherKey = 'b2'.repeat(32)
const music = { bpm: 97, stepData: { 1: { kick: [1, 0, 1] } }, pianoNotes: { 1: { synth: [{ pitch: 'C4', step: 2 }] } } }
let t: ReturnType<typeof convexTest>
let id: Awaited<ReturnType<typeof create>>
const create = async (managed = true) => t.mutation(api.projects.create, {
  name: 'Test song', color: '#22d3ee', data: music, ...(managed ? { managementKeyHash: await keyHash(key) } : {}),
})
const raw = () => t.run(ctx => ctx.db.get(id))
const get = () => t.query(api.projects.get, { id })
const remove = async () => {
  const project = (await raw())!
  return t.mutation(api.projects.remove, { id, key, expectedName: project.name, expectedVersion: project.version, expectedLifecycle: project.lifecycle ?? 0 })
}
const restore = async () => t.mutation(api.projects.restore, { id, key, expectedLifecycle: (await raw())!.lifecycle! })
const save = (lifecycle = 0) => t.mutation(api.projects.save, { id, clientId: 'peer', lifecycle, changes: [{ path: ['bpm'], value: 109 }] })

beforeEach(async () => {
  vi.useFakeTimers()
  vi.stubEnv('AI_SERVICE_URL', '')
  vi.stubEnv('AI_SERVICE_TOKEN', '')
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network permitted in project-management tests') }))
  t = convexTest(schema, modules)
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
    await expect(t.mutation(api.projects.remove, { id, key: badKey, expectedName: 'Test song', expectedVersion: 1, expectedLifecycle: 0 })).rejects.toThrow('Management access')
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

test('stale delete confirmation is rejected after music or title changes', async () => {
  await save()
  await expect(t.mutation(api.projects.remove, { id, key, expectedName: 'Test song', expectedVersion: 1, expectedLifecycle: 0 })).rejects.toThrow('project changed')
  await t.mutation(api.projects.rename, { id, key, name: 'Renamed', expectedName: 'Test song' })
  await expect(t.mutation(api.projects.remove, { id, key, expectedName: 'Test song', expectedVersion: 2, expectedLifecycle: 0 })).rejects.toThrow('project changed')
  expect((await raw())!.deletedAt).toBeUndefined()
})

test('delete is recoverable and does not seed or erase music/chat/accounting', async () => {
  await t.mutation(api.chat.send, { projectId: id, content: 'Remember my phrase', requestId: 'remember-12345' })
  const before = await raw()
  const messages = await t.run(ctx => ctx.db.query('chatMessages').collect())
  await remove()
  expect(await get()).toBeNull()
  expect(await t.query(internal.projects.load, { id })).toBeNull()
  expect(await t.query(api.projects.list, {})).toEqual([])
  expect(await t.query(api.projects.hasAny, {})).toBe(true)
  expect(await t.query(api.chat.list, { projectId: id })).toEqual([])
  expect(await t.mutation(api.projects.seedDemos, { projects: [{ name: 'Must not seed', color: 'red', data: {}, updatedAt: 1 }] })).toBe(0)
  expect((await raw())!.data).toEqual(before!.data)
  expect((await raw())!.version).toBe(before!.version)
  expect(await t.run(ctx => ctx.db.query('chatAttempts').collect())).toHaveLength(1)
  const retained = await t.run(ctx => ctx.db.query('chatMessages').collect())
  expect(retained.map(message => message._id)).toEqual(messages.map(message => message._id))
  expect(retained[0].content).toBe('Remember my phrase')
  expect(retained[1].status).toBe('error')
  await restore()
  expect((await get())!.data).toEqual(before!.data)
  expect(await t.query(api.chat.list, { projectId: id })).toHaveLength(2)
})

test('deleted and restored generations reject queued browser and internal saves', async () => {
  await remove()
  await expect(save()).rejects.toThrow('PROJECT_UNAVAILABLE')
  await expect(t.mutation(internal.projects.saveFromServer, { id, source: 'old assistant', fields: { bpm: 240 } })).rejects.toThrow('PROJECT_UNAVAILABLE')
  await restore()
  await expect(save()).rejects.toThrow('PROJECT_UNAVAILABLE')
  await save(2)
  expect((await get())!.data.bpm).toBe(109)
})

test('delete/restore replays are idempotent and cannot affect a newer generation', async () => {
  const args = { id, key, expectedName: 'Test song', expectedVersion: 1, expectedLifecycle: 0 }
  await t.mutation(api.projects.remove, args)
  await t.mutation(api.projects.remove, args)
  await expect(t.mutation(api.projects.restore, { id, key: otherKey, expectedLifecycle: 1 })).rejects.toThrow('Management access')
  await restore()
  await t.mutation(api.projects.restore, { id, key, expectedLifecycle: 1 })
  await expect(t.mutation(api.projects.remove, args)).rejects.toThrow('project changed')
  await remove()
  await expect(t.mutation(api.projects.restore, { id, key, expectedLifecycle: 1 })).rejects.toThrow('out of date')
  expect(await get()).toBeNull()
})

test('deleted project blocks sends/retries and late AI results after Undo', async () => {
  await t.mutation(api.chat.send, { projectId: id, content: 'Question', requestId: 'question-12345' })
  const reply = (await t.query(api.chat.list, { projectId: id })).at(-1)!
  expect(await t.mutation(internal.chat.claim, { replyId: reply._id, attempt: 1 })).toBe(true)
  await remove()
  await expect(t.mutation(api.chat.send, { projectId: id, content: 'New', requestId: 'question-67890' })).rejects.toThrow('no longer exists')
  await expect(t.mutation(api.chat.retry, { replyId: reply._id })).rejects.toThrow('no longer exists')
  expect(await t.query(internal.chat.forReply, { replyId: reply._id, attempt: 1 })).toBeNull()
  await restore()
  await t.mutation(internal.chat.finish, { replyId: reply._id, attempt: 1, status: 'complete', content: 'Late paid answer' })
  expect((await t.query(api.chat.list, { projectId: id })).at(-1)!.status).toBe('error')
  await t.mutation(api.chat.retry, { replyId: reply._id })
  expect(await t.mutation(internal.chat.claim, { replyId: reply._id, attempt: 2 })).toBe(true)
  expect(await t.query(internal.chat.forReply, { replyId: reply._id, attempt: 2 })).not.toBeNull()
  await t.mutation(internal.chat.finish, { replyId: reply._id, attempt: 1, status: 'complete', content: 'Stale generation' })
  expect((await t.query(api.chat.list, { projectId: id })).at(-1)!.status).toBe('pending')
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

test('an unclaimed scheduled reply cannot start a provider request after deletion or Undo', async () => {
  await t.mutation(api.chat.send, { projectId: id, content: 'Queued request', requestId: 'queued-question-12345' })
  const reply = (await t.query(api.chat.list, { projectId: id })).at(-1)!
  await remove()
  await restore()
  expect(await t.mutation(internal.chat.claim, { replyId: reply._id, attempt: 1 })).toBe(false)
  vi.advanceTimersByTime(1)
  await t.finishInProgressScheduledFunctions()
  expect(fetch).not.toHaveBeenCalled()
})

test('the bounded pending-reply guard rolls back deletion without partial data changes', async () => {
  await t.run(async ctx => {
    for (let index = 0; index < 101; index++) await ctx.db.insert('chatMessages', {
      projectId: id, role: 'assistant', content: '', status: 'pending', createdAt: Date.now(), attempt: 1,
    })
  })
  const before = await raw()
  await expect(remove()).rejects.toThrow('operator')
  expect(await raw()).toEqual(before)
  expect(await t.run(async ctx => (await ctx.db.query('chatMessages').collect()).every(message => message.status === 'pending'))).toBe(true)
})
