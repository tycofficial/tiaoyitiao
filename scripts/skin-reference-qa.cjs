'use strict';
// Execute the declared historical skin renderer and its actual coordinate/drawing helpers.
// Only Three.js scene upload and route plumbing are replaced with flat canvas layers.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..'),output=path.resolve(process.env.QA_OUTPUT||'/tmp/tiaoyitiao-skin-reference-qa');
const referenceRoot=process.env.REFERENCE_ROOT||'/tmp/tiaoyitiao-reference',referenceCommit='4ef17b5fabec6a33e38501df4c75bae80950dccc';
const prefix='跳一跳/_1079392110_64/js/pages/pages2d/',url=process.env.QA_URL||'http://127.0.0.1:4173/';
const readRef=file=>execFileSync('git',['show',referenceCommit+':'+prefix+file],{cwd:referenceRoot,maxBuffer:8*1024*1024}).toString();
const base=readRef('base.js'),skin=readRef('skin.js');fs.mkdirSync(output,{recursive:true});
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
const drawText=extract(base,base.indexOf('function(',base.indexOf('exports.drawText =')));
const current=fs.readFileSync(path.join(root,'index.html'),'utf8');
const assets=JSON.parse(current.match(/<script>const ASSETS=(\{[\s\S]*?\});<\/script>/)[1]);
const resourceNames=['res/bl3.png','res/2d/sel.png','res/2d/new_return.png','res/defaultBottlePoster.png'];
const urls=Object.fromEntries(resourceNames.map(key=>[key,assets[key]]));
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
async function runReference(page,selected,best){return page.evaluate(async ({urls,helpers,drawText,skin,selected,best})=>{
  const stage=document.getElementById('stage'),bounds=stage.getBoundingClientRect(),g=bounds.width,w=bounds.height,d=Math.min(devicePixelRatio,2),x=w*d,m=g*d;
  let pending=0;const logs=[],loadErrors=[];
  urls['qa/silver']=document.getElementById('silver-preview').src;urls['qa/gold']=document.getElementById('gold-preview').src;
  class ReferenceImage extends Image{
    set src(value){if(!urls[value])throw Error('Missing reference resource '+value);pending++;this.addEventListener('load',()=>pending--,{once:true});this.addEventListener('error',()=>{pending--;loadErrors.push(value);},{once:true});super.src=urls[value];}
    get src(){return super.src;}
  }
  const api=new Function('Image','d','g','w','x','m','V',`${helpers}\nfunction e(){};return{Dpr:d,WIDTH:m,HEIGHT:x,cwh:r,cx:o,cy:a,drawImageCenter:p,roundedRect:i,drawText:${drawText},routeCanvas(){},createPlane(){},updatePlane(){}};`)(ReferenceImage,d,g,w,x,m,null);
  for(const name of ['drawImageCenter','drawText','roundedRect']){
    const original=api[name];api[name]=(...args)=>{const v=args[0];logs.push(name==='roundedRect'?{kind:name,bounds:args.slice(0,4).map(n=>n/d),fillStyle:args[5].fillStyle}:{kind:name,src:v.src,text:v.t,pos:v.pos,size:v.size,alpha:v.alpha??1,color:v.color??'#fff'});return original(...args);};
  }
  const wrapper=document.createElement('div');wrapper.id='reference-skin';Object.assign(wrapper.style,{position:'absolute',inset:'0',zIndex:'9',pointerEvents:'none'});stage.append(wrapper);
  const list=[['classic','res/defaultBottlePoster.png',0],['silver','qa/silver',1000],['gold','qa/gold',3000]].map(([id,img,threshold])=>({id,img,use_status:best>=threshold?1:0,unlock_wording:threshold?threshold+'分':''}));
  const self={imgid:{btn:0,bg:0},context:{},opt:{id:selected,skin_list:list}};
  for(const type of ['bg','btn']){const canvas=document.createElement('canvas');canvas.width=m;canvas.height=x;Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%'});self.context[type]=canvas.getContext('2d');wrapper.append(canvas);}
  const module={exports:{}};new Function('module','exports','require',skin)(module,module.exports,()=>api);
  document.getElementById('skins').style.visibility='hidden';module.exports.drawSkin(self);await document.fonts.ready;
  for(let i=0;i<300&&pending;i++)await new Promise(resolve=>setTimeout(resolve,10));if(pending)throw Error('Reference image loading timed out');await new Promise(requestAnimationFrame);
  const imageRect=pos=>({left:(api.cx(pos[0])-api.cwh(pos[2])/2)/d,top:(api.cy(pos[1])-api.cwh(pos[3])/2)/d,width:api.cwh(pos[2])/d,height:api.cwh(pos[3])/d});
  const rects=logs.filter(l=>l.kind==='roundedRect');
  const cards=rects.map((entry,index)=>{
    const item=list[index],preview=logs.find(l=>l.kind==='drawImageCenter'&&l.src===item.img),mark=item.id===selected?logs.find(l=>l.kind==='drawImageCenter'&&l.src==='res/2d/sel.png'):null;
    const [left,top,width,height]=entry.bounds;
    const background=[...self.context.btn.getImageData(Math.floor((left+width*.85)*d),Math.floor((top+height*.08)*d),1,1).data];
    return {id:item.id,rect:{left,top,width,height},preview:imageRect(preview.pos),previewOpacity:preview.alpha,background,selected:item.id===selected,locked:!item.use_status,mark:mark?imageRect(mark.pos):null,statusCenter:{x:api.cx(123+167*(index%2))/d,y:api.cy(296+187*Math.floor(index/2))/d}};
  });
  return {stage:{width:g,height:w},referenceDpr:d,title:{x:api.cx(207)/d,y:api.cy(89)/d,size:api.cwh(22)/d},frame:imageRect(logs.find(l=>l.src==='res/bl3.png').pos),back:imageRect(logs.find(l=>l.src==='res/2d/new_return.png').pos),cards,logs,loadErrors};
},{urls,helpers,drawText,skin,selected,best});}
async function candidate(page){return page.evaluate(()=>{
  const stage=document.getElementById('stage').getBoundingClientRect();
  const rect=e=>{if(!e)return null;const r=e.getBoundingClientRect();return {left:r.left-stage.left,top:r.top-stage.top,width:r.width,height:r.height};};
  const cards=[...document.querySelectorAll('.skin-choice')].map(button=>{const image=button.querySelector('img[id]'),marker=button.querySelector('.skin-selected'),status=button.querySelector('.skin-status');const r=rect(status);return {id:button.id.slice(5),rect:rect(button),preview:rect(image),previewOpacity:Number(getComputedStyle(image).opacity),background:getComputedStyle(button).backgroundColor,selected:button.getAttribute('aria-pressed')==='true',locked:button.disabled,mark:marker&&!marker.hidden?rect(marker):null,statusCenter:{x:r.left+r.width/2,y:r.top+r.height/2},statusText:status.textContent.trim()};});
  const title=document.querySelector('#skins h2'),t=rect(title);return {title:{x:t.left+t.width/2,y:t.top+t.height/2,size:parseFloat(getComputedStyle(title).fontSize)},frame:rect(document.querySelector('#skins .skin-frame')),back:rect(document.getElementById('skin-back')),cards};
});}
function compare(actual,reference){
  const errors=[];
  const rect=(a,b,label)=>{if(!a){errors.push(label+': missing');return;}for(const key of ['left','top','width','height'])if(Math.abs(a[key]-b[key])>.05)errors.push(`${label}.${key}: ${a[key]} vs ${b[key]}`);};
  rect(actual.frame,reference.frame,'frame');rect(actual.back,reference.back,'return');
  for(const key of ['x','y','size'])if(Math.abs(actual.title[key]-reference.title[key])>.05)errors.push('title.'+key);
  actual.cards.forEach((a,i)=>{const b=reference.cards[i];rect(a.rect,b.rect,a.id);rect(a.preview,b.preview,a.id+'.preview');
    if(a.selected!==b.selected||a.locked!==b.locked)errors.push(a.id+'.state');if(a.previewOpacity!==b.previewOpacity)errors.push(a.id+'.opacity');
    const rgb=a.background.match(/[\d.]+/g).slice(0,3).map(Number);if(rgb.some((n,j)=>n!==b.background[j]))errors.push(a.id+'.background');
    if(b.mark)rect(a.mark,b.mark,a.id+'.selected');else if(a.mark)errors.push(a.id+'.unexpected-mark');
    for(const key of ['x','y'])if(Math.abs(a.statusCenter[key]-b.statusCenter[key])>.05)errors.push(a.id+'.statusCenter.'+key);
  });return errors;
}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),results=[];
  try{
    const baseline=execFileSync('git',['show','347d616961bf37d073b873ed2a131dd619e52e33:index.html'],{cwd:root,maxBuffer:8*1024*1024}).toString();
    for(const [version,source]of [['baseline',baseline],['current',current]])for(const scenario of [{width:414,height:736,dpr:1,best:0,selected:'classic'},{width:414,height:736,dpr:1,best:3200,selected:'gold'},{width:320,height:568,dpr:2,best:3200,selected:'silver'},{width:414,height:896,dpr:3,best:0,selected:'classic'}]){
      const context=await browser.newContext({viewport:{width:scenario.width,height:scenario.height},deviceScaleFactor:scenario.dpr}),page=await context.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e)));
      await page.addInitScript(({best,selected})=>localStorage.setItem('jump-classic-offline-v1',JSON.stringify({best,records:[],prefs:{skin:selected,gameplayMode:'invincible'}})),scenario);
      await page.route(url,route=>route.fulfill({body:source,contentType:'text/html'}));await page.goto(url);await page.waitForFunction(()=>window.jumpDiagnostics);await page.locator('#home-skin').click();await page.evaluate(()=>document.fonts.ready);
      const actual=await candidate(page);await page.screenshot({path:path.join(output,`${version}-${scenario.width}x${scenario.height}-${scenario.selected}.png`)});
      const reference=await runReference(page,scenario.selected,scenario.best);await page.screenshot({path:path.join(output,`reference-${version}-${scenario.width}x${scenario.height}-${scenario.selected}.png`)});
      const differences=compare(actual,reference);assert.deepEqual(pageErrors,[]);assert.deepEqual(reference.loadErrors,[]);
      if(version==='baseline')assert.ok(differences.length>0,'Must reproduce existing layout differences');else assert.deepEqual(differences,[],'Must match executed historical geometry and states');
      results.push({version,scenario,actual,reference,differences});await context.close();
    }
    const report={passed:true,productSha256:sha(current),referenceCommit,referenceFiles:{'base.js':sha(base),'skin.js':sha(skin)},referencePlumbing:'Flat canvas layers replace Three.js upload and route plumbing; actual skin.js and coordinate/drawing functions execute.',goldSilverAssets:'Existing reconstructed previews supplied as offline fixtures, not claimed original server assets.',results};
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,scenarios:results.length,currentDifferences:results.filter(r=>r.version==='current').map(r=>r.differences),productSha256:report.productSha256,output},null,2));
  }finally{await browser.close();}
})();
