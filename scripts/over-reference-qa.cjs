'use strict';
// Execute historical settlement drawing code with flat canvases instead of Three uploads.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-over-reference-qa');fs.mkdirSync(output,{recursive:true});
const referenceRoot=process.env.REFERENCE_ROOT||'/tmp/tiaoyitiao-reference',referenceCommit='4ef17b5fabec6a33e38501df4c75bae80950dccc',baselineCommit='e4c2bdaa351e73f9c7071519793250dac71cc58a';
const readRef=name=>execFileSync('git',['show',referenceCommit+':跳一跳/_1079392110_64/js/pages/pages2d/'+name],{cwd:referenceRoot,maxBuffer:8*1024*1024}).toString();
const base=readRef('base.js'),gg=readRef('gg.js'),url=process.env.QA_URL||'http://127.0.0.1:4173/';
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

const helpers=['r','o','a','s','p','i'].map(name=>extract(base,base.indexOf('function '+name+'('))).join('\n');
const drawText=extract(base,base.indexOf('function(',base.indexOf('exports.drawText ='))),drawLine=extract(base,base.indexOf('function(',base.indexOf('exports.drawLine =')));
const current=fs.readFileSync(path.join(root,'index.html'),'utf8'),assets=JSON.parse(current.match(/<script>const ASSETS=(\{[\s\S]*?\});<\/script>/)[1]);
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const digitFont=Buffer.from(current.match(/font-family:JumpDigits;src:url\('data:font\/ttf;base64,([^']+)/)[1],'base64');
const referenceFont=execFileSync('git',['show',referenceCommit+':跳一跳/_1079392110_64/res/num.ttf'],{cwd:referenceRoot,maxBuffer:8*1024*1024});assert.deepEqual(digitFont,referenceFont,'Numeric font must match the historical resource');
async function reference(page,score,best,isBest){return page.evaluate(async({helpers,drawText,drawLine,gg,assets,score,best,isBest})=>{
 const stage=document.getElementById('stage'),box=stage.getBoundingClientRect(),g=box.width,w=box.height,d=Math.min(devicePixelRatio,2),m=g*d,x=w*d,logs=[],errors=[];let pending=0;
 class ReferenceImage extends Image{set src(value){if(!assets[value])throw Error('Missing reference asset '+value);pending++;this.addEventListener('load',()=>pending--,{once:true});this.addEventListener('error',()=>{pending--;errors.push(value);},{once:true});super.src=assets[value];}get src(){return super.src;}}
 const api=new Function('Image','d','g','w','m','x','V',`${helpers}\nfunction e(){};return{Dpr:d,WIDTH:m,HEIGHT:x,CANVASTYPE:{gameOver:1},cwh:r,cx:o,cy:a,roundedRect:i,drawImageCenter:p,drawText:${drawText},drawLine:${drawLine},updatePlane(){}};`)(ReferenceImage,d,g,w,m,x,'JumpDigits');
 for(const name of ['drawText','drawImageCenter']){const original=api[name];api[name]=(...args)=>{const v=args[0];logs.push({kind:name,text:v.t,src:v.src,pos:v.pos,size:v.size,color:v.color||'#fff',special:!!v.special});return original(...args);};}
 const layer=document.createElement('div');layer.id='reference-over';Object.assign(layer.style,{position:'absolute',inset:'0',zIndex:5,pointerEvents:'none'});stage.append(layer);
 const self={canvasType:1,imgid:{bg:0,btn:0},context:{},opt:{type:isBest?'history':'gg',score,highest_score:best},changlleList:[]};
 for(const type of ['bg','btn']){const canvas=document.createElement('canvas');canvas.width=m;canvas.height=x;Object.assign(canvas.style,{position:'absolute',inset:0,width:'100%',height:'100%'});self.context[type]=canvas.getContext('2d');layer.append(canvas);}
 // Normal common chrome invokes the original d/c/p routines, excluding online rank and share UI.
 // New-best invokes the original complete n routine with an empty friends fixture.
 const render=new Function('exports','require',gg+';return function(self,isBest){if(isBest)n(self);else{d(self,self.context.bg,Math.max(self.opt.score,self.opt.highest_score));c(self,self.opt.score,self.context.bg,0);p(self);}};')({},name=>name==='./base'?api:{});
 document.getElementById('over').style.visibility='hidden';render(self,isBest);await document.fonts.ready;
 for(let i=0;i<300&&pending;i++)await new Promise(r=>setTimeout(r,10));assertNoErrors();await new Promise(requestAnimationFrame);
 function assertNoErrors(){if(pending||errors.length)throw Error('Reference resource failure: '+JSON.stringify({pending,errors}));}
 const text=t=>{const l=logs.find(v=>v.kind==='drawText'&&String(v.text)===t);if(!l)throw Error('Missing reference text '+t);return {x:api.cx(l.pos[0])/d,y:api.cy(l.pos[1])/d,size:api.cwh(l.size)/d,text:String(l.text)};};
 const image=src=>{const l=logs.find(v=>v.src===src);return {left:(api.cx(l.pos[0])-api.cwh(l.pos[2])/2)/d,top:(api.cy(l.pos[1])-api.cwh(l.pos[3])/2)/d,width:api.cwh(l.pos[2])/d,height:api.cwh(l.pos[3])/d};};
 return {label:text(isBest?'历史最高分':'本次得分'),score:text(String(score)),best:text('历史最高分：'+Math.max(best,score)),home:image('res/2d/new_home.png'),replay:image('res/replay.png'),flower:isBest?image('res/flower.png'):null,backdrop:'rgba(0, 0, 0, 0.45)',logs};
 },{helpers,drawText,drawLine,gg,assets,score,best,isBest});}
async function candidate(page){return page.evaluate(()=>{
 const stage=document.getElementById('stage').getBoundingClientRect(),rect=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {left:r.left-stage.left,top:r.top-stage.top,width:r.width,height:r.height};},text=el=>{const r=rect(el);return {x:r.left+r.width/2,y:r.top+r.height/2,size:parseFloat(getComputedStyle(el).fontSize),text:el.textContent};};
 return {label:text(document.querySelector('#over .score-label')),score:text(document.getElementById('final-score')),best:text(document.getElementById('best-line')),home:rect(document.querySelector('#over-home img')),replay:rect(document.querySelector('#replay img')),flower:document.getElementById('flower').classList.contains('hidden')?null:rect(document.getElementById('flower')),backdrop:getComputedStyle(document.getElementById('over')).backgroundColor};
});}
function compare(a,b){const diffs=[];for(const name of ['label','score','best']){for(const key of ['x','y','size'])if(Math.abs(a[name][key]-b[name][key])>.05)diffs.push(name+'.'+key);if(a[name].text!==b[name].text)diffs.push(name+'.text');}for(const name of ['home','replay','flower']){if(!a[name]!==!b[name]){diffs.push(name+'.existence');continue;}if(a[name])for(const key of ['left','top','width','height'])if(Math.abs(a[name][key]-b[name][key])>.05)diffs.push(name+'.'+key);}if(a.backdrop!==b.backdrop)diffs.push('backdrop');return diffs;}
async function settle(page,isBest){await page.locator('#start').click();await page.locator('#game').focus();if(isBest){await page.keyboard.down('Space');await page.waitForTimeout(720);await page.keyboard.up('Space');await page.waitForFunction(()=>{const s=jumpDiagnostics.snapshot();return s.mode==='play'&&!s.flight&&s.status==='stop'&&s.score>0;});}await page.keyboard.down('Space');await page.waitForTimeout(2200);await page.keyboard.up('Space');await page.waitForFunction(()=>jumpDiagnostics.snapshot().mode==='over');await page.evaluate(()=>document.fonts.ready);}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),results=[];
 try{const baseline=execFileSync('git',['show',baselineCommit+':index.html'],{cwd:root,maxBuffer:8*1024*1024}).toString();
 for(const [version,source]of process.env.QA_BASELINE_ONLY==='1'?[['baseline',baseline]]:[['baseline',baseline],['current',current]])for(const scenario of [{width:414,height:736,dpr:1,isBest:false},{width:414,height:736,dpr:1,isBest:true},{width:320,height:568,dpr:2,isBest:false},{width:414,height:896,dpr:3,isBest:true}]){
 const context=await browser.newContext({viewport:{width:scenario.width,height:scenario.height},deviceScaleFactor:scenario.dpr}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
 const best=scenario.isBest?0:99;await page.addInitScript(best=>localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best,records:[],prefs:{gameplayMode:'classic',skin:'classic'}})),best);await page.route(url,r=>r.fulfill({body:source,contentType:'text/html'}));await page.goto(url);await page.waitForFunction(()=>window.jumpDiagnostics);await settle(page,scenario.isBest);
 const score=await page.evaluate(()=>jumpDiagnostics.snapshot().score),actual=await candidate(page),name=`${version}-${scenario.width}x${scenario.height}-${scenario.isBest?'new-best':'normal'}`;await page.screenshot({path:path.join(output,name+'.png')});const expected=await reference(page,score,best,scenario.isBest);await page.screenshot({path:path.join(output,'reference-'+name+'.png')});const differences=compare(actual,expected);assert.deepEqual(errors,[]);if(version==='baseline')assert.ok(differences.length);else assert.deepEqual(differences,[]);
 results.push({version,scenario,score,actual,reference:expected,differences});await context.close();console.log('PASS '+name+' differences='+differences.length);
 }
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,productSha256:sha(current),baselineCommit,referenceCommit,sourceHashes:{'base.js':sha(base),'gg.js':sha(gg),'num.ttf':sha(referenceFont)},digitFontMatchesReference:true,scope:'Common score/backdrop/navigation; offline records and custom new-best badge are excluded. Normal invokes original d/c/p; new-best invokes n with an empty friends fixture.',results},null,2));
 }finally{await browser.close();}
})();
