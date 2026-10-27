import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect,test } from '@playwright/test';
import { accounts,restrictNetwork,signIn } from './auth-helpers';
const chatAccount=JSON.parse(process.env.VULPES_TEST_ACCOUNTS_JSON??'[]')[2] as {token:string};
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
test('Ask preserves a truncated prefix and offers an explicit new request',async({page})=>{
  await scenario(page,'truncated');await start(page);await page.getByLabel('Message Ask Vulpes').fill('Synthetic interrupted question');await page.getByRole('button',{name:'Send',exact:true}).click();
  await expect(page.getByText('Durable synthetic prefix 🦊',{exact:true})).toBeVisible();await expect(page.getByText('Incomplete response',{exact:true})).toBeVisible();await expect(page.getByText(/Total cost unknown/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Send again as a new request (may incur another charge)',exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Durable synthetic prefix 🦊',{exact:true})).toBeVisible();await expect(page.getByText('Incomplete response',{exact:true})).toBeVisible();
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
  // Sign out in a second tab while the first tab's stream is still pending.
  const settings=await page.context().newPage();await restrictNetwork(settings);await settings.goto('/settings');await settings.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Vulpes',exact:true})).toBeVisible();await settings.close();
  await signIn(page,1);await expect(page.getByText('Private synthetic account A question',{exact:true})).toHaveCount(0);await expect(page.getByText('Saved synthetic partial response.',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Message Ask Vulpes')).toBeDisabled();
  expect(accounts[1]!.id).not.toBe(accounts[2]!.id);
});
test('Ask unavailable depths, history archive, and confirmed deletion use the real API',async({page})=>{
  await start(page);await page.getByLabel('Analysis depth',{exact:true}).selectOption('advanced');await page.getByLabel('Message Ask Vulpes').fill('Synthetic unavailable depth');await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText(/This analysis depth is unavailable/)).toBeVisible();
  await page.getByRole('button',{name:'Archive conversation',exact:true}).click();await page.getByLabel('Archived',{exact:true}).check();await expect(page.getByLabel('Message Ask Vulpes')).toBeDisabled();
  await page.getByText('Delete conversation',{exact:true}).click();await page.getByRole('button',{name:'Confirm delete conversation',exact:true}).click();await expect(page.getByText('Conversation deleted.',{exact:true})).toBeVisible();
});
test('Ask conversation mutation failures stay in the UI without an unhandled rejection',async({page})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await signIn(page,2);
  await page.route('**/api/conversations',async route=>{if(route.request().method()==='POST')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'conversations_unavailable',message:'Synthetic conversation storage unavailable.',retryable:false},request_id:randomUUID()})});else await route.continue();});
  await page.getByRole('button',{name:'New conversation',exact:true}).click();await expect(page.getByText('Synthetic conversation storage unavailable.',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'New conversation',exact:true})).toBeEnabled();expect(errors).toEqual([]);
});
