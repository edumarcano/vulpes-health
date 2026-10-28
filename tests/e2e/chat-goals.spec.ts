import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test,expect,type Page } from '@playwright/test';
import { accounts,restrictNetwork,signIn } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';
const account=JSON.parse(process.env.VULPES_TEST_ACCOUNTS_JSON??'[]')[3] as {id:string;token:string};
const headers=()=>({Authorization:`Bearer ${account.token}`});
const fixture=readFileSync('docs/spec/v0.1.0/fixtures/measurements-synthetic.csv');
async function scenario(page:Page,value:string){await page.route('**/api/chat',route=>route.continue({headers:{...route.request().headers(),'x-vulpes-test-scenario':value}}));}
async function say(page:Page,text:string){await page.getByLabel('Message Ask Vulpes',{exact:true}).fill(text);await page.getByRole('button',{name:'Send',exact:true}).click();await expect(page.getByText('Response saved.',{exact:true})).toBeVisible();}
async function imported(page:Page){
 const preview=await page.request.post('/api/data',{headers:headers(),data:{action:'preview_csv',client_request_id:randomUUID(),csv:fixture.toString(),source:{kind:'new',label:'Synthetic M4 browser',origin_app:null,device_label:null},mapping:{schema_version:1,format:'canonical',timezone:'UTC',profile:null,single_profile:true,review_requested:false,source_label:'Synthetic Scale A'}}});expect(preview.status()).toBe(200);const p=(await preview.json()).data;expect((await page.request.post('/api/data',{headers:headers(),data:{action:'commit_import',batch_id:p.batch_id,payload_hash:p.payload_hash,client_request_id:randomUUID()}})).status()).toBe(200);return p.source_id as string;
}
async function start(page:Page){await signIn(page,3);await page.getByRole('button',{name:'New conversation',exact:true}).click();await expect(page.getByLabel('Message Ask Vulpes',{exact:true})).toBeEnabled();}
test.beforeEach(async({page})=>{await restrictNetwork(page);});
test.afterEach(async()=>{const db=new LocalSupabase();await db.admin(`/rest/v1/goals?user_id=eq.${account.id}`,'PATCH',{state:'draft',current_revision_id:null});for(const table of ['goal_revisions','action_proposals','goals'])await db.admin(`/rest/v1/${table}?user_id=eq.${account.id}`,'DELETE');});

test('Ask goal proposal journey imports, reviews, approves, calculates progress and reloads without extra inference',async({page},info)=>{
 await signIn(page,3);await page.goto('/data');await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:'synthetic-m4.csv',mimeType:'text/csv',buffer:fixture});await page.getByLabel('Import source label',{exact:true}).fill('Synthetic M4 browser');await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await page.getByLabel('I confirm this file contains one profile',{exact:true}).check();
 const preview=page.waitForResponse(r=>r.url().endsWith('/api/data')&&r.request().postDataJSON()?.action==='preview_csv');await page.getByRole('button',{name:'Preview CSV',exact:true}).click();const source=(await(await preview).json()).data.source_id;await page.getByRole('button',{name:'Confirm import',exact:true}).click();await expect(page.getByRole('heading',{name:'Import recorded',exact:true})).toBeVisible();
 let sends=0;page.on('request',r=>{if(r.url().endsWith('/api/chat')&&r.postDataJSON()?.action==='send')sends++;});await page.goto('/ask');await scenario(page,'goal_create');await page.getByRole('button',{name:'New conversation',exact:true}).click();await expect(page.getByLabel('Message Ask Vulpes',{exact:true})).toBeEnabled();await say(page,`Propose a weight target using source:${source}`);
 const review=page.getByRole('region',{name:'Review goal proposal'});await expect(review).toContainText('69.7');await expect(review).toContainText('68 kg');await expect(review).toContainText('pending');const db=new LocalSupabase();expect(await(await db.admin(`/rest/v1/goals?user_id=eq.${account.id}`,'GET')).json()).toHaveLength(0);
 await page.getByRole('button',{name:'Inspect execution',exact:true}).click();const inspector=page.getByRole('dialog',{name:'Execution inspector'});await expect(inspector.getByRole('heading',{name:/propose_goal/})).toBeVisible();await inspector.getByRole('button',{name:'Close',exact:true}).click();
 const chatUrl=page.url();await page.reload();await expect(review).toContainText('pending');expect(sends).toBe(1);
 await scenario(page,'goal_yes');await say(page,'yes, approve it');await expect(page.getByText(/Your message alone applies no change/)).toBeVisible();expect(await(await db.admin(`/rest/v1/goals?user_id=eq.${account.id}`,'GET')).json()).toHaveLength(0);expect(sends).toBe(2);
 await review.getByRole('button',{name:'Approve goal proposal',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByText('Goal approved.',{exact:true})).toBeFocused();await expect(review).toContainText('approved');expect(sends).toBe(2);await page.getByRole('link',{name:'Open approved goal',exact:true}).click();await expect(page.getByRole('heading',{name:'Synthetic chat goal',exact:true}).first()).toBeInViewport();await expect(page.getByRole('heading',{name:'Revision history',exact:true})).toBeVisible();await expect(page.getByText(/Revision 1 ·/)).toBeVisible();
 const today=new Date().toISOString().slice(0,10);const csv='observed_at,metric,value,unit,source,granularity,external_record_id,local_date,timezone,method\n'+[2,1,0].map((offset,index)=>`${new Date(Date.parse(today)-offset*86400000).toISOString().slice(0,10)}T08:00:00Z,weight,${['68.9','68.8','68.7'][index]},kg,Synthetic Scale A,instant,m4-browser-${index},,UTC,device_reported`).join('\n')+'\n';
 const p=await page.request.post('/api/data',{headers:headers(),data:{action:'preview_csv',client_request_id:randomUUID(),csv,source:{kind:'existing',id:source},mapping:{schema_version:1,format:'canonical',timezone:'UTC',profile:null,single_profile:true,review_requested:false,source_label:'Synthetic Scale A'}}});expect(p.status()).toBe(200);const next=(await p.json()).data;expect((await page.request.post('/api/data',{headers:headers(),data:{action:'commit_import',batch_id:next.batch_id,payload_hash:next.payload_hash,client_request_id:randomUUID()}})).status()).toBe(200);
 await page.reload();await expect(page.getByRole('region',{name:'Goal progress',exact:true})).toContainText('Current: 68.8');await page.screenshot({path:info.outputPath('m4-goal-progress.png'),fullPage:true});expect(sends).toBe(2);
 await page.goto(chatUrl);await scenario(page,'goal_revise');await say(page,'Propose revising my goal target to 67 kg.');const revision=page.getByRole('region',{name:'Review goal proposal'}).filter({hasText:'pending'});await expect(revision.getByRole('heading',{name:'Before',exact:true})).toBeVisible();await expect(revision).toContainText('67 kg');await revision.getByRole('button',{name:'Approve goal proposal',exact:true}).click();await expect(page.getByRole('region',{name:'Review goal proposal'}).last()).toContainText('approved');expect(sends).toBe(3);await page.reload();await expect(page.getByRole('button',{name:'Approve goal proposal',exact:true})).toHaveCount(0);expect(sends).toBe(3);
 for(const width of [360,768,1440])for(const colorScheme of ['light','dark'] as const){await page.setViewportSize({width,height:900});await page.emulateMedia({colorScheme,reducedMotion:'reduce'});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}await page.screenshot({path:info.outputPath('m4-chat-approved.png'),fullPage:true});
});
test('Ask goal proposal rejection and stale data show terminal status on reload',async({page})=>{
 const source=await imported(page);await scenario(page,'goal_create');await start(page);await say(page,`Propose using source:${source}`);const review=page.getByRole('region',{name:'Review goal proposal'});await review.getByRole('button',{name:'Reject goal proposal',exact:true}).click();await expect(review).toContainText('rejected');await page.reload();await expect(review).toContainText('rejected');await expect(review.getByRole('button',{name:'Approve goal proposal',exact:true})).toHaveCount(0);
 await say(page,`Propose again using source:${source}`);const pending=page.getByRole('region',{name:'Review goal proposal'}).filter({hasText:'pending'});await expect(pending).toBeVisible();const db=new LocalSupabase();const profile=(await(await db.admin(`/rest/v1/profiles?user_id=eq.${account.id}`,'GET')).json())[0];await db.admin(`/rest/v1/profiles?user_id=eq.${account.id}`,'PATCH',{data_revision:profile.data_revision+1});await page.reload();await expect(page.getByRole('region',{name:'Review goal proposal'}).filter({hasText:'conflicted'})).toBeVisible();await expect(page.getByRole('button',{name:'Approve goal proposal',exact:true})).toHaveCount(0);
});
test('Ask goal proposal account switch discards a delayed owned card response',async({page})=>{
 await test.step('Create an owned pending proposal',async()=>{
  const source=await imported(page);await scenario(page,'goal_create');await start(page);await say(page,`Propose using source:${source}`);
  await expect(page.getByRole('button',{name:'Approve goal proposal',exact:true})).toBeVisible();
 });
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 let responseState='not requested';let settings:Page|undefined;
 await page.route('**/api/goals?view=proposal*',async route=>{
  responseState='fetching';const response=await route.fetch();responseState='held';await gate;
  await route.fulfill({response}).catch(()=>undefined);
 });
 try{
  await test.step('Reload and hold the restored proposal response',async()=>{
   await page.reload({waitUntil:'domcontentloaded'});
   await expect.poll(()=>responseState,{message:'The restored proposal response must reach the barrier'}).toBe('held');
  });
  await test.step('Sign out in another tab while the response is held',async()=>{
   settings=await page.context().newPage();await restrictNetwork(settings);await settings.goto('/settings');
   await settings.getByRole('button',{name:'Sign out',exact:true}).click();
   await expect(page.getByRole('heading',{name:'Sign in to Vulpes',exact:true})).toBeVisible();
  });
  await test.step('Release the old response and verify the other account is clear',async()=>{
   release();await settings!.close();await signIn(page,1);
   await expect(page.getByRole('button',{name:'Approve goal proposal',exact:true})).toHaveCount(0);
   await expect(page.getByRole('heading',{name:'Synthetic chat goal',exact:true})).toHaveCount(0);
   expect(accounts[1]!.id).not.toBe(account.id);
  });
 }finally{release();await settings?.close();}
});
