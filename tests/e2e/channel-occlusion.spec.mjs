import {test,expect} from '@playwright/test'

for (const width of [390,639,640,768,1440]) {
  test(`channel controls fully mask scrolled steps on all rows at ${width}px`,async({page})=>{
    test.setTimeout(90000)
    await page.setViewportSize({width,height:1100})
    // Use the local editor; even a misconfigured server cannot access cloud data.
    await page.route(/https?:\/\/[^/]*\.convex\.(cloud|site)\//,route=>route.abort())
    await page.routeWebSocket(/wss?:\/\/[^/]*\.convex\.(cloud|site)\//,socket=>socket.close())
    await page.goto('/')
    await page.getByRole('button',{name:/Trap Heat/}).click()
    await page.getByRole('button',{name:'Channel Rack',exact:true}).click()
    await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'})
    await page.evaluate(()=>document.fonts.ready)
    const grid=page.getByRole('region',{name:'Channel step sequencer'})
    // High-contrast versions of the existing active-pad glow/playhead scale
    // expose any gap in the cover, independent of the selected preset's notes.
    await grid.locator('button[aria-label*=" step "]').evaluateAll(buttons=>buttons.forEach(b=>{
      b.style.background='#00ff00';b.style.boxShadow='0 0 10px #00ff00';b.style.transform='scale(1.05)'
    }))
    const maximum=await grid.evaluate(s=>s.scrollWidth-s.clientWidth)
    for (const requested of [0,200,500,maximum]) {
      await grid.evaluate((s,x)=>{s.scrollLeft=x},requested)
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      const rows=await grid.evaluate(s=>{
        const port=s.getBoundingClientRect()
        const controls=[...s.querySelectorAll('.studio-channel-controls')]
        const radius=parseFloat(getComputedStyle(s.closest('.aero-panel')).borderBottomLeftRadius)
        return controls.map((c,index)=>{
          const r=c.getBoundingClientRect(),row=c.parentElement.getBoundingClientRect(),style=getComputedStyle(c.parentElement)
          // The outer panel's last-row rounded corner is intentionally translucent.
          // Compare the opaque control area, not that antialiased silhouette.
          const inset=index===controls.length-1?radius:0
          const left=Math.ceil(Math.max(r.left+inset,port.left+1)),right=Math.floor(Math.min(r.right,port.right-1))
          return {clip:{x:left,y:Math.ceil(row.top+parseFloat(style.borderTopWidth)),width:right-left,height:Math.floor(row.bottom-parseFloat(style.borderBottomWidth))-Math.ceil(row.top+parseFloat(style.borderTopWidth))},position:getComputedStyle(c).position,left:r.left,portLeft:port.left}
        }).filter(r=>r.clip.width>0)
      })
      expect(rows.length).toBe(width>=640||requested<=200?7:0)
      if(width>=640&&requested>20)for(const row of rows){expect(row.position).toBe('sticky');expect(row.left).toBeCloseTo(row.portLeft,0)}
      const visible=[]
      for(const row of rows)visible.push(await page.screenshot({clip:row.clip,animations:'disabled'}))
      await grid.locator('button[aria-label*=" step "]').evaluateAll(buttons=>buttons.forEach(b=>b.style.visibility='hidden'))
      for(let i=0;i<rows.length;i++){
        const hidden=await page.screenshot({clip:rows[i].clip,animations:'disabled'})
        if(!visible[i].equals(hidden)) {
          await test.info().attach('pads-visible',{body:visible[i],contentType:'image/png'})
          await test.info().attach('pads-hidden',{body:hidden,contentType:'image/png'})
          console.log('OCCLUSION_DIAGNOSTIC',JSON.stringify({row:rows[i],scroll:requested,viewport:width}))
        }
        expect(visible[i].equals(hidden),`steps/glow leaked behind channel ${i+1} at scroll ${requested}`).toBe(true)
      }
      await grid.locator('button[aria-label*=" step "]').evaluateAll(buttons=>buttons.forEach(b=>b.style.visibility=''))
    }
    // Pinned controls and the uncovered grid retain their hit targets.
    await grid.evaluate(s=>{s.scrollLeft=200})
    if(width>=640){
      const accessible=await grid.locator('.studio-channel-controls').evaluateAll(controls=>controls.every(c=>{
        const r=c.getBoundingClientRect(),hit=document.elementFromPoint(r.left+4,r.top+r.height/2)
        return !!hit&&c.contains(hit)
      }))
      expect(accessible).toBe(true)
    }
  })
}
