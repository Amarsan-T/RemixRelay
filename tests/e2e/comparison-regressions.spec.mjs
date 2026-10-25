import {test,expect} from '@playwright/test'

test('a stopped wet master bus cannot return during a stalled quick restart',async({page})=>{
 await page.goto('/tests/audio-runtime.html')
 await page.getByRole('heading').click()
 const result=await page.evaluate(async()=>{
  const {AudioEngine}=await import('/src/audio/AudioEngine.ts')
  const base={bpm:240,loop:true,master:{effects:{delay:0.8}},tracks:[{id:'note',name:'Note',type:'melody',muted:false,volumeDb:-16,steps:[{step:0,notes:[{pitch:'C4',durationSteps:16,velocity:0.6}]}]}]}
  const engine=new AudioEngine(base)
  try{
   await engine.play()
   const context=engine.context,analyser=context.createAnalyser();analyser.fftSize=2048;engine.guard.output.connect(analyser)
   await new Promise(resolve=>setTimeout(resolve,650))
   engine.stop()
   engine.setPattern({...base,tracks:[{...base.tracks[0],steps:[]}]})
   await engine.play()
   const end=performance.now()+400;while(performance.now()<end){}
   const samples=new Float32Array(2048);analyser.getFloatTimeDomainData(samples)
   const result={peak:Math.max(...samples.map(Math.abs)),retiring:engine.retiring.size}
   analyser.disconnect()
   return result
  }finally{engine.dispose()}
 })
 expect(result.retiring).toBeGreaterThan(0)
 expect(result.peak).toBeLessThan(0.000001)
})

test('cold Warm Pad prepares cross-loop release overlap without allocating inside playback',async({page})=>{
 await page.goto('/tests/audio-runtime.html')
 await page.getByRole('heading').click()
 const result=await page.evaluate(async()=>{
  const {AudioEngine}=await import('/src/audio/AudioEngine.ts')
  const {VoicePool}=await import('/src/audio/voicePool.ts')
  const original=VoicePool.prototype.triggerAttackRelease
  let allocatedDuringPlayback=0
  VoicePool.prototype.triggerAttackRelease=function(...args){const before=this.size;const result=original.apply(this,args);allocatedDuringPlayback+=this.size-before;return result}
  const engine=new AudioEngine({bpm:240,loop:true,tracks:[{id:'pad',name:'Pad',type:'melody',sound:'warm-pad',muted:false,volumeDb:-16,steps:[{step:0,notes:[{pitch:'C4',durationSteps:16,velocity:0.5}]}]}]})
  try{
   await engine.play()
   const prepared=engine.instruments.get('pad').getVoiceStats()
   await new Promise(resolve=>{let loops=0;engine.context.transport.on('loop',()=>{if(++loops===4)resolve()})})
   return {prepared,after:engine.instruments.get('pad').getVoiceStats(),allocatedDuringPlayback}
  }finally{engine.dispose();VoicePool.prototype.triggerAttackRelease=original}
 })
 expect(result.prepared.allocated).toBe(3)
 expect(result.after).toEqual(result.prepared)
 expect(result.after.dropped).toBe(0)
 expect(result.allocatedDuringPlayback).toBe(0)
})



test('three 700ms stalls recover without replaying a backlog or hanging cleanup',async({page})=>{
 test.setTimeout(20000)
 await page.goto('/tests/audio-runtime.html')
 await page.getByRole('heading').click()
 const result=await page.evaluate(async()=>{
  const {AudioEngine}=await import('/src/audio/AudioEngine.ts')
  const {createStudioProject}=await import('/src/studio/data.ts')
  const {toAudioPattern}=await import('/src/studio/patternAdapter.ts')
  const project=createStudioProject('Trap Heat');project.bpm=240;project.patternSteps={1:16}
  const engine=new AudioEngine(toAudioPattern(project,1))
  const warnings=[];const warn=console.warn
  console.warn=(...args)=>warnings.push(args.map(value=>value?.message??String(value)).join(' '))
  try{
   await engine.play();const ids=engine.events.join()
   for(let cycle=0;cycle<3;cycle++){await new Promise(resolve=>setTimeout(resolve,200));const end=performance.now()+700;while(performance.now()<end){}}
   await new Promise(resolve=>setTimeout(resolve,200))
   const playing=engine.getState().status
   const stableSchedules=ids===engine.events.join()
   engine.stop();await new Promise(resolve=>setTimeout(resolve,200))
   return {warnings,playing,stableSchedules,events:engine.events.length,racks:engine.instruments.size,retiring:engine.retiring.size}
  }finally{engine.dispose();console.warn=warn}
 })
 expect(result).toEqual({warnings:[],playing:'playing',stableSchedules:true,events:0,racks:0,retiring:0})
})
