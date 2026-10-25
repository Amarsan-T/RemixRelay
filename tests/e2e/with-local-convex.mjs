import {spawn,spawnSync} from 'node:child_process'
import {cpSync,mkdtempSync,writeFileSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer} from 'node:net'

const root=fileURLToPath(new URL('../../',import.meta.url))
const fixture=mkdtempSync(join(tmpdir(),'remixrelay-browser-test-'))
const freePort=()=>new Promise((resolve,reject)=>{
  const server=createServer()
  server.once('error',reject)
  server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>resolve(port))})
})
const cloudPort=await freePort()
const sitePort=await freePort()
// A fresh directory has no .env.local or cloud project selection. Never run
// this test backend from a developer's configured cloud working directory.
cpSync(join(root,'convex'),join(fixture,'convex'),{recursive:true})
writeFileSync(join(fixture,'package.json'),JSON.stringify({name:'remixrelay-isolated-browser-test',private:true,type:'module',dependencies:{convex:'*'}}))
symlinkSync(join(root,'node_modules'),join(fixture,'node_modules'),process.platform==='win32'?'junction':'dir')
const env={...process.env,CONVEX_AGENT_MODE:'anonymous',CONVEX_DEPLOYMENT:'',CONVEX_DEPLOY_KEY:'',CONVEX_SELF_HOSTED_URL:'',CONVEX_SELF_HOSTED_ADMIN_KEY:'',CONVEX_URL:'',CONVEX_SITE_URL:'',VITE_CONVEX_URL:'',VITE_CONVEX_SITE_URL:''}
const backend=spawn(process.execPath,[join(root,'node_modules/convex/bin/main.js'),'dev','--local-cloud-port',String(cloudPort),'--local-site-port',String(sitePort),'--codegen','disable','--typecheck','disable'],{cwd:fixture,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
let ready=false
const startup=new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Anonymous local Convex startup timed out')),90000)
  for(const stream of [backend.stdout,backend.stderr])stream.on('data',chunk=>{
    const message=String(chunk)
    process.stdout.write(message)
    if(!ready&&/Convex functions ready/.test(message)){ready=true;clearTimeout(timer);resolve()}
  })
  backend.once('error',error=>{clearTimeout(timer);reject(error)})
  backend.once('exit',code=>{clearTimeout(timer);if(!ready)reject(new Error('Local Convex exited before ready: '+code))})
})
try{
  await startup
  console.log('Testing only anonymous Convex at http://127.0.0.1:'+cloudPort)
  const runner=spawn(process.execPath,[join(root,'node_modules/@playwright/test/cli.js'),'test',...process.argv.slice(2)],{cwd:root,env:{...process.env,REMIXRELAY_E2E_CONVEX_URL:'http://127.0.0.1:'+cloudPort},stdio:'inherit'})
  process.exitCode=await new Promise((resolve,reject)=>{runner.once('error',reject);runner.once('exit',code=>resolve(code??1))})
}finally{
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(backend.pid),'/T','/F'],{stdio:'ignore',windowsHide:true})
  else backend.kill('SIGINT')
  // Stop only this test runner's process tree. Data remains in its disposable
  // temp directory; no cloud record is created or imported.
}
