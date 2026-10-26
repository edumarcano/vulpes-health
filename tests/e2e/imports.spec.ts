import { readFileSync } from 'node:fs';
import { expect,test,type Page } from '@playwright/test';
import { accounts,restrictNetwork,signIn } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';
const canonical=readFileSync('docs/spec/v0.1.0/fixtures/measurements-synthetic.csv');
const wide=readFileSync('docs/spec/v0.1.0/fixtures/wide-synthetic.csv');
async function clear(){const db=new LocalSupabase();for(const a of accounts)for(const table of ['audit_events','measurements','import_batches','private_payloads','data_sources'])await db.admin(`/rest/v1/${table}?user_id=eq.${a.id}`,'DELETE');}
test.beforeEach(async({page})=>{await clear();await restrictNetwork(page);await signIn(page);await page.goto('/data');await expect(page.getByRole('heading',{name:'Import CSV',exact:true})).toBeVisible();});
test.afterEach(clear);
async function choose(page:Page,buffer=canonical){await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer});await expect(page.getByText('Selected: synthetic.csv',{exact:true})).toBeVisible();await page.getByLabel('Import source label',{exact:true}).fill('Synthetic imported scale');await page.getByLabel('I confirm this file contains one profile',{exact:true}).check();}
async function preview(page:Page){const r=page.waitForResponse(r=>r.url().endsWith('/api/data') && r.request().method()==='POST');await page.getByRole('button',{name:'Preview CSV',exact:true}).click();expect((await r).status()).toBe(200);await expect(page.getByRole('region',{name:'Confirm CSV import',exact:true})).toBeVisible();}
async function confirm(page:Page){const r=page.waitForResponse(r=>r.url().endsWith('/api/data') && r.request().method()==='POST');await page.getByRole('button',{name:'Confirm import',exact:true}).click();const response=await r;expect(response.status()).toBe(200);await expect(page.getByRole('heading',{name:'Import recorded',exact:true})).toBeFocused();return (await response.json() as {data:{source_id:string}}).data.source_id;}
test('canonical CSV imports exactly 28 and reimport returns the historical outcome with AI disabled',async({page})=>{
  const calls:string[]=[];page.on('request',r=>{if(/\/api\/(chat|goals|approvals|executions)/.test(r.url()))calls.push(r.url());});await choose(page);await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await preview(page);
  await expect(page.getByRole('button',{name:'Confirm import',exact:true})).toBeFocused();await expect(page.getByRole('region',{name:'Confirm CSV import',exact:true})).toContainText('28 new; 0 duplicates; 0 conflicts');await expect(page.getByRole('heading',{name:'No measurements loaded',exact:true})).toBeVisible();
  const source=await confirm(page);await page.getByLabel('Method',{exact:true}).selectOption('device_reported');await page.getByLabel('From date',{exact:true}).fill('2026-09-01');await page.getByLabel('Through date',{exact:true}).fill('2026-09-14');await expect(page.getByTestId('headline-value')).toHaveText('69 kg');
  await page.reload();await page.getByLabel('Method',{exact:true}).selectOption('device_reported');await page.getByLabel('From date',{exact:true}).fill('2026-09-01');await page.getByLabel('Through date',{exact:true}).fill('2026-09-14');await expect(page.getByTestId('headline-value')).toHaveText('69 kg');
  await page.getByLabel('CSV file',{exact:true}).setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:canonical});await expect(page.getByText('Selected: synthetic.csv',{exact:true})).toBeVisible();await page.getByRole('combobox',{name:'Import source',exact:true}).selectOption(source);await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await page.getByLabel('I confirm this file contains one profile',{exact:true}).check();await page.getByRole('button',{name:'Preview CSV',exact:true}).click();await expect(page.getByRole('heading',{name:'Import recorded',exact:true})).toBeVisible();expect(calls).toEqual([]);
  const db=new LocalSupabase();expect(await(await db.admin(`/rest/v1/measurements?source_id=eq.${source}&select=id`,'GET')).json()).toHaveLength(28);
});
test('wide mapping exposes five exact observations, ignored columns and a missing value',async({page})=>{
  await choose(page,wide);await expect(page.getByRole('combobox',{name:'CSV format',exact:true})).toHaveValue('wide');await page.getByRole('combobox',{name:'Metric for Mass (lb)',exact:true}).selectOption('weight');await page.getByRole('combobox',{name:'Unit for Mass (lb)',exact:true}).selectOption('lb');await page.getByRole('combobox',{name:'Method for Mass (lb)',exact:true}).selectOption('device_reported');await page.getByRole('combobox',{name:'Metric for Fat (%)',exact:true}).selectOption('body_fat_percent');await page.getByRole('combobox',{name:'Method for Fat (%)',exact:true}).selectOption('device_estimate');await preview(page);
  const region=page.getByRole('region',{name:'Confirm CSV import',exact:true});await expect(region).toContainText('5 new');await expect(region).toContainText('1 blank cells skipped');await expect(region).toContainText('Ignored columns: Notes');await expect(region).toContainText('68.0388555 kg');await confirm(page);
});

test('second-60 CSV rows are excluded visibly and the valid boundary row commits unchanged',async({page},info)=>{
  const csv='observed_at,metric,value,unit,source,granularity,timezone,method\n2026-09-01T23:59:60Z,weight,70,kg,Synthetic Scale A,instant,UTC,device_reported\n2026-09-01T23:59:59.123456Z,weight,69,kg,Synthetic Scale A,instant,UTC,device_reported';
  await choose(page,Buffer.from(csv));await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await preview(page);
  const region=page.getByRole('region',{name:'Confirm CSV import',exact:true});await expect(region).toContainText('1 new; 0 duplicates; 0 conflicts excluded; 1 invalid');
  await expect(region).toContainText('Row 2');await expect(region.getByRole('table')).toContainText('2026-09-01T23:59:59.123456Z');
  await page.screenshot({path:info.outputPath('second-60-csv-preview.png'),fullPage:true});
  const source=await confirm(page);await page.getByLabel('Method',{exact:true}).selectOption('device_reported');
  await page.getByLabel('From date',{exact:true}).fill('2026-09-01');await page.getByLabel('Through date',{exact:true}).fill('2026-09-01');
  await expect(page.getByRole('table')).toContainText('2026-09-01T23:59:59.123456+00:00');await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  const db=new LocalSupabase();expect(await(await db.admin(`/rest/v1/measurements?source_id=eq.${source}&select=observed_at`,'GET')).json()).toEqual([{observed_at:'2026-09-01T23:59:59.123456+00:00'}]);
});
test('profile exclusion, invalid rows and altered values remain explicit before confirmation',async({page})=>{
  const rows=canonical.toString().trim().split(/\r?\n/);const csv=[rows[0]+',Profile',rows[1]+',A',rows[2]+',B',rows[1]!.replace('70.0','71.0')+',A',rows[3]!.replace('69.9','NaN')+',A'].join('\n');await choose(page,Buffer.from(csv));await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await page.getByRole('combobox',{name:'Profile column',exact:true}).selectOption('Profile');await page.getByLabel('Profile value to include',{exact:true}).fill('A');await preview(page);
  const region=page.getByRole('region',{name:'Confirm CSV import',exact:true});await expect(region).toContainText('2 conflicts excluded; 1 invalid');await expect(region).toContainText('1 profile-excluded rows');await confirm(page);await expect(page.getByRole('status').filter({hasText:'Historical batch outcome'})).toContainText('0 inserted');
});
test('failed preview and expired commit show errors without inventing success',async({page})=>{
  await choose(page);await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await page.route('**/api/data',route=>route.request().postData()?.includes('preview_csv') ? route.abort() : route.continue());await page.getByRole('button',{name:'Preview CSV',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await page.unroute('**/api/data');await preview(page);
  const db=new LocalSupabase();await db.admin(`/rest/v1/import_batches?user_id=eq.${accounts[0]!.id}`,'PATCH',{created_at:new Date(Date.now()-120000).toISOString(),expires_at:new Date(Date.now()-60000).toISOString()});await page.getByRole('button',{name:'Confirm import',exact:true}).click();await expect(page.getByRole('alert')).toContainText('expired');await expect(page.getByRole('heading',{name:'Import recorded',exact:true})).toHaveCount(0);
});
test('canonical CSV imports can create a fresh preview after discarding an expired one',async({page})=>{
  await choose(page);await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await preview(page);
  const db=new LocalSupabase();await db.admin(`/rest/v1/import_batches?user_id=eq.${accounts[0]!.id}`,'PATCH',{created_at:new Date(Date.now()-120000).toISOString(),expires_at:new Date(Date.now()-60000).toISOString()});await page.getByRole('button',{name:'Confirm import',exact:true}).click();await expect(page.getByRole('alert')).toContainText('expired');
  await page.getByRole('button',{name:'Discard preview and choose file',exact:true}).click();await choose(page);await preview(page);await confirm(page);
});
test('account switch discards the file and pending preview',async({page})=>{
  await choose(page);await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await preview(page);await page.getByRole('navigation').getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await signIn(page,1);await page.goto('/data');await expect(page.getByRole('region',{name:'Confirm CSV import',exact:true})).toHaveCount(0);await expect(page.getByLabel('Import source label',{exact:true})).toHaveValue('');await expect(page.getByLabel('CSV file',{exact:true})).toHaveValue('');
});
test('canonical CSV imports retry a lost preview reply without creating another source',async({page})=>{
  await choose(page);await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');let lost=false;
  await page.route('**/api/data',async route=>{if(!lost && route.request().postData()?.includes('preview_csv')){lost=true;expect((await route.fetch()).status()).toBe(200);await route.abort();}else await route.continue();});
  await page.getByRole('button',{name:'Preview CSV',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await preview(page);await confirm(page);
  const db=new LocalSupabase();expect(await(await db.admin(`/rest/v1/data_sources?user_id=eq.${accounts[0]!.id}&select=id`,'GET')).json()).toHaveLength(1);
});
test('canonical CSV imports preserve source warning text as inert data',async({page})=>{
  const lines=canonical.toString().trim().split(/\r?\n/);await choose(page,Buffer.from(lines[0]+',quality_flags\n'+lines[1]+',<script>synthetic-warning</script>'));await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await preview(page);await confirm(page);
  await page.getByLabel('Method',{exact:true}).selectOption('device_reported');await page.getByLabel('From date',{exact:true}).fill('2026-09-01');await page.getByLabel('Through date',{exact:true}).fill('2026-09-14');await expect(page.getByRole('table')).toContainText('<script>synthetic-warning</script>');expect(await page.locator('script').filter({hasText:'synthetic-warning'}).count()).toBe(0);
});
for(const action of ['preview_csv','commit_import'])test(`account change discards late ${action} completion`,async({page})=>{
  await choose(page);await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');if(action==='commit_import')await preview(page);
  let release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});let reached!:()=>void;const started=new Promise<void>(resolve=>{reached=resolve;});let intercepted=false;
  await page.route('**/api/data',async route=>{if(intercepted || !route.request().postData()?.includes(action)){await route.continue();return;}intercepted=true;const response=await route.fetch();expect(response.status()).toBe(200);reached();await barrier;try{await route.fulfill({response});}catch{/* Account switching may abort the obsolete request. */}});
  try{
    await page.getByRole('button',{name:action==='preview_csv' ? 'Preview CSV' : 'Confirm import',exact:true}).click();await started;
    await page.getByRole('navigation').getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await signIn(page,1);await page.goto('/data');release();
    await expect(page.getByLabel('Import source label',{exact:true})).toHaveValue('');await expect(page.getByRole('region',{name:'Confirm CSV import',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Import recorded',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'No measurements loaded',exact:true})).toBeVisible();
  }finally{release();}
});
for(const colorScheme of ['light','dark'] as const)for(const [width,height] of [[360,800],[390,844],[430,932],[768,1024],[1440,900]])test(`CSV ${width}x${height} ${colorScheme}: review layout and 200% text`,async({page},info)=>{
  await page.setViewportSize({width:width!,height:height!});await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await choose(page);await page.getByLabel('CSV source label to include',{exact:true}).fill('Synthetic Scale A');await preview(page);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('import-preview.png'),fullPage:true});await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('button',{name:'Confirm import',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('import-zoom.png'),fullPage:true});
});
