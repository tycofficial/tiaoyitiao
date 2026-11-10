'use strict';
// Small independent 2x2: desktop recording on/off x desktop kept/closed before mobile.
// The keep/close factor is applied after desktop inputs, so it cannot explain those inputs.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),assert=require('node:assert/strict');
const {attach,processInfo,helperSha256}=require('./qa-telemetry.cjs');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-resource-diagnostic'),url=process.env.QA_URL||'http://127.0.0.1:4173/';fs.mkdirSync(output,{recursive:true});
const sha=data=>crypto.createHash('sha256').update(data).digest('hex'),productSha256=sha(fs.readFileSync(path.join(root,'index.html'))),scriptSha256=sha(fs.readFileSync(__filename));
const clock=()=>({wallMs:Date.now(),monotonicMs:performance.now()});
async function httpProbe(){const start=clock();try{const response=await fetch(url,{signal:AbortSignal.timeout(5000)}),body=Buffer.from(await response.arrayBuffer());return {start,end:clock(),status:response.status,bytes:body.length,sha256:sha(body)};}catch(error){return {start,end:clock(),error:String(error)};}}
async function settled(page){await page.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return s.mode==='play'&&!s.flight&&s.status==='stop';},{},{timeout:15000});}
async function reset(page){await page.locator('#menu-button').click();await page.locator('#restart-button').click();await settled(page);await page.locator('#game').focus();}
async function run(condition,index){
 const name=`${index}-video-${Number(condition.video)}-keep-${Number(condition.keep)}`,dir=path.join(output,name);fs.mkdirSync(dir,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),result={name,condition,start:clock(),inputs:[],httpBefore:await httpProbe()};let desktop,mobile,deskProbe,mobileProbe;
 try{
  result.browser=browser.version();result.cpuStart=await processInfo(browser);
  desktop=await browser.newContext({viewport:{width:414,height:736},deviceScaleFactor:1,...(condition.video?{recordVideo:{dir,size:{width:414,height:736}}}:{})});const page=await desktop.newPage();deskProbe=await attach(page,'desktop');
  await deskProbe.goto(url);await deskProbe.ready();await page.reload();await deskProbe.ready();await page.locator('#home-skin').click();await page.locator('#skin-back').click();await page.locator('#start').click();await settled(page);
  for(const sample of [{seconds:.05,pointer:true},{seconds:.05,pointer:true},{seconds:.72,pointer:false}]){
   await reset(page);const before=await page.evaluate(()=>jumpDiagnostics.snapshot()),row={requestedMs:sample.seconds*1000,pointer:sample.pointer};result.inputs.push(row);
   try{const input=await deskProbe.press(sample.seconds,{pointer:sample.pointer});row.input=input.record;await settled(page);const after=await page.evaluate(()=>jumpDiagnostics.snapshot());row.after={score:after.score,jumps:after.jumps,status:after.status,mode:after.mode};
    if(sample.pointer){assert.equal(input.record.consumedHoldMs!==undefined,true);assert.equal(input.record.events.find(e=>e.phase==='after-handler'&&e.type==='pointerup').hit,2,'Short input must actually land on its current platform');assert.equal(after.jumps,before.jumps);assert.equal(after.score,before.score);}else assert.equal(after.jumps,before.jumps+1,'Manual jump must reach the next platform');row.passed=true;
   }catch(error){row.passed=false;row.error=String(error);}
  }
  await page.setViewportSize({width:1440,height:900});await page.locator('#home-button').click();result.desktopBeforeMobile=await deskProbe.collect();result.cpuBeforeMobile=await processInfo(browser);
  if(!condition.keep){const start=clock();await desktop.close();result.desktopClose={start,end:clock()};}
  mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const touch=await mobile.newPage();mobileProbe=await attach(touch,'mobile');
  const navigation=mobileProbe.goto(url).then(()=>({passed:true}),error=>({passed:false,error:String(error)}));result.httpDuringMobile=await httpProbe();result.mobileNavigation=await navigation;
  if(result.mobileNavigation.passed){await mobileProbe.ready();await touch.locator('#start').tap();await settled(touch);await mobileProbe.press(2.2,{touch:true,x:195,y:600});await settled(touch);const state=await touch.evaluate(()=>jumpDiagnostics.snapshot());assert.equal(state.mode,'play');assert.equal(state.score,0);assert.ok(Math.abs(state.bottle.position[0])<1e-7);result.mobileTouchPassed=true;}
  result.mobile=await mobileProbe.collect();if(condition.keep)result.desktopDuringMobile=await deskProbe.collect();result.cpuAfterMobile=await processInfo(browser);
  result.passed=result.inputs.every(r=>r.passed)&&result.mobileNavigation.passed&&result.mobileTouchPassed&&!result.mobile.errors.length&&!result.desktopBeforeMobile.errors.length;
 }catch(error){result.passed=false;result.error=String(error);if(mobileProbe)result.mobile=await mobileProbe.collect();if(deskProbe&&!result.desktopBeforeMobile)result.desktopBeforeMobile=await deskProbe.collect();}
 finally{if(mobile)await mobile.close();if(desktop)await desktop.close();await browser.close();result.end=clock();fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2));}
 console.log(JSON.stringify({name,passed:result.passed,holds:result.inputs.map(r=>({requested:r.requestedMs,actual:r.input?.consumedHoldMs,passed:r.passed})),mobileNavigation:result.mobileNavigation,error:result.error}));return result;
}
(async()=>{
 const conditions=[{video:false,keep:false},{video:true,keep:true},{video:false,keep:true},{video:true,keep:false}],results=[];
 for(const [index,condition]of conditions.entries())results.push(await run(condition,index+1));
 assert.equal(sha(fs.readFileSync(path.join(root,'index.html'))),productSha256,'Product changed during diagnosis');
 const report={passed:results.every(r=>r.passed),productSha256,scriptSha256,helperSha256,node:process.version,parallelism:os.availableParallelism(),cpuQuota:fs.existsSync('/sys/fs/cgroup/cpu.max')?fs.readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim():null,loadAverage:os.loadavg(),design:'One independent browser per cell; two 50 ms pointer inputs and one 720 ms keyboard input before the keep/close factor. Mobile goto remains 30000 ms. Recording changes only desktop video. N=1 per load cell; no causal or statistical claim from passes alone.',results};
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,output,productSha256}));if(!report.passed)process.exitCode=1;
})();
