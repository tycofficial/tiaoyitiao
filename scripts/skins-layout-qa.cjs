'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-skins-layout-qa');
const url=process.env.QA_URL||'http://127.0.0.1:4173/';fs.mkdirSync(output,{recursive:true});
async function measure(page){return page.evaluate(()=>{
  const bounds=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
  const panel=document.querySelector('#skins .panel'),grid=panel.querySelector('.skin-grid');
  return {heading:bounds(panel.querySelector('h2')),capsule:bounds(document.getElementById('capsule')),dpr:devicePixelRatio,fonts:document.fonts.status,stage:bounds(document.getElementById('stage')),panel:{...bounds(panel),scrollTop:panel.scrollTop,clientWidth:panel.clientWidth,scrollWidth:panel.scrollWidth,clientHeight:panel.clientHeight,scrollHeight:panel.scrollHeight},columns:getComputedStyle(grid).gridTemplateColumns.split(' ').filter(track=>parseFloat(track)>0).length,
    cards:[...grid.children].map(e=>({id:e.id,card:bounds(e),image:bounds(e.querySelector('img')),label:bounds(e.querySelector('span')),status:bounds(e.querySelector('small')),selected:e.getAttribute('aria-pressed'),disabled:e.disabled})),paused:jumpDiagnostics.snapshot().paused,skin:jumpDiagnostics.snapshot().skin};
});}
function headingClear(r){return r.heading.height<=40&&!(r.heading.left<r.capsule.right&&r.heading.right>r.capsule.left&&r.heading.top<r.capsule.bottom&&r.heading.bottom>r.capsule.top);}
function fits(r){return r.cards.every(c=>[c.image,c.label,c.status].every(e=>e.left>=c.card.left-.01&&e.right<=c.card.right+.01))&&r.panel.scrollWidth<=r.panel.clientWidth+1;}
async function painted(page){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const results=[],errors=[],current=fs.readFileSync(path.join(root,'index.html'),'utf8');
  try{
    const baseline=execFileSync('git',['show','7e6c827813d0ae1fb26a72bcce1f8df34de97614:index.html'],{cwd:root,maxBuffer:8*1024*1024}).toString();
    const oldContext=await browser.newContext({viewport:{width:320,height:240}}),old=await oldContext.newPage();
    await old.route(url,r=>r.fulfill({body:baseline,contentType:'text/html'}));await old.goto(url);await old.waitForFunction(()=>window.jumpDiagnostics);await old.locator('#home-skin').click();await painted(old);
    const overflow=await measure(old);assert.equal(fits(overflow),false,'Must reproduce card overflow');
    await old.locator('#skins .panel').evaluate(e=>{e.scrollTop=e.scrollHeight;});await old.locator('#skin-back').click();await old.locator('#home-skin').click();
    const reopened=await measure(old);assert.ok(reopened.panel.scrollTop>0,'Must reproduce stale scroll position');
    await old.screenshot({path:path.join(output,'baseline-reopened.png')});results.push({version:'baseline',overflow,reopened});await oldContext.close();
    for(const dpr of [1,2,3]){
      const context=await browser.newContext({viewport:{width:414,height:736},deviceScaleFactor:dpr}),page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
      await page.goto(url);await page.waitForFunction(()=>window.jumpDiagnostics);await page.locator('#home-skin').click();
      const sizes=dpr===1?[[414,736],[320,568],[240,320],[320,240],[640,240],[320,200],[200,320]]:[[414,736],[320,240],[320,200]];
      for(const [width,height]of sizes){
        await page.setViewportSize({width,height});await painted(page);const r=await measure(page);
        assert.ok(fits(r),`Card overflow at ${width}x${height}, DPR ${dpr}`);assert.ok(headingClear(r),'Heading overlaps the capsule or wraps');if(height<=320)assert.ok(r.panel.top>=r.capsule.bottom+5,'Panel must clear the capsule');assert.equal(r.paused,true);assert.equal(r.cards.filter(c=>c.selected==='true').length,1);
        assert.equal(r.skin.selected,'classic');if(width>=320&&height>=568)assert.equal(r.columns,2,'Normal size must match the historical two columns');
        results.push({version:'current',viewport:{width,height},...r});
        if(dpr===1&&height<=240)await page.screenshot({path:path.join(output,`current-${width}x${height}.png`)});
      }
      await page.setViewportSize({width:320,height:240});await painted(page);const panel=page.locator('#skins .panel');await panel.hover();await page.mouse.wheel(0,1500);
      await page.waitForFunction(()=>document.querySelector('#skins .panel').scrollTop>0);await page.locator('#skin-back').click();await page.locator('#home-skin').click();await painted(page);
      const reopened=await measure(page);assert.equal(reopened.panel.scrollTop,0);assert.ok(fits(reopened));
      if(dpr===1)await page.screenshot({path:path.join(output,'current-reopened.png')});results.push({version:'current',action:'scroll-close-reopen',...reopened});
      if(dpr===1){
        await page.setViewportSize({width:320,height:200});await painted(page);await panel.hover();await page.mouse.wheel(0,1500);
        await page.waitForFunction(()=>document.querySelector('#skins .panel').scrollTop>0);await page.locator('#skin-back').click();await page.locator('#home-skin').click();await painted(page);
        const tinyReopened=await measure(page);assert.equal(tinyReopened.panel.scrollTop,0);assert.ok(fits(tinyReopened));results.push({version:'current',action:'scroll-close-reopen-tiny',...tinyReopened});
      }
      await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>jumpDiagnostics.snapshot().paused),false);
      await page.evaluate(()=>localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best:3200,records:[],prefs:{skin:'gold',gameplayMode:'invincible'}})));
      await page.reload();await page.waitForFunction(()=>window.jumpDiagnostics);await page.locator('#home-skin').click();await painted(page);
      assert.equal(await page.locator('#skin-gold').getAttribute('aria-pressed'),'true');assert.equal((await measure(page)).skin.selected,'gold');
      await page.setViewportSize({width:414,height:736});await painted(page);assert.ok(fits(await measure(page)));
      await page.locator('#skin-silver').click();assert.equal(await page.locator('#skin-silver').getAttribute('aria-pressed'),'true');
      results.push({version:'current',dpr,action:'saved-gold-rotate-switch-silver',passed:true});await context.close();
    }
    assert.deepEqual(errors,[]);const productSha256=crypto.createHash('sha256').update(current).digest('hex');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,productSha256,errors,results},null,2));
    console.log(JSON.stringify({passed:true,productSha256,layouts:results.filter(r=>r.viewport).length,reopenChecks:results.filter(r=>r.action?.startsWith('scroll-close-reopen')).length,selectionChecks:3,output},null,2));
  }finally{await browser.close();}
})();
