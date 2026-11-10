'use strict';
// Measures isolated local copies with a read-only observer around the real landing call.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-landing-qa');
const url=process.env.QA_URL||'http://127.0.0.1:4173/';fs.mkdirSync(output,{recursive:true});
function holdFor(distance){
  let lo=0,hi=2;
  for(let i=0;i<32;i++){
    const h=(lo+hi)/2,vy=Math.min(135+h*15,180),y=2.75-.033875*Math.min(99,h*60);
    const a=+((-vy+Math.sqrt(vy*vy-1440*(2.75-+y.toFixed(2))))/-720).toFixed(2);
    const range=+Math.min(h*70,150).toFixed(2)*+(vy/360-a).toFixed(2);
    if(range<distance)lo=h;else hi=h;
  }
  return(lo+hi)/2;
}
function instrument(html){
  const expression=/bottle\.stop\(\);squeezeAt\((?:next|true)\);jumps\+\+/;
  assert.match(html,expression,'Expected one successful landing call');
  return html.replace(expression,original=>{
    const call=original.match(/squeezeAt\([^)]*\);/)[0];
    return `bottle.stop();const contact={hold:f.hold,duration:f.duration,direction:bottle.direction,before:bottle.body.scale.toArray()};${call}contact.after=bottle.body.scale.toArray();(window.__qaContacts??=[]).push(contact);jumps++`;
  });
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const current=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const baseline=execFileSync('git',['show','f70e0181a5645bdf95aab660673ae9408ba9366f:index.html'],{cwd:root,maxBuffer:8*1024*1024}).toString();
  const results=[];
  try{
    for(const [version,source] of [['baseline',baseline],['current',current]]){
      const context=await browser.newContext({viewport:{width:414,height:736}}),page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(String(e)));await page.addInitScript(()=>{Date.now=()=>1234567;});
      await page.route(url,route=>route.fulfill({body:instrument(source),contentType:'text/html'}));
      await page.goto(url);await page.waitForFunction(()=>window.jumpDiagnostics);await page.locator('#start').click();
      const settled=[];
      for(let i=0;i<4;i++){
        await page.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return !s.flight&&s.status==='stop';});
        const state=await page.evaluate(()=>jumpDiagnostics.snapshot()),distance=Math.hypot(state.next.position[0]-state.bottle.position[0],state.next.position[2]-state.bottle.position[2]);
        await page.locator('#game').focus();await page.keyboard.down('Space');await page.waitForTimeout(holdFor(distance)*1000);await page.keyboard.up('Space');
        await page.waitForFunction(count=>(window.__qaContacts?.length||0)>count,i);
        if(i===0)await page.screenshot({path:path.join(output,version+'-contact.png')});
        await page.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return s.bottle.scale.every(v=>Math.abs(v-1)<1e-8);});
        settled.push(await page.evaluate(()=>({score:jumpDiagnostics.snapshot().score,body:jumpDiagnostics.snapshot().bottle.scale})));
      }
      const contacts=await page.evaluate(()=>window.__qaContacts);
      for(const contact of contacts)contact.instantScaleChange=Math.max(...contact.before.map((v,i)=>Math.abs(v-contact.after[i])));
      if(version==='baseline')assert.ok(contacts[0].instantScaleChange>.05,'Must reproduce the contact snap');
      else assert.ok(contacts.every(c=>c.instantScaleChange<1e-8),'Successful contacts must preserve scale');
      assert.deepEqual(errors,[]);results.push({version,productSha256:crypto.createHash('sha256').update(source).digest('hex'),instrumentedLocalObserver:true,contacts,settled,errors});
      await context.close();
    }
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,results},null,2));console.log(JSON.stringify({passed:true,results},null,2));
  }finally{await browser.close();}
})();
