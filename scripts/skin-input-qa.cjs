'use strict';
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-skin-input-qa'),url=process.env.QA_URL||'http://127.0.0.1:4173/';fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),checks=[],errors=[];
  try{
    const baseline=execFileSync('git',['show','347d616961bf37d073b873ed2a131dd619e52e33:index.html'],{cwd:path.join(__dirname,'..'),maxBuffer:8*1024*1024}).toString();
    const oldContext=await browser.newContext({viewport:{width:414,height:736}}),old=await oldContext.newPage();
    await old.addInitScript(()=>localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best:3200,records:[],prefs:{skin:'classic',gameplayMode:'invincible'}})));
    await old.route(url,route=>route.fulfill({body:baseline,contentType:'text/html'}));await old.goto(url);await old.waitForFunction(()=>window.jumpDiagnostics);await old.locator('#home-skin').click();
    await old.locator('#skin-classic').focus();await old.keyboard.press('Tab');assert.equal(await old.evaluate(()=>document.activeElement.id),'skin-silver');await old.keyboard.press('Space');assert.equal(await old.locator('#skin-silver').getAttribute('aria-pressed'),'false');
    await old.keyboard.press('Enter');assert.equal(await old.locator('#skin-silver').getAttribute('aria-pressed'),'true');checks.push('Reproduced baseline: native Space cannot activate the focused silver button, while Enter can.');await oldContext.close();
    const desktop=await browser.newContext({viewport:{width:414,height:736}}),page=await desktop.newPage();page.on('pageerror',e=>errors.push(String(e)));
    await page.goto(url);await page.waitForFunction(()=>window.jumpDiagnostics);await page.locator('#home-skin').click();
    assert.equal(await page.locator('#skin-silver').isDisabled(),true);assert.equal(await page.locator('#skin-gold').isDisabled(),true);
    await page.locator('#skin-classic').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'skin-back');
    await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'skin-classic');await page.keyboard.press('Space');
    assert.equal(await page.evaluate(()=>jumpDiagnostics.snapshot().paused),true);assert.equal(await page.evaluate(()=>jumpDiagnostics.snapshot().score),0);
    await page.keyboard.press('Tab');await page.keyboard.press('Enter');assert.equal(await page.locator('#home').isVisible(),true);checks.push('Locked skins are disabled and skipped by Tab; Space selects classic without starting a jump; Enter activates the historical return icon.');
    await page.evaluate(()=>localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best:3200,records:[],prefs:{skin:'classic',gameplayMode:'invincible'}})));await page.reload();await page.waitForFunction(()=>window.jumpDiagnostics);await page.locator('#home-skin').click();
    await page.locator('#skin-classic').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'skin-silver');await page.keyboard.press('Space');assert.equal(await page.locator('#skin-silver').getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Tab');await page.keyboard.press('Enter');assert.equal(await page.locator('#skin-gold').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('.skin-selected:visible').count(),1);await page.screenshot({path:path.join(output,'keyboard-selected-gold.png')});
    await page.keyboard.press('Tab');await page.keyboard.press('Enter');await page.locator('#home-skin').click();assert.equal(await page.locator('#skin-gold').getAttribute('aria-pressed'),'true');
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>jumpDiagnostics.snapshot().paused),false);checks.push('Keyboard Tab/Space/Enter changes unlocked selections with exactly one check mark; reopening retains gold; Escape restores the home page.');await desktop.close();
    const mobile=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,hasTouch:true,isMobile:true}),touch=await mobile.newPage();touch.on('pageerror',e=>errors.push(String(e)));
    await touch.addInitScript(()=>localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best:3200,records:[],prefs:{skin:'classic',gameplayMode:'invincible'}})));
    await touch.goto(url);await touch.waitForFunction(()=>window.jumpDiagnostics);await touch.locator('#home-skin').tap();await touch.locator('#skin-silver').tap();assert.equal(await touch.evaluate(()=>jumpDiagnostics.snapshot().skin.selected),'silver');
    await touch.locator('#skin-gold').tap();assert.equal(await touch.evaluate(()=>jumpDiagnostics.snapshot().skin.selected),'gold');await touch.locator('#skin-back').tap();await touch.locator('#home-skin').tap();assert.equal(await touch.evaluate(()=>jumpDiagnostics.snapshot().skin.selected),'gold');checks.push('Real touch taps select silver/gold and activate the return icon; reopening keeps the selected state.');
    await touch.locator('#skin-classic').tap();await touch.setViewportSize({width:390,height:320});await touch.waitForTimeout(150);
    const input=await mobile.newCDPSession(touch),before=await touch.locator('#skins .panel').evaluate(e=>e.scrollTop);
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:270}]});
    for(const y of [240,200,160,120,90]){await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y}]});await touch.waitForTimeout(30);}
    await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await touch.waitForTimeout(250);
    const after=await touch.locator('#skins .panel').evaluate(e=>e.scrollTop);assert.ok(after>before,'Touch swipe must scroll the panel');assert.equal(await touch.evaluate(()=>jumpDiagnostics.snapshot().skin.selected),'classic','Scrolling must not accidentally select a skin');
    await touch.locator('#skin-gold').tap();assert.equal(await touch.evaluate(()=>jumpDiagnostics.snapshot().skin.selected),'gold');await touch.screenshot({path:path.join(output,'touch-compact-selected-gold.png')});
    await touch.locator('#skin-back').tap();assert.equal(await touch.locator('#home').isVisible(),true);checks.push('An actual touch swipe scrolls the compact panel without selecting; gold remains reachable and touch selection/return work.');
    await touch.locator('#menu-button').tap();assert.equal(await touch.evaluate(()=>jumpDiagnostics.snapshot().paused),true);await touch.locator('#resume-button').tap();assert.equal(await touch.evaluate(()=>jumpDiagnostics.snapshot().paused),false);checks.push('Touch menu pause/resume still works after leaving the skin center.');
    await mobile.close();assert.deepEqual(errors,[]);const productSha256=crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..','index.html'))).digest('hex');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,productSha256,checks,touchScroll:{before,after},errors},null,2));console.log(JSON.stringify({passed:true,checks,productSha256,output},null,2));
  }finally{await browser.close();}
})();
