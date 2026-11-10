'use strict';
// Optional integration QA: requires Playwright and Chromium; the game itself has no dependencies.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const output = path.resolve(process.env.QA_OUTPUT || '/tmp/tiaoyitiao-qa/final');
const baseURL = process.env.QA_URL || 'http://127.0.0.1:4173/';
const productSha256 = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..','index.html'))).digest('hex');
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-7,`${a} vs ${b}`);
fs.mkdirSync(output,{recursive:true});
function holdFor(distance) {
  let lo=0,hi=2;
  for(let i=0;i<32;i++) {
    const h=(lo+hi)/2,vy=Math.min(135+h*15,180),y=2.75-.033875*Math.min(99,h*60);
    const a=+((-vy+Math.sqrt(vy*vy-1440*(2.75-+y.toFixed(2))))/-720).toFixed(2);
    const time=+(vy/360-a).toFixed(2),range=+Math.min(h*70,150).toFixed(2)*time;
    if(range<distance)lo=h;else hi=h;
  }
  return (lo+hi)/2;
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const context=await browser.newContext({viewport:{width:414,height:736},deviceScaleFactor:1,...(process.env.QA_SKIP_VIDEO==='1'?{}:{recordVideo:{dir:output,size:{width:414,height:736}}})});
  const page=await context.newPage(),errors=[],requests=[],checks=[],flights=[],notRun=[];
  page.on('pageerror',e=>errors.push(String(e)));
  page.on('request',r=>{if(!r.url().startsWith(baseURL)&&!r.url().startsWith('data:'))requests.push(r.url());});
  const snapshot=()=>page.evaluate(()=>jumpDiagnostics.snapshot());
  const ready=()=>page.waitForFunction(()=>window.jumpDiagnostics);
  const settled=()=>page.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return s.mode==='play'&&!s.flight&&s.status==='stop';},{},{timeout:15000});
  async function press(hold,pointer=false) {
    await settled();await page.locator('#game').focus();
    if(pointer){await page.mouse.move(200,560);await page.mouse.down();}else await page.keyboard.down('Space');
    await page.waitForTimeout(hold*1000);
    if(pointer)await page.mouse.up();else await page.keyboard.up('Space');
    const s=await snapshot();if(s.flight)flights.push(s.flight);
    return s;
  }
  async function menu(){await page.locator('#menu-button').click();assert.equal((await snapshot()).paused,true);}
  async function start(){await page.locator('#start').click();await settled();}
  try {
    // The exact base commit supplies the before image without changing the working tree.
    const baseline=execFileSync('git',['show','f1e477cb79c95367b76aaf3735fe14303a62f1ce:index.html'],{cwd:path.join(__dirname,'..'),maxBuffer:8*1024*1024});
    await page.route(baseURL,route=>route.fulfill({body:baseline,contentType:'text/html'}));
    await page.goto(baseURL);await ready();await page.locator('#home-skin').click();
    await page.screenshot({path:path.join(output,'before-skins.png')});
    const oldRects=await page.locator('.skin-choice .skin-status').evaluateAll(es=>es.map(e=>e.getBoundingClientRect().toJSON()));
    assert.equal(oldRects[0].x,oldRects[1].x);assert.equal(oldRects[1].x,oldRects[2].x);
    checks.push('Reproduced baseline: all three skin status labels overlap.');
    await page.unroute(baseURL);await page.reload();await ready();await page.locator('#home-skin').click();
    const layout=await page.locator('.skin-choice').evaluateAll(es=>es.map(e=>{const c=e.getBoundingClientRect(),s=e.querySelector('.skin-status').getBoundingClientRect();return {inside:s.left>=c.left&&s.right<=c.right&&s.top>=c.top&&s.bottom<=c.bottom,status:getComputedStyle(e.querySelector('.skin-status')).position,ownsStatus:e.querySelector('.skin-status').offsetParent===e};}));
    assert.ok(layout.every(x=>x.inside&&x.status==='absolute'&&x.ownsStatus));
    assert.equal(await page.locator('#skin-silver').isDisabled(),true);assert.equal(await page.locator('#skin-gold').isDisabled(),true);
    await page.screenshot({path:path.join(output,'after-skins.png')});checks.push('New save: independent labels, complete previews, classic selected, silver/gold locked.');
    await page.locator('#skin-back').click();await start();assert.equal((await snapshot()).invincible,true);
    await press(.05,true);await settled();let s=await snapshot();assert.equal(s.score,0);assert.equal(s.jumps,0);assert.equal(s.current.order,0);const shortPosition=s.bottle.position[0];checks.push('Short pointer charge: current-platform landing preserves score.');
    s=await press(2.2);assert.ok(s.flight&&s.flight.hit===0,'long charge must overshoot');await settled();s=await snapshot();assert.equal(s.score,0);near(s.bottle.position[0],shortPosition);assert.equal(s.mode,'play');
    assert.match(await page.locator('#feedback').innerText(),/分数不变/);checks.push('Long keyboard charge: miss returns to takeoff with unchanged score.');
    for(let i=0;i<6;i++) {
      s=await snapshot();const distance=Math.hypot(s.next.position[0]-s.bottle.position[0],s.next.position[2]-s.bottle.position[2]);
      const before=s.jumps;await press(holdFor(distance));await settled();s=await snapshot();assert.equal(s.jumps,before+1,'manual jump must reach next platform');
      await page.waitForTimeout(250);
    }
    assert.ok(s.score>0&&s.best===s.score);await page.screenshot({path:path.join(output,'gameplay.png')});checks.push('Six manual consecutive successful jumps: real scoring and saved best, no automatic jump or centering.');
    const prior=s.score,position=s.bottle.position;
    await press(2.2);await settled();s=await snapshot();assert.equal(s.score,prior);near(s.bottle.position[0],position[0]);near(s.bottle.position[2],position[2]);assert.equal(s.combo,0);checks.push('Miss after consecutive jumps returns to nonzero takeoff position and resets center combo.');
    await menu();s=await snapshot();await page.waitForTimeout(300);const paused=await snapshot();near(paused.time,s.time);await page.screenshot({path:path.join(output,'menu.png')});
    await page.locator('#restart-button').click();await settled();s=await snapshot();assert.equal(s.score,0);assert.equal(s.jumps,0);assert.equal(s.invincible,true);checks.push('Menu freezes scene time; restart resets this run and keeps mode.');
    await menu();await page.locator('#invincible-button').click();await page.locator('#resume-button').click();s=await press(2.2);assert.equal(s.invincible,false);
    await page.waitForFunction(()=>jumpDiagnostics.snapshot().mode==='over',{},{timeout:15000});await page.screenshot({path:path.join(output,'normal-game-over.png')});checks.push('Normal mode: overshoot still reaches the real game-over screen.');
    await page.reload();await ready();assert.equal((await snapshot()).invincible,false);checks.push('Normal mode preference survives page reload.');
    await menu();await page.locator('#invincible-button').click();await page.locator('#resume-button').click();await start();
    await page.mouse.move(200,560);await page.mouse.down();await page.waitForTimeout(100);await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal((await snapshot()).paused,true);await page.locator('#resume-button').click();await settled();assert.equal((await snapshot()).score,0);checks.push('Opening menu during pointer charge cancels it; late release cannot jump.');
    await page.locator('#home-button').click();
    // Unlocking uses an existing valid legacy score fixture, never production score mutation.
    await page.evaluate(()=>localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best:3200,records:[{score:3200,date:'2026-11-03'}],prefs:{gameplayMode:'invincible',skin:'classic',sound:false,quality:'standard'}})));
    await page.reload();await ready();await page.locator('#home-skin').click();
    for(const id of ['gold','silver','classic','silver','gold','classic','gold']) {
      await page.locator('#skin-'+id).click();s=await snapshot();assert.equal(s.skin.selected,id);
      assert.deepEqual(s.skin.maps,id==='classic'?['res/head.png','res/head.png','res/middle.png','res/bottom.png']:['head','head','middle','bottom'].map(part=>'reconstructed/'+id+'/'+part));
      assert.equal(await page.locator('#skin-'+id).getAttribute('aria-pressed'),'true');assert.equal(await page.locator('.skin-choice[aria-pressed=true]').count(),1);
    }
    await page.screenshot({path:path.join(output,'unlocked-skins.png')});await page.locator('#skin-back').click();await start();assert.equal((await snapshot()).skin.selected,'gold');
    await menu();await page.locator('#restart-button').click();await settled();assert.equal((await snapshot()).skin.selected,'gold');
    await page.reload();await ready();s=await snapshot();assert.equal(s.skin.selected,'gold');assert.equal(s.best,3200);
    checks.push('Seven skin switches: preview/selection/material maps correspond; gold survives start, restart and reload; legacy best/records retained.');
    for(const viewport of [{width:320,height:568},{width:736,height:414},{width:1440,height:900}]) {
      await page.setViewportSize(viewport);await page.locator('#home-skin').click();
      const panel=await page.locator('#skins .panel').boundingBox();
      assert.ok(panel.x>=0&&panel.x+panel.width<=viewport.width&&panel.y>=0&&panel.y+panel.height<=viewport.height);
      for(const id of ['classic','silver','gold']){
        await page.locator('#skin-'+id).scrollIntoViewIfNeeded();
        const card=await page.locator('#skin-'+id).boundingBox();
        assert.ok(card.x>=0&&card.x+card.width<=viewport.width&&card.y>=0&&card.y+card.height<=viewport.height,'Every card must be fully reachable after scrolling');
      }
      await page.screenshot({path:path.join(output,`skins-${viewport.width}x${viewport.height}.png`)});await page.locator('#skin-back').click();
    }
    checks.push('Skin panel fits 320x568, 736x414 landscape and 1440x900; every card remains fully reachable through scrolling.');
    await context.close();
    const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const touchPage=await mobile.newPage();touchPage.on('pageerror',e=>errors.push(String(e)));
    await touchPage.goto(baseURL);await touchPage.waitForFunction(()=>window.jumpDiagnostics);await touchPage.locator('#start').tap();
    const input=await mobile.newCDPSession(touchPage);
    await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:600}]});
    await touchPage.waitForTimeout(2200);await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await touchPage.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return !s.flight&&s.status==='stop';});
    const touchState=await touchPage.evaluate(()=>jumpDiagnostics.snapshot());assert.equal(touchState.mode,'play');assert.equal(touchState.score,0);near(touchState.bottle.position[0],0);
    await touchPage.screenshot({path:path.join(output,'touch-retry.png')});await mobile.close();
    checks.push('Mobile touch emulation: long touch overshoots and safely retries.');
    if(process.env.QA_SKIP_FILE==='1')notRun.push({action:'Open local index.html through file://',reason:'Skipped after observed managed-browser ERR_BLOCKED_BY_ADMINISTRATOR; no retry or bypass attempted.'});
    else {
      const offline=await browser.newContext();const offlinePage=await offline.newPage();offlinePage.on('pageerror',e=>errors.push(String(e)));
      try {
        await offlinePage.goto('file://'+path.join(__dirname,'..','index.html'));await offlinePage.waitForFunction(()=>window.jumpDiagnostics);
        await offlinePage.locator('#start').click();assert.equal(await offlinePage.evaluate(()=>jumpDiagnostics.snapshot().mode),'play');
        checks.push('Direct file:// entry loads and starts without a server.');
      } catch(error) {
        if(!String(error).includes('ERR_BLOCKED_BY_ADMINISTRATOR'))throw error;
        notRun.push({action:'Open local index.html through file://',reason:'Managed Chromium policy returned ERR_BLOCKED_BY_ADMINISTRATOR; no bypass attempted.'});
      } finally { await offline.close(); }
    }
    assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);checks.push('No page errors or remote runtime requests.');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,productSha256,checks,notRun,flights,errors,requests},null,2));console.log(JSON.stringify({passed:true,checks,notRun,output},null,2));
  } catch(error) {
    await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:false,error:String(error),checks,flights,snapshot:await snapshot().catch(()=>null),errors,requests},null,2));
    throw error;
  } finally { await context.close();await browser.close(); }
})();
