import {test,expect} from '@playwright/test'

test.beforeEach(async({page})=>{
 await page.route(/https?:\/\/[^/]*\.convex\.(cloud|site)\//,route=>route.abort())
})

test('browser audio: all existing runtime checks pass with real Web Audio',async({page})=>{
 test.setTimeout(60000)
 await page.goto('/tests/audio-runtime.html')
 await page.getByRole('button',{name:'Run audio checks',exact:true}).click()
 await expect(page.locator('#results')).toContainText('ALL AUDIO RUNTIME CHECKS PASSED',{timeout:45000})
 await expect(page.locator('#results')).not.toContainText('FAIL')
 console.log(await page.locator('#results').innerText())
})

test('one mounted studio owns one audio context; Play, BPM, mute, Stop and switching projects work',async({page})=>{
 await page.addInitScript(()=>{
  const Native=window.AudioContext
  window.__contexts=[]
  window.AudioContext=class extends Native{constructor(...args){super(...args);window.__contexts.push(this)}}
 })
 await page.goto('/')
 await page.getByRole('button',{name:/Trap Heat/}).click()
 const live=()=>page.evaluate(()=>window.__contexts.filter(c=>c.state!=='closed').length)
 const baseline=await live()
 await page.getByRole('button',{name:'Pattern playback mode',exact:true}).click()
 await page.getByRole('button',{name:'Play',exact:true}).click()
 await expect(page.locator('footer')).toContainText('AUDIO: PLAYING')
 const playing=await live()
 expect(playing).toBeGreaterThan(baseline)
 await page.getByRole('button',{name:'Play',exact:true}).click()
 expect(await live()).toBe(playing)
 await page.getByLabel('Tempo BPM').fill('180');await page.getByLabel('Tempo BPM').press('Enter')
 await page.getByRole('button',{name:'Metronome',exact:true}).click()
 await expect(page.getByRole('button',{name:'Metronome',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.getByRole('button',{name:'Channel Rack',exact:true}).click()
 await page.getByRole('button',{name:'Mute Kick 808',exact:true}).click()
 await expect(page.getByRole('alert')).toHaveCount(0)
 expect(await live()).toBe(playing)
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await expect(page.locator('footer')).toContainText('AUDIO: STOPPED')
 await page.getByRole('button',{name:'Home',exact:true}).click()
 await expect.poll(live).toBe(baseline)
 await page.getByRole('button',{name:'New project',exact:true}).click()
 expect(await live()).toBe(baseline)
})

test('audio note release stays on the audio clock through a blocked JavaScript thread',async({page})=>{
 await page.goto('/tests/audio-runtime.html')
 const result=await page.evaluate(async()=>{
  const {Tone}=await import('/tests/e2e/audio-fixture.mjs')
  const {VoicePool}=await import('/src/audio/voicePool.ts')
  const context=new Tone.Context()
  await context.resume()
  const voice=new Tone.Synth({context,envelope:{attack:0.005,decay:0.02,sustain:0.5,release:0.04}}).connect(context.destination)
  const synth=new VoicePool(()=>voice,0.04)
  try{
   synth.prepare(1)
   const time=context.now()
   synth.triggerAttackRelease('C4',0.04,time,0.8)
   const end=performance.now()+400;while(performance.now()<end){}
   return {level:voice.envelope.getValueAtTime(context.currentTime),stats:{allocated:synth.size,dropped:synth.dropped},time:context.currentTime}
  }finally{synth.dispose();context.dispose()}
 })
 expect(result.level).toBe(0)
 expect(result.time).toBeGreaterThan(0.2)
 expect(result.stats).toEqual({allocated:1,dropped:0})
})

test('64 real Chrome loop repetitions keep schedules, voices and output stable through live updates',async({page})=>{
 test.setTimeout(100000)
 await page.goto('/tests/audio-runtime.html')
 await page.evaluate(async()=>{
  const {AudioEngine,createDemoPattern}=await import('/src/audio/index.ts')
  const button=document.createElement('button');button.textContent='Run loop verification';document.body.append(button)
  window.__soak=null
  button.onclick=async()=>{
   const pattern=createDemoPattern();pattern.bpm=240
   const engine=new AudioEngine(pattern)
   let timer
   try{
    await engine.play()
    const context=engine.context
    const analyser=context.createAnalyser();analyser.fftSize=2048;engine.master.connect(analyser)
    const output=context.createAnalyser();output.fftSize=2048;engine.guard.output.connect(output)
    const samples=new Float32Array(2048)
    let loops=0,maximumEvents=0,maximumVoices=0,peak=0
    const early=[],late=[],times=[]
    const ids=[...engine.events]
    const first=engine.instruments.values().next().value
    const play=first.playStep.bind(first)
    first.playStep=(...args)=>{times.push(args[2]);return play(...args)}
    timer=setInterval(()=>{
     analyser.getFloatTimeDomainData(samples)
     const rms=Math.sqrt(samples.reduce((total,value)=>total+value*value,0)/samples.length)
     if(loops>=2&&loops<10)early.push(rms)
     if(loops>=54)late.push(rms)
     output.getFloatTimeDomainData(samples);for(const value of samples)peak=Math.max(peak,Math.abs(value))
    },25)
    await new Promise((resolve,reject)=>{
     context.transport.on('loop',()=>{
      loops++
      try{
       if(engine.events.join()!==ids.join())throw new Error('Transport IDs changed')
       maximumEvents=Math.max(maximumEvents,Object.keys(context.transport._scheduledEvents).length)
       for(const rack of engine.instruments.values()){
        const stats=rack.getVoiceStats?.()
        if(stats){maximumVoices=Math.max(maximumVoices,stats.allocated);if(stats.dropped)throw new Error('Voice dropped')}
       }
       if(loops%8===0){engine.setPattern(engine.getPattern());void engine.play()}
       if(loops===64)resolve()
      }catch(error){reject(error)}
     })
    })
    const average=values=>values.reduce((a,b)=>a+b,0)/values.length
    clearInterval(timer);engine.stop()
    await new Promise(resolve=>setTimeout(resolve,200))
    output.getFloatTimeDomainData(samples)
    const silence=Math.max(...samples.map(Math.abs))
    window.__soak={loops,maximumEvents,maximumVoices,peak,earlyRms:average(early),lateRms:average(late),rmsRatio:average(late)/average(early),onsetsOnGrid:times.slice(1).every((time,index)=>{const steps=(time-times[index])/0.0625;return steps>0&&Math.abs(steps-Math.round(steps))<0.0001}),silence,eventsAfterStop:engine.events.length,racksAfterStop:engine.instruments.size}
    analyser.disconnect();output.disconnect()
   }catch(error){window.__soak={error:String(error)}}
   finally{clearInterval(timer);engine.dispose()}
  }
 })
 await page.getByRole('button',{name:'Run loop verification',exact:true}).click()
 await expect.poll(()=>page.evaluate(()=>Boolean(window.__soak)),{timeout:85000,intervals:[1000]}).toBe(true)
 const result=await page.evaluate(()=>window.__soak)
 console.log('CHROME_SOAK',JSON.stringify(result))
 expect(result.error).toBeUndefined()
 expect(result.loops).toBe(64)
 expect(result.maximumEvents).toBeLessThanOrEqual(6)
 expect(result.maximumVoices).toBeLessThanOrEqual(32)
 expect(result.earlyRms).toBeGreaterThan(0.00001)
 expect(result.lateRms).toBeGreaterThan(0.00001)
 expect(result.rmsRatio).toBeGreaterThan(0.7)
 expect(result.rmsRatio).toBeLessThan(1.3)
 expect(result.onsetsOnGrid).toBe(true)
 expect(result.silence).toBeLessThan(0.000001)
 expect(result.eventsAfterStop).toBe(0)
 expect(result.racksAfterStop).toBe(0)
 expect(Number.isFinite(result.peak)).toBe(true)
 expect(result.peak).toBeLessThan(1)
})

test('standalone audio test page remains playable',async({page})=>{
 await page.goto('/audio-test.html')
 await page.getByRole('button',{name:'Play',exact:true}).click()
 await expect(page.locator('#status')).toContainText('Playing')
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await expect(page.locator('#status')).toContainText('Stopped')
})
