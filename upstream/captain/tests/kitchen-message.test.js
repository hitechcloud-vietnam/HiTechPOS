const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('general voice note records without an order and retries the same upload after an ambiguous response',async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:360,height:780}});
  await page.route('https://voice.test/',r=>r.fulfill({contentType:'text/html',body:fs.readFileSync('kitchen-message.html','utf8').replace(/<script[\s\S]*?<\/script>/g,'')}));
  await page.goto('https://voice.test/');
  await page.evaluate(()=>{
   localStorage.setItem('branch_id','branch');window.calls=[];window.failOnce=true;
   window.POSNIC={session:{shopKey:'shop',user:{id:'staff'}},api:{post:async(path,body)=>{calls.push({path,body});if(path.endsWith('/archive'))return {id:body.id,stored:true,storage:'server'};if(path.endsWith('/recordings'))return {recordings:[]};if(path.endsWith('/status'))return {jobs:[]};if(path.endsWith('/start'))return {id:'same-message'};if(failOnce){failOnce=false;throw Error('Connection lost');}return {id:body.id,queued:true};}}};
   Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>({getTracks:()=>[{stop(){}}]})}});
   window.MediaRecorder=class{constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';this.ondataavailable({data:new Blob(['test'],{type:'audio/webm'})});this.onstop();}};
  });
  await page.addScriptTag({path:'assets/common/voice-recorder.js'});
  await page.addScriptTag({path:'assets/common/kitchen-message.js'});
  await page.getByRole('button',{name:'Record voice note',exact:true}).click();
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();
  await page.getByRole('button',{name:'Send to kitchen',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('voice-error').textContent.includes('Kitchen delivery is not confirmed'));
  await page.getByRole('button',{name:'Send to kitchen',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('voice-status').textContent==='Queued for playback');
  const calls=await page.evaluate(()=>calls);
  assert.equal(calls.filter(c=>c.path.endsWith('/start')).length,1);
  assert.deepEqual(calls.filter(c=>c.path.endsWith('/voice')).map(c=>c.body.id),['same-message','same-message']);
  assert.ok(calls.every(c=>!c.body.orderId));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Record voice note',exact:true}).click();
  await page.getByRole('button',{name:'Pause recording',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('voice-send').hidden===false);
  await page.evaluate(()=>{POSNIC.session.user.id='other';});
  const before=await page.evaluate(()=>calls.length);
  await page.getByRole('button',{name:'Send to kitchen',exact:true}).click();
  assert.equal(await page.evaluate(()=>calls.length),before,'old staff recording never uploads as a different staff member');
 }finally{await browser.close();}
});
