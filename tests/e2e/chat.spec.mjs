import { test, expect } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

test('Convex chat persists, shares, reconnects, rejects duplicates and isolates projects', async ({ page, browser }, info) => {
  test.skip(!info.config.metadata.syncOrigin, 'Requires the disposable local Convex fixture.')
  test.setTimeout(60000)
  const origin = info.config.metadata.syncOrigin
  const convex = new ConvexHttpClient(process.env.REMIXRELAY_E2E_CONVEX_URL)
  const cloud = /https?:\/\/[^/]*\.convex\.(cloud|site)\//
  await page.route(cloud, route => route.abort())
  await page.goto(origin)
  await page.getByRole('button', { name: 'New project', exact: true }).click()
  await expect(page.getByLabel('Open AI chat')).toBeVisible()
  const projectUrl = page.url()
  const projectId = new URL(projectUrl).searchParams.get('project')
  const list = () => convex.query(anyApi.chat.list, { projectId })
  const open = async p => {
    await p.getByLabel('Open AI chat').click()
    await expect(p.getByText('Loading the conversation...')).toHaveCount(0)
  }
  const panel = p => p.getByRole('region', { name: 'AI chat' })
  const second = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await second.route(cloud, route => route.abort())
  const peer = await second.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  peer.on('pageerror', error => errors.push(error.message))
  try {
    await open(page)
    await page.getByLabel('Message Claude').fill('Hello from the first browser')
    // Two submissions in one event turn must keep the same request and question.
    await page.getByLabel('Message Claude').evaluate(el => {
      el.form.requestSubmit()
      el.form.requestSubmit()
    })
    await expect(panel(page)).toContainText("isn't set up on this server yet")
    expect(await list()).toHaveLength(2)
    await peer.goto(projectUrl)
    await open(peer)
    await expect(panel(peer)).toContainText('Hello from the first browser')
    await expect(panel(peer)).toContainText("isn't set up on this server yet")
    await page.reload()
    await open(page)
    await expect(panel(page)).toContainText('Hello from the first browser')

    const failed = (await list()).at(-1)
    await panel(page).getByRole('button', { name: 'Retry', exact: true }).click()
    await expect(panel(page)).toContainText("isn't set up on this server yet")
    expect((await list()).at(-1)._id).toBe(failed._id)
    expect(await list()).toHaveLength(2)

    await page.getByLabel('Message Claude').fill('x'.repeat(2001))
    await page.getByLabel('Message Claude').press('Enter')
    await expect(page.getByLabel('Send message')).toBeDisabled()
    expect(await list()).toHaveLength(2)

    // The retried reply can still be pending here (the Retry check above also matches the earlier,
    // identical error). The chat correctly refuses a new question until it finishes, so wait for that.
    await page.getByLabel('Message Claude').fill('Reconnect without duplicating me')
    await expect(page.getByLabel('Send message')).toBeEnabled()
    await page.context().setOffline(true)
    await page.getByLabel('Message Claude').press('Enter')
    await page.context().setOffline(false)
    await expect(panel(peer)).toContainText('Reconnect without duplicating me')
    await expect.poll(async () => (await list()).at(-1).status).toBe('error')
    expect((await list()).filter(m => m.role === 'user')).toHaveLength(2)

    const requestId = crypto.randomUUID()
    const sends = await Promise.all(Array.from({ length: 4 }, () => convex.mutation(anyApi.chat.send, {
      projectId, requestId, content: 'One concurrent question',
    })))
    expect(new Set(sends.map(result => result.messageId)).size).toBe(1)
    await expect.poll(async () => (await list()).at(-1).status).toBe('error')
    expect((await list()).filter(m => m.content === 'One concurrent question')).toHaveLength(1)

    await peer.getByLabel('Close AI chat').click()
    await peer.getByRole('button', { name: 'Home', exact: true }).click()
    await peer.getByRole('button', { name: 'New project', exact: true }).click()
    await open(peer)
    await expect(panel(peer)).toContainText('Ask Claude about this song')
    await expect(panel(peer)).not.toContainText('One concurrent question')
    expect(errors).toEqual([])
  } finally {
    await second.close()
  }
})
