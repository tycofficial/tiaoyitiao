'use strict';
// Bounded home audit: original 4.0.6 drawing/scheduling, real layout and native input.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-home-qa');fs.mkdirSync(output,{recursive:true});
const url=process.env.QA_URL||'http://127.0.0.1:4173/',referenceRoot=process.env.REFERENCE_ROOT||'/tmp/tiaoyitiao-reference';
const referenceCommit='4ef17b5fabec6a33e38501df4c75bae80950dccc',baselineCommit='42b3404c592574b7e45d23261b81a3d4f66f8107';
const read=(cwd,commit,file)=>execFileSync('git',['show',commit+':'+file],{cwd,maxBuffer:8*1024*1024}).toString();
const sources=Object.fromEntries(['base','start','index'].map(name=>[name,read(referenceRoot,referenceCommit,'跳一跳/_1079392110_64/js/'+(name==='index'?'':'pages/pages2d/')+name+'.js')]));
const current=fs.readFileSync(path.join(root,'index.html'),'utf8'),baseline=read(root,baselineCommit,'index.html'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const assets=JSON.parse(current.match(/<script>const ASSETS=(\{[\s\S]*?\});<\/script>/)[1]);
function extract(source,start){
 let depth=0,quote='',comment='';
 for(let i=source.indexOf('{',start);i<source.length;i++){
  const c=source[i],n=source[i+1];
  if(comment==='line'){if(c==='\n')comment='';continue;}if(comment==='block'){if(c==='*'&&n==='/'){comment='';i++;}continue;}
  if(quote){if(c==='\\')i++;else if(c===quote)quote='';continue;}
  if('"\'`'.includes(c)){quote=c;continue;}if(c==='/'&&n==='/'){comment='line';i++;continue;}if(c==='/'&&n==='*'){comment='block';i++;continue;}
  if(c==='{')depth++;if(c==='}'&&--depth===0)return source.slice(start,i+1);
 }
 throw Error('Unclosed reference function');
}
const helpers=['r','o','a','s','p','i'].map(n=>extract(sources.base,sources.base.indexOf('function '+n+'('))).join('\n');
const drawText=extract(sources.base,sources.base.indexOf('function(',sources.base.indexOf('exports.drawText =')));
function historicalSchedule(){
 // Execute the original methods. Dependencies are spies; this proves scheduling only.
 let now=0,id=0;const tasks=[],events=[],record=(kind,data={})=>events.push({kind,time:now,...data});
 const timeout=(fn,ms)=>tasks.push({fn,due:now+ms,id:id++});
 class Vector{constructor(x=0,y=0,z=0){Object.assign(this,{x,y,z});}normalize(){return this;}set(x,y,z){Object.assign(this,{x,y,z});}}
 class Block{constructor(_,index){this.obj={position:new Vector(),visible:true};this.hitObj={material:{}};this.greenMaterial=this.whiteMaterial={color:{setHex(){}}};this.index=index;}showup(){record('block',{index:this.index});}popup(){record('popup');}rebound(){}}
 const self={mode:'single',stage:'startPage',show:true,animating:true,blocks:[],scene:{add(){}},bottle:{velocity:{},obj:{position:new Vector(-10,-2.75,0)},jump(){record(now===1500?'arrival':'jump');}},nextBlock:new Block(),initNextBlock:new Block(),touchStartAnim(){record('charge');},checkHit2(){return 0;},generateNextBlock(){return new Block();}};
 const animation={customAnimation:{to(){}},TweenAnimation:{kill(){}}};
 for(const name of ['animate','loopAnimate']){const start=sources.index.indexOf('value: function()',sources.index.indexOf('key: "'+name+'"'));assert.ok(start>=0);self[name]=new Function('setTimeout','n','c','s','w','return '+extract(sources.index,start+7))(timeout,{default:Block},{BOTTLE:{velocityZIncrement:0,velocityY:0,velocityYIncrement:0}},{Vector2:Vector,Vector3:Vector},animation);}
 self.animate();while(tasks.length){tasks.sort((a,b)=>a.due-b.due||a.id-b.id);const task=tasks.shift();if(task.due>6720)break;now=task.due;task.fn();}
 assert.deepEqual(events.filter(e=>e.kind==='block').map(e=>e.time),[0,200,400,600,800,1000,1200]);
 assert.deepEqual(events.filter(e=>e.kind!=='block').map(e=>[e.kind,e.time]),[['arrival',1500],['popup',4500],['charge',6000],['jump',6719]]);return events;
}
async function referenceDrawing(page){return page.evaluate(async({helpers,drawText,start,assets})=>{
 const b=document.getElementById('stage').getBoundingClientRect(),g=b.width,w=b.height,d=Math.min(devicePixelRatio,2),m=g*d,x=w*d,logs=[],failures=[];let pending=0;
 class ReferenceImage extends Image{set src(value){if(!assets[value])throw Error('Missing '+value);pending++;this.addEventListener('load',()=>pending--,{once:true});this.addEventListener('error',()=>{pending--;failures.push(value);},{once:true});super.src=assets[value];}}
 const api=new Function('Image','d','g','w','m','x','V',`${helpers}\nfunction e(){};return{WIDTH:m,HEIGHT:x,cwh:r,cx:o,cy:a,roundedRect:i,drawImageCenter:p,drawText:${drawText},routeCanvas(){},createPlane(){},updatePlane(){}};`)(ReferenceImage,d,g,w,m,x,'');
 for(const name of ['drawText','drawImageCenter']){const original=api[name];api[name]=(...args)=>{const v=args[0];logs.push({kind:name,text:v.t,src:v.src,pos:v.pos,size:v.size});return original(...args);};}
 const self={imgid:{bg:0,btn:0},context:{},opt:{hideRank:false,banType:0}};
 for(const type of ['bg','btn']){const c=document.createElement('canvas');c.width=m;c.height=x;self.context[type]=c.getContext('2d');}
 const exports={};new Function('exports','require',start)(exports,name=>name==='./base'?api:{});exports.drawStartPage(self);
 for(let i=0;i<300&&pending;i++)await new Promise(r=>setTimeout(r,10));if(pending||failures.length)throw Error('Reference asset failure '+JSON.stringify({pending,failures}));
 const flat=document.createElement('canvas');flat.width=m;flat.height=x;const ctx=flat.getContext('2d');ctx.fillStyle='#d7dbe6';ctx.fillRect(0,0,m,x);ctx.drawImage(self.context.bg.canvas,0,0);ctx.drawImage(self.context.btn.canvas,0,0);
 const image=src=>{const v=logs.find(v=>v.src===src);return {x:api.cx(v.pos[0])/d,y:api.cy(v.pos[1])/d,width:api.cwh(v.pos[2])/d,height:api.cwh(v.pos[3])/d};};
 return {images:Object.fromEntries(logs.filter(v=>v.src).map(v=>[v.src,image(v.src)])),texts:logs.filter(v=>v.kind==='drawText').map(v=>({text:v.text,x:api.cx(v.pos[0])/d,y:api.cy(v.pos[1])/d,size:api.cwh(v.size)/d})),footerTop:api.cy(617)/d,backdrop:getComputedStyle(document.getElementById('home')).backgroundColor,referenceBackdrop:'rgba(0, 0, 0, 0.3)',font:'Helvetica',png:flat.toDataURL().split(',')[1]};
 },{helpers,drawText,start:sources.start,assets});}
async function ready(page){await page.waitForFunction(()=>window.jumpDiagnostics);await settleLayout(page);}
async function settleLayout(page){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});}
async function measure(page){return page.evaluate(()=>{
 const stage=document.getElementById('stage').getBoundingClientRect(),rect=el=>{const r=el.getBoundingClientRect();return {left:r.left-stage.left,top:r.top-stage.top,width:r.width,height:r.height,x:r.left+r.width/2-stage.left,y:r.top+r.height/2-stage.top};};
 const home=document.getElementById('home'),title=rect(home.querySelector('.title')),start=rect(document.getElementById('start')),capsule=rect(document.getElementById('capsule'));
 return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},stage:{left:stage.left,width:stage.width,height:stage.height},title,start,capsule,overlap:title.left<capsule.left+capsule.width&&title.left+title.width>capsule.left&&title.top<capsule.top+capsule.height&&title.top+title.height>capsule.top,footer:rect(home.querySelector('.home-footer')),entries:[...home.querySelectorAll('.home-footer button')].map(el=>({id:el.id,rect:rect(el),image:rect(el.querySelector('img')),label:{...rect(el.querySelector('span')),text:el.textContent,size:parseFloat(getComputedStyle(el.querySelector('span')).fontSize),font:getComputedStyle(el.querySelector('span')).fontFamily}})),scroll:{top:home.scrollTop,height:home.clientHeight,content:home.scrollHeight,width:home.clientWidth,contentWidth:home.scrollWidth}};
 });}
function assertCompact(r){assert.equal(r.overlap,false,'Title must clear the fixed capsule on entry');assert.ok(r.title.top>=64);assert.ok(r.start.height>=44);assert.ok(r.scroll.content>r.scroll.height);assert.equal(r.scroll.width,r.scroll.contentWidth);assert.equal(r.entries.length,2);for(const e of r.entries){assert.ok(e.rect.width>=44&&e.rect.height>=44);assert.equal(e.label.size,12);}}
function compareReference(actual,reference){
 const deltas={};for(const [name,asset]of [['title','res/title.png'],['start','res/play.png']]){const a=actual[name],b=reference.images[asset];deltas[name]=Object.fromEntries(['x','y','width','height'].map(k=>[k,a[k]-b[k]]));for(const k of ['x','y','width'])assert.ok(Math.abs(deltas[name][k])<.05);assert.ok(Math.abs(deltas[name].height)<.5,'Natural aspect-ratio height difference must stay below half a CSS pixel');}
 assert.ok(Math.abs(actual.footer.top-reference.footerTop)<.05);assert.equal(reference.backdrop,reference.referenceBackdrop);
 for(const entry of actual.entries){const asset=entry.id==='home-rank'?'res/2d/rank.png':'res/2d/skin.png',r=reference.images[asset],text=reference.texts.find(t=>t.text===(entry.id==='home-rank'?'排行榜':'皮肤中心'));for(const k of ['y','width','height'])assert.ok(Math.abs(entry.image[k]-r[k])<.05);assert.ok(Math.abs(entry.label.y-text.y)<.05);assert.ok(Math.abs(entry.label.size-text.size)<.05);}
 return deltas;
}
async function actualSchedule(page,expected){return page.evaluate(async expected=>{
 // Reset through the real home control; observe the scene's own clock without accelerating it.
 document.getElementById('home-button').click();let previous={time:0,phase:'numbered',visible:[0]},events=[{kind:'block',index:0,before:0,after:0}],transitions=[];
 await new Promise((resolve,reject)=>{const end=performance.now()+15000;function observe(){const s=jumpDiagnostics.snapshot(),i=jumpDiagnostics.introSnapshot(),visible=i.platforms.filter(b=>b.visible).map(b=>b.index);
  for(const index of visible)if(!previous.visible.includes(index))events.push({kind:'block',index,before:previous.time,after:s.time});
  if(s.demo.phase!==previous.phase){const row={kind:s.demo.phase,before:previous.time,after:s.time};transitions.push(row);if(['arrival','waiting','charge','jump'].includes(row.kind))events.push({...row,kind:row.kind==='waiting'?'popup':row.kind});}
  previous={time:s.time,phase:s.demo.phase,visible};if(events.some(e=>e.kind==='jump'))resolve();else if(performance.now()>end)reject(Error('Home schedule did not finish'));else requestAnimationFrame(observe);
 }requestAnimationFrame(observe);});
 // SceneClock executes nested timers at their exact deadlines within each update.
 // Observation is frame-based; it must bracket the original nominal deadline.
 const comparisons=expected.map(e=>{const a=events.find(v=>v.kind===e.kind&&(e.kind!=='block'||v.index===e.index));if(!a)throw Error('Missing '+JSON.stringify(e));if(e.time<a.before-1e-6||e.time>a.after+1e-6)throw Error('Event outside observed frame interval '+JSON.stringify({expected:e,actual:a}));return {expected:e,actual:a};});return {comparisons,transitions,clock:'Scene milliseconds; each expected instant must lie between the two real observed frames.'};
 },expected);}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),results={passed:false,productSha256:sha(current),baselineCommit,referenceCommit,sourceHashes:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k+'.js',sha(v)])),scriptSha256:sha(fs.readFileSync(__filename)),layout:[],checks:[],errors:[]};
 const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(results,null,2));
 try{
  const expected=historicalSchedule();results.historicalSchedule=expected;
  for(const [version,source]of [['baseline',baseline],['current',current]]){
   const context=await browser.newContext({viewport:{width:414,height:736},deviceScaleFactor:2}),page=await context.newPage();page.on('pageerror',e=>results.errors.push(String(e)));await page.route(url,r=>r.fulfill({body:source,contentType:'text/html'}));await page.goto(url);await ready(page);
   const sizes=version==='baseline'?[[320,240],[320,200]]:[[414,736],[320,568],[736,414],[320,240],[320,200]];
   for(const [width,height]of sizes){await page.setViewportSize({width,height});await settleLayout(page);const row={version,...await measure(page)};
    if(height<=320){if(version==='baseline'){assert.equal(row.overlap,true);assert.ok(row.start.height<44);}else assertCompact(row);}
    if(height>320){const reference=await referenceDrawing(page),{png,...data}=reference;row.reference=data;row.sharedDeltas=compareReference(row,data);if(width===414){fs.writeFileSync(path.join(output,'historical-flat-414x736.png'),Buffer.from(png,'base64'));await page.screenshot({path:path.join(output,'current-414x736.png')});}}
    if(height<=240)await page.screenshot({path:path.join(output,version+'-'+width+'x'+height+'.png')});results.layout.push(row);save();console.log('PASS layout '+version+' '+width+'x'+height);
   }
   if(version==='current'){results.schedule=await actualSchedule(page,expected);results.checks.push('Original animate/loopAnimate scheduling matches actual block, arrival, popup, charge and release frame intervals.');}
   await context.close();
  }
  const context=await browser.newContext({viewport:{width:320,height:200},hasTouch:true,isMobile:true,deviceScaleFactor:2,...(process.env.QA_SKIP_VIDEO==='1'?{}:{recordVideo:{dir:output,size:{width:320,height:200}}})}),page=await context.newPage();page.on('pageerror',e=>results.errors.push(String(e)));
  await page.addInitScript(()=>localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best:3200,records:[{score:3200,date:'2026-11-01T00:00:00.000Z'}],prefs:{skin:'silver',gameplayMode:'invincible'}})));await page.goto(url);await ready(page);assertCompact(await measure(page));
  const input=await context.newCDPSession(page),state=()=>page.evaluate(()=>jumpDiagnostics.snapshot());
  const homeScroll=()=>page.locator('#home').evaluate(e=>e.scrollTop),initial=await homeScroll();
  await input.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:160,y:170}]});for(const y of [145,115,85,60]){await input.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:160,y}]});await page.waitForTimeout(30);}await input.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(250);
  const scrolled=await homeScroll();assert.ok(scrolled>initial);assert.equal((await state()).mode,'home');results.touchScroll={initial,scrolled};results.checks.push('Native touch swipe scrolls the compact home; exactly two real offline entries remain reachable.');
  await page.locator('#menu-button').tap();const paused=await state(),scroll=await homeScroll();await page.waitForTimeout(150);assert.equal((await state()).time,paused.time);await page.locator('#resume-button').tap();assert.equal(await homeScroll(),scroll);assert.equal((await state()).paused,false);results.checks.push('Home menu freezes the demo and resume preserves its clock and scroll position.');
  // Locator taps may legitimately scroll a partly clipped button into view before clicking.
  // Compare the return position to the trusted click's position, not the pre-action position.
  async function tapEntry(id){await page.evaluate(id=>{document.getElementById(id).addEventListener('click',event=>{window.__homeAuditClick={id,scroll:document.getElementById('home').scrollTop,trusted:event.isTrusted};},{capture:true,once:true});},id);const before=await homeScroll();await page.locator('#'+id).tap();const click=await page.evaluate(()=>window.__homeAuditClick);assert.equal(click.trusted,true);return {before,...click};}
  const rankClick=await tapEntry('home-rank');assert.equal(await page.locator('#rank').isVisible(),true);assert.match(await page.locator('#rank-list').innerText(),/3200/);await page.locator('#rank-back').tap();assert.equal(await homeScroll(),rankClick.scroll);
  const skinClick=await tapEntry('home-skin');assert.equal((await state()).skin.selected,'silver');await page.locator('#skin-back').tap();assert.equal(await page.locator('#home').isVisible(),true);assert.equal(await homeScroll(),skinClick.scroll);results.entryClicks=[rankClick,skinClick];results.checks.push('Both actual offline entries open and return with saved best/skin and the native click-time scroll intact.');
  await page.locator('#home-button').tap();assert.equal(await homeScroll(),0);assertCompact(await measure(page));await page.screenshot({path:path.join(output,'touch-home-reset.png')});
  await page.locator('#start').focus();await page.keyboard.press('Space');assert.equal((await state()).mode,'play');assert.equal((await state()).flight,null);assert.equal((await state()).status,'stop');results.checks.push('Home entry resets to the unobscured title; native Space starts from the focused button without a ghost jump.');
  await page.locator('#game').focus();await page.keyboard.down('Space');await page.waitForTimeout(60);await page.keyboard.up('Space');await page.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return s.mode==='play'&&!s.flight&&s.status==='stop';});assert.equal((await state()).jumps,0);assert.equal((await state()).score,0);
  await page.keyboard.down('Space');await page.locator('#menu-button').tap();await page.locator('#restart-button').tap();await page.keyboard.up('Space');assert.equal((await state()).flight,null);assert.equal((await state()).status,'stop');assert.equal((await state()).score,0);results.checks.push('A real short game press remains a zero-score retry; restarting while Space is held ignores its late release.');
  await page.locator('#menu-button').tap();await page.locator('#invincible-button').tap();await page.locator('#restart-button').tap();assert.equal((await state()).invincible,false);await page.locator('#home-button').tap();assert.equal(await homeScroll(),0);
  for(const viewport of [{width:414,height:736},{width:320,height:200}]){await page.setViewportSize(viewport);await settleLayout(page);if(viewport.height<=320)assertCompact(await measure(page));await page.locator('#start').tap();assert.equal((await state()).mode,'play');assert.equal((await state()).invincible,false);await page.locator('#home-button').tap();}
  const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('jump-classic-offline-v1')));assert.equal(stored.best,3200);assert.equal(stored.records[0].score,3200);assert.equal(stored.prefs.skin,'silver');assert.equal(stored.prefs.gameplayMode,'classic');results.stored=stored;results.checks.push('Normal-mode preference, saved best/record and silver skin survive restart, home and portrait/compact rotation; start remains touch reachable.');
  await context.close();assert.deepEqual(results.errors,[]);results.passed=true;save();console.log(JSON.stringify({passed:true,checks:results.checks,output},null,2));
 }catch(e){results.failure=String(e);save();throw e;}finally{await browser.close();}
})();
