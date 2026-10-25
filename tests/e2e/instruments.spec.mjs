import {test,expect} from '@playwright/test'

test('every synthesized instrument preset produces finite audio and disposes its voices',async({page})=>{
 test.setTimeout(25000)
 await page.goto('/tests/audio-runtime.html')
 await page.getByRole('heading').click()
 const results=await page.evaluate(async()=>{
  const {AudioEngine,createDemoPattern}=await import('/src/audio/index.ts')
  const {SOUND_PRESETS}=await import('/src/audio/soundPresets.ts')
  const results=[]
  for(const preset of SOUND_PRESETS.filter(p=>p.id!=='grand-piano')){
   const track={id:'probe',name:preset.name,type:preset.bass?'bass':'melody',muted:false,volumeDb:-16,sound:preset.id,steps:[{step:0,notes:[{pitch:preset.bass?'C2':'C4',durationSteps:4,velocity:0.6}]}]}
   const engine=new AudioEngine({...createDemoPattern(),bpm:240,tracks:[track]})
   try{
    await engine.play()
    const context=engine.context,analyser=context.createAnalyser()
    analyser.fftSize=2048;engine.limiter.connect(analyser)
    const samples=new Float32Array(2048)
    let peak=0,finite=true
    const end=performance.now()+750
    while(performance.now()<end){analyser.getFloatTimeDomainData(samples);for(const value of samples){finite&&=Number.isFinite(value);peak=Math.max(peak,Math.abs(value))}await new Promise(resolve=>setTimeout(resolve,15))}
    const stats=engine.instruments.get('probe').getVoiceStats()
    engine.stop()
    results.push({name:preset.name,peak,finite,stats,racksAfterStop:engine.instruments.size,eventsAfterStop:engine.events.length})
    analyser.disconnect()
   }finally{engine.dispose()}
  }
  return results
 })
 console.log('SYNTH_PRESETS',JSON.stringify(results))
 expect(results).toHaveLength(5)
 for(const result of results){
  expect(result.peak,result.name).toBeGreaterThan(0.00001)
  expect(result.finite,result.name).toBe(true)
  expect(result.stats.dropped,result.name).toBe(0)
  expect(result.stats.allocated,result.name).toBeLessThanOrEqual(32)
  expect(result.racksAfterStop,result.name).toBe(0)
  expect(result.eventsAfterStop,result.name).toBe(0)
 }
})
