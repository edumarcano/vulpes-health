import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect,test } from '@playwright/test';
import { accounts,restrictNetwork,signIn } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';
const chatAccount=JSON.parse(process.env.VULPES_TEST_ACCOUNTS_JSON??'[]')[2] as {id:string;token:string};
test.beforeEach(async({page})=>{await restrictNetwork(page);});
async function scenario(page:import('@playwright/test').Page,mode:string) {
  await page.route('**/api/chat',route=>route.continue({headers:{...route.request().headers(),'x-vulpes-test-scenario':mode}}));
}
async function start(page:import('@playwright/test').Page) {
  await signIn(page,2);const created=page.waitForResponse(response=>response.url().endsWith('/api/conversations')&&response.request().postDataJSON()?.action==='create');
  await page.getByRole('button',{name:'New conversation',exact:true}).click();const id=(await (await created).json()).data.id;await expect(page).toHaveURL(new RegExp(`conversation=${id}`));await expect(page.getByLabel('Message Ask Vulpes',{exact:true})).toBeEnabled();
}
test('Ask synthetic imported-data journey persists, sanitizes evidence and fits the viewport/theme matrix',async({page})=>{
  const headers={Authorization:`Bearer ${chatAccount.token}`};
  const preview=await page.request.post('/api/data',{headers,data:{action:'preview_csv',client_request_id:randomUUID(),csv:readFileSync('docs/spec/v0.1.0/fixtures/measurements-synthetic.csv','utf8'),source:{kind:'new',label:'Synthetic Ask browser scale',origin_app:null,device_label:null},mapping:{schema_version:1,format:'canonical',timezone:'UTC',profile:null,single_profile:true,review_requested:false,source_label:'Synthetic Scale A'}}});
  expect(preview.status()).toBe(200);const p=(await preview.json()).data;
  expect((await page.request.post('/api/data',{headers,data:{action:'commit_import',batch_id:p.batch_id,payload_hash:p.payload_hash,client_request_id:randomUUID()}})).status()).toBe(200);
  let sends=0;page.on('request',req=>{if(req.url().endsWith('/api/chat')&&req.postDataJSON()?.action==='send')sends++;});
  await start(page);await page.getByLabel('Message Ask Vulpes',{exact:true}).fill('How has my imported weight changed?');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByText('Response saved.',{exact:true})).toBeVisible();await expect(page.getByText(/seven-day mean 69 kg; change -0.7 kg/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'Calculated measurement summary'})).toBeVisible();await expect(page.getByText(/Run completed · reported · \$0.003/)).toBeVisible();
  const inspectionResponse=page.waitForResponse(response=>response.url().includes('/api/executions?run=')&&response.status()===200);
  await page.getByRole('button',{name:'Inspect execution'}).click();const inspector=page.getByRole('dialog',{name:'Execution inspector'});const inspected=(await (await inspectionResponse).json()).data;
  await expect(inspector.getByRole('heading',{name:'Step 5: generation'})).toBeVisible();await expect(inspector.getByText(/RAG and web research were not used/)).toBeVisible();
  await expect(inspector.getByText('Model requested openai/gpt-6-luna, provider-reported unknown')).toHaveCount(3);
  await expect(inspector.getByText(/finish tool_calls \(adapter-normalized\)/)).toHaveCount(2);await expect(inspector.getByText(/finish stop \(adapter-normalized\)/)).toHaveCount(1);
  for(const [width,height] of [[360,800],[390,844],[430,932],[768,1024],[1440,900]] as const)for(const scheme of ['light','dark'] as const){await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:scheme,reducedMotion:'reduce'});await inspector.evaluate(element=>{element.scrollTop=0;});expect(await inspector.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await inspector.screenshot({path:`test-results/pr10-inspector-${width}-${scheme}.png`});}
  await page.setViewportSize({width:390,height:844});const zoom=await page.addStyleTag({content:'html{font-size:200%}'});expect(await inspector.evaluate(element=>element.scrollWidth<=element.clientWidth)).toBe(true);await zoom.evaluate(element=>element.parentNode?.removeChild(element));
  await page.setViewportSize({width:1280,height:720});
  const first=inspector.locator('.inspection-step').first();await first.getByRole('button',{name:'Load input'}).click();await expect(first.locator('pre').filter({hasText:'"model"'}).first()).toBeVisible();
  page.once('dialog',dialog=>void dialog.dismiss());await first.getByRole('button',{name:'Export exact bytes'}).click();
  page.once('dialog',dialog=>void dialog.accept());const downloaded=page.waitForEvent('download');await first.getByRole('button',{name:'Export exact bytes'}).click();const file=await downloaded;
  const expected=await page.request.get(`/api/executions?view=export&run=${inspected.run.id}&step=${inspected.steps[0].id}&part=input`,{headers});
  expect(readFileSync((await file.path())!)).toEqual(await expected.body());
  await page.context().grantPermissions(['clipboard-read','clipboard-write']);page.once('dialog',dialog=>void dialog.accept());
  await first.getByRole('button',{name:'Copy exact text'}).click();await expect(first.getByText('Copied exact text.')).toBeVisible();
  expect(Buffer.from(await page.evaluate(()=>navigator.clipboard.readText()),'utf8')).toEqual(await expected.body());
  await first.getByRole('button',{name:'Load context'}).click();await expect(first.getByRole('heading',{name:'Included'})).toBeVisible();
  const summaryStep=inspector.locator('.inspection-step').filter({has:page.getByRole('heading',{name:/summarize_metric/})});await summaryStep.getByRole('button',{name:'Load output'}).click();await expect(summaryStep.getByRole('heading',{name:'Calculation and sources'})).toBeVisible();await expect(summaryStep.getByText(/7 valid days/)).toBeVisible();
  await inspector.getByRole('button',{name:'Close'}).focus();await page.keyboard.press('Escape');await expect(inspector).toHaveCount(0);await expect(page.getByRole('button',{name:'Inspect execution'})).toBeFocused();
  expect(await page.locator('.skip-link').evaluate(element=>element.getBoundingClientRect().bottom<=0)).toBe(true);
  expect(sends).toBe(1);await page.reload();await expect(page.getByText(/seven-day mean 69 kg; change -0.7 kg/)).toBeVisible();expect(sends).toBe(1);
  for(const [width,height] of [[360,800],[390,844],[430,932],[768,1024],[1440,900]])for(const colorScheme of ['light','dark'] as const) {
    await page.setViewportSize({width:width!,height:height!});await page.emulateMedia({colorScheme,reducedMotion:'reduce'});
    await expect(page.getByLabel('Message Ask Vulpes')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    const viewport=await page.locator('.conversation-viewport').boundingBox();const composer=await page.locator('.composer-area').boundingBox();expect(composer!.y).toBeGreaterThanOrEqual(viewport!.y+viewport!.height-1);
    await page.getByLabel('Message Ask Vulpes').scrollIntoViewIfNeeded();await expect(page.getByLabel('Message Ask Vulpes')).toBeInViewport();
    await page.screenshot({path:`test-results/ask-${width}x${height}-${colorScheme}.png`,fullPage:true});
  }
  await page.setViewportSize({width:390,height:844});await page.addStyleTag({content:'html{font-size:200%}'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByLabel('Message Ask Vulpes').focus();await expect(page.getByLabel('Message Ask Vulpes')).toBeFocused();
});
test('Ask reads retained message state when replayed execution metadata has expired',async({page})=>{
  await start(page);
  const sent=page.waitForRequest(request=>request.url().endsWith('/api/chat')&&request.postDataJSON()?.action==='send');
  await page.getByLabel('Message Ask Vulpes',{exact:true}).fill('Can you diagnose my synthetic symptoms?');await page.getByRole('button',{name:'Send',exact:true}).click();
  const input=(await sent).postDataJSON();await expect(page.getByText('Response saved.',{exact:true})).toBeVisible();
  const db=new LocalSupabase();await db.admin(`/rest/v1/ai_runs?user_id=eq.${chatAccount.id}&client_request_id=eq.${input.client_request_id}`,'PATCH',{expires_at:new Date(Date.now()-1000).toISOString()});
  const headers={Authorization:`Bearer ${chatAccount.token}`};
  const before=(await(await page.request.get(`/api/conversations?view=messages&id=${input.conversation_id}`,{headers})).json()).data;
  expect(before.run).toBeNull();expect(before.items).toHaveLength(2);
  await page.route('**/api/chat',route=>route.continue({postData:JSON.stringify(input)}));
  const replay=page.waitForResponse(response=>response.url().endsWith('/api/chat'));
  await page.getByLabel('Message Ask Vulpes',{exact:true}).fill(input.message.text);await page.getByRole('button',{name:'Send',exact:true}).click();
  expect((await(await replay).json()).data).toEqual({kind:'retained',conversationId:input.conversation_id,message:{id:input.message.id,status:'completed'}});
  await expect(page.getByText('This request already exists or another run is active. Reading saved state.',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Message Ask Vulpes',{exact:true})).toBeEnabled();
  const after=(await(await page.request.get(`/api/conversations?view=messages&id=${input.conversation_id}`,{headers})).json()).data;
  expect(after.items).toEqual(before.items);expect(after.run).toBeNull();
});

test('Ask preserves a truncated prefix and offers an explicit new request',async({page})=>{
  await scenario(page,'truncated');await start(page);await page.getByLabel('Message Ask Vulpes').fill('Synthetic interrupted question');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByText('Durable synthetic prefix 🦊',{exact:true})).toBeVisible();await expect(page.getByText('Incomplete response',{exact:true})).toBeVisible();await expect(page.getByText(/Total cost unknown/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Send again as a new request (may incur another charge)',exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Durable synthetic prefix 🦊',{exact:true})).toBeVisible();await expect(page.getByText('Incomplete response',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Inspect execution'}).click();const inspector=page.getByRole('dialog',{name:'Execution inspector'});await expect(inspector.getByText(/incomplete observed prefix/)).toBeVisible();await inspector.getByRole('button',{name:'Close'}).click();
  await scenario(page,'complete');await page.getByRole('button',{name:'Send again as a new request (may incur another charge)',exact:true}).click();await expect(page.getByText('Response saved.',{exact:true})).toBeVisible();await expect(page.locator('.chat-message .chat-text').getByText('Synthetic interrupted question',{exact:true})).toHaveCount(2);
});
test('Ask reload during a stream reads the saved prefix without resending',async({page})=>{
  let sends=0;page.on('request',req=>{if(req.url().endsWith('/api/chat')&&req.postDataJSON()?.action==='send')sends++;});await scenario(page,'slow');await start(page);await page.getByLabel('Message Ask Vulpes').fill('Synthetic reload during output');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('Saved synthetic partial response.',{exact:true})).toBeVisible();
  await page.reload();await expect(page.getByText('Saved synthetic partial response.',{exact:true})).toBeVisible();await expect(page.getByText('Incomplete response',{exact:true})).toBeVisible();expect(sends).toBe(1);
});
test('Ask stop and reload retain partial output without inference replay',async({page})=>{
  let sends=0;page.on('request',req=>{if(req.url().endsWith('/api/chat')&&req.postDataJSON()?.action==='send')sends++;});await scenario(page,'slow');await start(page);
  await page.getByLabel('Message Ask Vulpes').fill('Synthetic slow response');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('Saved synthetic partial response.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Stop',exact:true}).click();await expect(page.getByText(/Run cancelled/)).toBeVisible();await expect(page.getByText('Incomplete response',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Saved synthetic partial response.',{exact:true})).toBeVisible();expect(sends).toBe(1);
});
test('Ask renders provider HTML, unsafe links, and fabricated references as inert text',async({page})=>{
  await scenario(page,'unsafe_text');await start(page);await page.getByLabel('Message Ask Vulpes').fill('Synthetic rendering check');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('Response saved.',{exact:true})).toBeVisible();
  await expect(page.getByText(/<img src=x onerror=alert/)).toBeVisible();expect(await page.locator('.chat-message img,.chat-message script,.chat-message a[href^="javascript:"]').count()).toBe(0);expect(await page.getByRole('heading',{name:'Calculated measurement summary'}).count()).toBe(0);
});
test('Ask account switching discards the pending stream and private history',async({page})=>{
  await scenario(page,'slow');await start(page);await page.getByLabel('Message Ask Vulpes').fill('Private synthetic account A question');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('Saved synthetic partial response.',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Inspect execution'}).click();await expect(page.getByRole('dialog',{name:'Execution inspector'})).toBeVisible();
  // Sign out in a second tab while the first tab's stream is still pending.
  const settings=await page.context().newPage();await restrictNetwork(settings);await settings.goto('/settings');await settings.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Vulpes',exact:true})).toBeVisible();await settings.close();
  await expect(page.getByRole('dialog',{name:'Execution inspector'})).toHaveCount(0);
  await signIn(page,1);await expect(page.getByText('Private synthetic account A question',{exact:true})).toHaveCount(0);await expect(page.getByText('Saved synthetic partial response.',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Message Ask Vulpes')).toBeDisabled();
  expect(accounts[1]!.id).not.toBe(accounts[2]!.id);
});
test('Ask has no depth selector; history archive and confirmed deletion use the real API',async({page})=>{
  await start(page);await expect(page.getByLabel('Analysis depth',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Archive conversation',exact:true}).click();await page.getByLabel('Archived',{exact:true}).check();await expect(page.getByLabel('Message Ask Vulpes')).toBeDisabled();
  await page.getByText('Delete conversation',{exact:true}).click();await page.getByRole('button',{name:'Confirm delete conversation',exact:true}).click();await expect(page.getByText('Conversation deleted.',{exact:true})).toBeVisible();
});
test('Ask conversation mutation failures stay in the UI without an unhandled rejection',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,2);
  await page.route('**/api/conversations',async route=>{if(route.request().method()==='POST')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'conversations_unavailable',message:'Synthetic conversation storage unavailable.',retryable:false},request_id:randomUUID()})});else await route.continue();});
  await page.getByRole('button',{name:'New conversation',exact:true}).click();await expect(page.getByText('Synthetic conversation storage unavailable.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'New conversation',exact:true})).toBeEnabled();expect(errors).toEqual([]);
});

test('mobile inspector remains open across the final persisted-message refresh',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({colorScheme:'light',reducedMotion:'reduce'});
 const headers={Authorization:`Bearer ${chatAccount.token}`};
 const preview=await page.request.post('/api/data',{headers,data:{action:'preview_csv',client_request_id:randomUUID(),csv:readFileSync('docs/spec/v0.1.0/fixtures/measurements-synthetic.csv','utf8'),source:{kind:'new',label:'Synthetic inspector refresh',origin_app:null,device_label:null},mapping:{schema_version:1,format:'canonical',timezone:'UTC',profile:null,single_profile:true,review_requested:false,source_label:'Synthetic Scale A'}}});
 expect(preview.status()).toBe(200);const p=(await preview.json()).data;
 expect((await page.request.post('/api/data',{headers,data:{action:'commit_import',batch_id:p.batch_id,payload_hash:p.payload_hash,client_request_id:randomUUID()}})).status()).toBe(200);
 await start(page);
 let release!:()=>void;let reached!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const held=new Promise<void>(resolve=>{reached=resolve;});let captured=false;let heldUrl='';
 await page.route('**/api/conversations?*',async route=>{
  if(!captured&&new URL(route.request().url()).searchParams.get('view')==='messages'){
   captured=true;heldUrl=route.request().url();const response=await route.fetch();reached();await gate;await route.fulfill({response}).catch(()=>undefined);
  }else await route.continue();
 });
 try{
  await page.getByLabel('Message Ask Vulpes',{exact:true}).fill('How has my imported weight changed?');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByText('Response saved.',{exact:true})).toBeVisible();await held;
  await page.getByRole('button',{name:'Inspect execution',exact:true}).click();
  const inspector=page.getByRole('dialog',{name:'Execution inspector'});await expect(inspector.getByRole('heading',{name:'Step 5: generation'})).toBeVisible();
  const refreshed=page.waitForResponse(r=>r.url()===heldUrl);release();expect((await refreshed).status()).toBe(200);
  await expect(page.getByText(/Run completed · reported/)).toBeVisible();await expect(inspector).toBeVisible();
 }finally{release();}
});
