import { test, expect } from '@playwright/test'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { ConvexHttpClient } from 'convex/browser'
import { anyApi } from 'convex/server'

test('React to local Convex to Python HTTP preserves chat and memory after refresh', async ({ page, browser }, info) => {
  test.setTimeout(90000)
  const fixture=process.env.REMIXRELAY_E2E_FIXTURE
  if(!fixture||!resolve(fixture).startsWith(join(tmpdir(),'remixrelay-browser-test-')))throw new Error('Disposable local Convex required')
  const convexUrl=process.env.REMIXRELAY_E2E_CONVEX_URL
  if(!convexUrl?.startsWith('http://127.0.0.1:'))throw new Error('Cloud mutation forbidden')
  const python=process.env.REMIXRELAY_PYTHON??join(process.cwd(),'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python')
  if(!existsSync(python))throw new Error('Install Python test requirements first')
  const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})})
  const token=randomBytes(32).toString('hex')
  const selection=readFileSync(join(fixture,'.env.local'),'utf8').match(/^CONVEX_DEPLOYMENT=(anonymous:[^\r\n]+)/m)?.[1]
  if(!selection)throw new Error('Refusing non-anonymous fixture')
  const env={...process.env,CONVEX_AGENT_MODE:'anonymous',CONVEX_DEPLOYMENT:selection,CONVEX_DEPLOY_KEY:'',CONVEX_SELF_HOSTED_URL:'',CONVEX_SELF_HOSTED_ADMIN_KEY:''}
  const setting=(command,name,value)=>{
    const result=spawnSync(process.execPath,[join(process.cwd(),'node_modules/convex/bin/main.js'),'env',command,name],{cwd:fixture,env,input:value,encoding:'utf8',windowsHide:true})
    if(result.status!==0)throw new Error('Local fixture configuration failed: '+String(result.stderr).replaceAll(token,'[redacted]').slice(0,1000))
  }
  const child=spawn(python,['-m','uvicorn','gateway_fixture:app','--app-dir','tests/python','--host','127.0.0.1','--port',String(port),'--no-access-log'],{cwd:process.cwd(),env:{...process.env,AI_SERVICE_TOKEN:token,ANTHROPIC_API_KEY:'local-fake-provider-only'},windowsHide:true,stdio:'ignore'})
  const client=new ConvexHttpClient(convexUrl)
  const second=await browser.newContext()
  try{
    const deadline=Date.now()+15000
    while(true){try{if((await fetch('http://127.0.0.1:'+port+'/api/ai')).ok)break}catch{}if(Date.now()>deadline)throw new Error('Python did not start');await new Promise(r=>setTimeout(r,150))}
    setting('set','AI_SERVICE_URL','http://127.0.0.1:'+port+'/api/ai')
    setting('set','AI_SERVICE_TOKEN',token)
    setting('set','AI_SERVICE_ALLOW_LOCAL','1')
    const diagnostic=spawnSync(process.execPath,[join(process.cwd(),'node_modules/convex/bin/main.js'),'run','--inline-query','return { hasUrl:Boolean(process.env.AI_SERVICE_URL), tokenLength:process.env.AI_SERVICE_TOKEN?.length, local:process.env.AI_SERVICE_ALLOW_LOCAL, cloud:process.env.CONVEX_CLOUD_URL };'],{cwd:fixture,env,encoding:'utf8',windowsHide:true})
    console.log('LOCAL_CONFIG_METADATA '+diagnostic.stdout)
    await page.goto(info.config.metadata.syncOrigin)
    await page.getByRole('button',{name:'New project',exact:true}).click()
    await expect(page).toHaveURL(/[?&]project=/)
    const url=page.url()
    const projectId=new URL(url).searchParams.get('project')
    await client.mutation(anyApi.projects.save,{id:projectId,clientId:'python-test',changes:[{path:['bpm'],value:97}]})
    await page.getByLabel('Open AI chat').click()
    const panel=page.getByRole('region',{name:'AI chat'})
    await expect(panel).toContainText('Ask Claude about this song')
    await page.getByLabel('Message Claude').fill('My name is Ada. What is the tempo?')
    await page.getByLabel('Send message').click()
    await expect(panel).toContainText('Ada, the project is at 97 BPM.')
    expect(await client.query(anyApi.chat.list,{projectId})).toHaveLength(2)
    await page.reload()
    await page.getByLabel('Open AI chat').click()
    await expect(panel).toContainText('Ada, the project is at 97 BPM.')
    await client.mutation(anyApi.projects.save,{id:projectId,clientId:'python-test',changes:[{path:['bpm'],value:113}]})
    await page.getByLabel('Message Claude').fill('Remember my name and tell me the new tempo.')
    await page.getByLabel('Send message').click()
    await expect(panel).toContainText('Ada, the project is at 113 BPM.')
    const peer=await second.newPage()
    await peer.goto(url)
    await peer.getByLabel('Open AI chat').click()
    await expect(peer.getByRole('region',{name:'AI chat'})).toContainText('Ada, the project is at 113 BPM.')
    expect(await client.query(anyApi.chat.list,{projectId})).toHaveLength(4)

    // AI coach: the reply's suggestions are highlighted, nothing changes until Apply.
    const project=async()=>(await client.query(anyApi.projects.get,{id:projectId})).data
    const coach=page.getByRole('region',{name:'AI note suggestions'})
    await page.getByLabel('Message Claude').fill('I want a dreamy, relaxing melody.')
    await page.getByLabel('Send message').click()
    await expect(panel).toContainText('Long, soft notes in a major key sound dreamy.')
    await expect(panel).not.toContainText('note-suggestions')
    await expect(panel).toContainText('3 notes to try: Dreamy lead')
    await expect(panel).toContainText("1 more idea didn't fit this song")
    // Highlighted right away in the Piano Roll on the suggested channel.
    await expect(coach).toContainText('0 of 3 done')
    await expect(page.getByRole('tab',{name:/Retro Lead/,selected:true})).toBeVisible()
    await expect(page.getByRole('img',{name:/AI suggestion: Add E4 at step 1 \(4 steps\)/})).toBeVisible()
    await expect(page.getByRole('img',{name:/AI suggestion: Add G4 at step 5/})).toBeVisible()
    expect((await project()).pianoNotes[1]?.synth_lead ?? []).toEqual([])
    await page.screenshot({path:'test-results/browser/coach-piano-roll.png'})
    // Collaborators share the chat but not this browser's highlights.
    await expect(peer.getByRole('region',{name:'AI chat'})).toContainText('3 notes to try')
    await expect(peer.getByRole('region',{name:'AI note suggestions'})).toHaveCount(0)
    // The drum suggestion is in the Channel Rack.
    await coach.getByRole('button',{name:'Show Kick 808 · Pattern 1'}).click()
    await expect(page.getByLabel('Kick 808 step 1',{exact:true})).toHaveAttribute('title',/AI suggestion: Light step 1/)
    await page.screenshot({path:'test-results/browser/coach-channel-rack.png'})
    await coach.getByRole('button',{name:'Apply: Light step 1 on Kick 808'}).click()
    await expect.poll(async()=>(await project()).stepData[1].kick[0]).toBe(1)
    await expect(coach).toContainText('1 of 3 done')
    // Apply all asks first; Cancel changes nothing.
    await coach.getByRole('button',{name:/Apply all \(2\)/}).click()
    await coach.getByRole('button',{name:'Cancel'}).click()
    expect((await project()).pianoNotes[1]?.synth_lead ?? []).toEqual([])
    await coach.getByRole('button',{name:/Apply all \(2\)/}).click()
    await coach.getByRole('button',{name:'Yes, apply'}).click()
    await expect.poll(async()=>((await project()).pianoNotes[1]?.synth_lead ?? []).map(n=>n.note+'@'+n.step).sort()).toEqual(['E4@0','G4@4'])
    await expect(coach).toContainText('All done!')
    // Clearing removes the highlights; the chat can show them again.
    await coach.getByRole('button',{name:'Clear highlights'}).click()
    await expect(coach).toHaveCount(0)
    await panel.getByRole('button',{name:'Show in editor'}).click()
    await expect(coach).toContainText('All done!')
    await panel.getByRole('button',{name:'Hide highlights'}).click()
    await expect(coach).toHaveCount(0)
  }finally{
    await second.close()
    child.kill()
    for(const name of ['AI_SERVICE_URL','AI_SERVICE_TOKEN','AI_SERVICE_ALLOW_LOCAL']){try{setting('remove',name)}catch{/* Disposable fixture; keep original failure. */}}
  }
})
