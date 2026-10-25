import {defineConfig} from '@playwright/test'

const port=Number(process.env.REMIXRELAY_E2E_PORT ?? 5285)
const convex=process.env.REMIXRELAY_E2E_CONVEX_URL ?? ''
if(convex){
  const url=new URL(convex)
  if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)
    throw new Error('Browser tests require an anonymous loopback Convex backend.')
}
const server=(serverPort,url)=>({
  command:'node tests/e2e/serve.mjs '+serverPort,
  url:'http://127.0.0.1:'+serverPort,
  env:{VITE_CONVEX_URL:url},
  reuseExistingServer:false,
})
export default defineConfig({
  testDir:'./tests/e2e',
  testMatch:'**/*.spec.mjs',
  workers:1,
  fullyParallel:false,
  timeout:30000,
  expect:{timeout:8000},
  reporter:'list',
  outputDir:'test-results',
  // This Windows runner has no working physical audio sink. Chromium's fake
  // output keeps its real Web Audio DSP/clock running without speaker access.
  use:{channel:'chrome',headless:true,launchOptions:{args:['--disable-audio-output']},baseURL:'http://127.0.0.1:'+port,viewport:{width:1440,height:1000},trace:'retain-on-failure',screenshot:'only-on-failure'},
  metadata:{syncOrigin:convex?'http://127.0.0.1:'+(port+1):null},
  webServer:[server(port,''),...(convex?[server(port+1,convex)]:[])],
})
