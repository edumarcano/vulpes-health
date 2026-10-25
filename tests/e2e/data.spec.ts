import { expect, test, type Page } from '@playwright/test';
import { accounts, restrictNetwork, signIn } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';

async function clearReadings() {
  const db=new LocalSupabase();
  for(const account of accounts) for(const table of ['audit_events','measurements','import_batches','private_payloads','data_sources']) await db.admin(`/rest/v1/${table}?user_id=eq.${account.id}`,'DELETE');
}
test.beforeEach(async({page})=>{await clearReadings();await restrictNetwork(page);await signIn(page);await page.goto('/data');await expect(page.getByRole('heading',{name:'Manual measurement',exact:true})).toBeVisible();});
test.afterEach(async()=>{await clearReadings();});
async function range(page:Page) { await page.getByLabel('From date',{exact:true}).fill('2026-09-01'); await page.getByLabel('Through date',{exact:true}).fill('2026-09-14'); }
async function entry(page:Page,value:string,day:string,source?:string) {
  await page.getByLabel('Entry source',{exact:true}).selectOption(source ?? 'new');
  if(!source) await page.getByLabel('Source label',{exact:true}).fill('Synthetic Scale A');
  await page.getByLabel('Value',{exact:true}).fill(value);await page.getByLabel('Observation date/time',{exact:true}).fill(`2026-09-${day}T08:00:00Z`);
  await page.getByRole('button',{name:'Review measurement',exact:true}).click();
  await expect(page.getByRole('region',{name:'Confirm measurement',exact:true})).toBeVisible();
  const response=page.waitForResponse((response)=>response.url().endsWith('/api/data') && response.request().method()==='POST');
  await page.getByRole('button',{name:'Confirm and save',exact:true}).click(); const result=await response;expect(result.status()).toBe(200);
  await expect(page.getByRole('region',{name:'Confirm measurement',exact:true})).toHaveCount(0);
  return (await result.json() as {data:{sourceId:string}}).data.sourceId;
}
test('manual entry persists, calculates exact summary, reloads, and never calls a model',async({page})=>{
  const calls:string[]=[];page.on('request',(request)=>{if(/\/api\/(?:chat|goals|approvals|executions)/.test(request.url()))calls.push(request.url());});
  await range(page);const source=await entry(page,'70','08');
  await expect(page.getByRole('region',{name:'Deterministic summary'})).toContainText('Insufficient data');
  await entry(page,'69','09',source);await entry(page,'68','10',source);
  await expect(page.getByTestId('headline-value')).toHaveText('69 kg');await expect(page.getByRole('table')).toContainText('70 kg');
  await entry(page,'69','09',source);await expect(page.getByRole('status').filter({hasText:'no duplicate'})).toBeVisible();
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(4);
  await page.reload();await range(page);await page.getByLabel('Source',{exact:true}).selectOption(source);
  await expect(page.getByTestId('headline-value')).toHaveText('69 kg');
  expect(calls).toEqual([]);expect(await page.evaluate(()=>Object.keys(localStorage).every((key)=>key.startsWith('vulpes.auth.session.v1')))).toBe(true);
});
test('confirmation is required, unusual readings stay unchanged, source text is inert, and errors are honest',async({page})=>{
  await range(page);await page.getByLabel('Source label',{exact:true}).fill('<script>synthetic-only</script>');await page.getByLabel('Value',{exact:true}).fill('600');await page.getByLabel('Observation date/time',{exact:true}).fill('2026-09-08T08:00:00Z');await page.getByLabel('Flag this reading for review').check();
  await page.getByRole('button',{name:'Review measurement',exact:true}).click();await expect(page.getByRole('heading',{name:'No measurements loaded',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Confirm and save',exact:true}).click();await expect(page.getByRole('table')).toContainText('600 kg');await expect(page.getByRole('table')).toContainText('review_requested');expect(await page.locator('script').filter({hasText:'synthetic-only'}).count()).toBe(0);
  await page.getByLabel('Entry source',{exact:true}).selectOption('new');await page.getByLabel('Source label',{exact:true}).fill('DST test');await page.getByLabel('Value',{exact:true}).fill('70');await page.getByLabel('Observation date/time',{exact:true}).fill('2026-11-01T01:30:00');await page.getByLabel('Entry timezone',{exact:true}).fill('America/New_York');
  await page.getByRole('button',{name:'Review measurement',exact:true}).click();await page.getByRole('button',{name:'Confirm and save',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Ambiguous');
});
test('account switch clears measurements and draft fields',async({page})=>{
  await range(page);await entry(page,'70','08');await page.getByLabel('Value',{exact:true}).fill('12345');
  await page.getByRole('navigation').getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
  await signIn(page,1);await page.goto('/data');await expect(page.getByRole('heading',{name:'No measurements loaded',exact:true})).toBeVisible();await expect(page.getByLabel('Value',{exact:true})).toHaveValue('');await expect(page.getByText('Synthetic Scale A',{exact:true})).toHaveCount(0);
});
test('loading and connection failure do not show fabricated readings',async({page})=>{
  await page.route('**/api/data?**',route=>route.abort());await page.reload();await expect(page.getByRole('alert')).toContainText('Sources could not be loaded');await expect(page.getByRole('table')).toHaveCount(0);
  await page.unroute('**/api/data?**');await page.getByRole('button',{name:'Retry data',exact:true}).click();await expect(page.getByRole('heading',{name:'No measurements loaded',exact:true})).toBeVisible();
});
test('keyboard confirmation moves focus to the action and back to the entry',async({page})=>{
  await page.getByLabel('Source label',{exact:true}).fill('Synthetic keyboard source');await page.getByLabel('Value',{exact:true}).fill('70');
  await page.getByRole('button',{name:'Review measurement',exact:true}).click();await expect(page.getByRole('button',{name:'Confirm and save',exact:true})).toBeFocused();
  await page.getByRole('button',{name:'Back to editing',exact:true}).click();await expect(page.getByLabel('Value',{exact:true})).toBeFocused();
  await page.getByLabel('Metric',{exact:true}).selectOption('heart_rate');
  await expect(page.getByText('A seven-day mean requires at least three valid days.',{exact:false})).toHaveCount(0);
});
test('a chart loading failure preserves entry and the table',async({page})=>{
  await page.route('**/assets/data-chart-*.js',route=>route.abort());
  await page.route('**/src/features/data/data-chart.tsx',route=>route.abort());
  await range(page);await entry(page,'70','08');
  await expect(page.getByText('The chart could not be loaded.',{exact:false})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Manual measurement',exact:true})).toBeVisible();await expect(page.getByRole('table')).toContainText('70 kg');
});
for(const colorScheme of ['light','dark'] as const) for(const [width,height] of [[360,800],[390,844],[430,932],[768,1024],[1440,900]]) {
  test(`${width}x${height} ${colorScheme}: populated Data layout and table`,async({page},info)=>{
    await page.setViewportSize({width:width!,height:height!});await page.emulateMedia({colorScheme,reducedMotion:'reduce'});await range(page);const source=await entry(page,'70','08');await entry(page,'69','09',source);await entry(page,'68','10',source);await expect(page.getByTestId('headline-value')).toHaveText('69 kg');
    await expect(page.locator('.recharts-surface')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath('data.png'),fullPage:true});
    await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.getByRole('table')).toBeVisible();await page.screenshot({path:info.outputPath('data-zoom.png'),fullPage:true});
  });
}
