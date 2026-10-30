import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {accounts,signIn,restrictNetwork} from './auth-helpers';

test.beforeEach(async({page})=>{await restrictNetwork(page);});
async function initiate(page:Page,index:number){
 await signIn(page,index);await page.goto('/settings');await page.getByLabel('Current password',{exact:true}).fill(accounts[index]!.password);
 const confirm=page.getByLabel('Deletion confirmation',{exact:true});await confirm.fill('DELETE');await expect(page.getByRole('button',{name:'Start account deletion',exact:true})).toBeDisabled();
 await confirm.fill('DELETE MY VULPES ACCOUNT');await page.getByRole('button',{name:'Start account deletion',exact:true}).click();await expect(page.getByRole('heading',{name:'Account deletion in progress'})).toBeVisible();
}
test('account lifecycle export downloads owned JSON with explicit sensitive-trace acknowledgement',async({page},info)=>{
 await signIn(page);await page.goto('/settings');await page.getByLabel('Include available request, response, context and usage traces').check();
 const button=page.getByRole('button',{name:'Download account JSON'});await expect(button).toBeDisabled();await expect(page.locator('#trace-export-warning')).toContainText('Sensitive-content warning');
 await page.getByLabel('I understand this download can contain sensitive trace content').check();
 const pending=page.waitForEvent('download');await button.click();const download=await pending;expect(download.suggestedFilename()).toBe('vulpes-account-v1.json');
 const file=await download.path();if(!file)throw new Error('Missing synthetic download.');const value=JSON.parse(await readFile(file,'utf8'));expect(value.schemaVersion).toBe(1);expect(value.ownerId).toBe(accounts[0]!.id);expect(Object.keys(value.sections)).toHaveLength(18);expect(value.sections.account_identity).toMatchObject([{id:accounts[0]!.id,email:accounts[0]!.email}]);expect(value.traceParts).toEqual(['input','output','context','usage']);
 await page.setViewportSize({width:360,height:800});await page.emulateMedia({colorScheme:'dark'});await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.getByRole('heading',{name:'Export and delete account',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('account-controls.png')});
});
test('account lifecycle clears private navigation, resumes after reload, and confirms identity removal',async({page},info)=>{
 let initiationLost=false;
 await page.route('**/api/account',async route=>{
  if(route.request().method()==='POST'&&route.request().postDataJSON()?.action==='delete'){
   const response=await route.fetch();expect(response.status()).toBe(200);expect((await response.json()).data.phase).toBe('fenced');initiationLost=true;await route.abort('connectionreset');
  }else await route.continue();
 });
 await initiate(page,4);await expect(page.getByRole('navigation',{name:'Primary'})).toHaveCount(0);
 expect(initiationLost).toBe(true);
 await page.goto('/data');await expect(page.getByRole('heading',{name:'Account deletion in progress'})).toBeVisible();await page.reload();await expect(page.getByRole('heading',{name:'Account deletion in progress'})).toBeVisible();
 await page.setViewportSize({width:360,height:800});await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('deletion-status.png'),fullPage:true});
 for(let n=0;n<10;n++){
  const pending=page.waitForResponse(response=>response.url().endsWith('/api/account')&&response.request().postDataJSON()?.action==='continue_delete');await page.getByRole('button',{name:'Continue account deletion',exact:true}).click();const value=await(await pending).json();
  if(value.data.phase==='completed')break;await expect(page.getByRole('button',{name:'Continue account deletion',exact:true})).toBeEnabled();
 }
 await expect(page.getByRole('heading',{name:'Account deletion completed',exact:true})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('vulpes.auth.session.v1'))).toBeNull();await page.reload();await expect(page.getByRole('heading',{name:'Sign in to Vulpes'})).toBeVisible();
});
test('account lifecycle lost final response stays unconfirmed until an authoritative completion receipt',async({page})=>{
 await initiate(page,5);let lost=false;let completion:unknown;
 await page.route('**/api/account',async route=>{
  if(route.request().method()!=='POST'||route.request().postDataJSON()?.action!=='continue_delete'){await route.continue();return;}
  const response=await route.fetch();const value=await response.json();
  if(value.data?.phase==='completed'){completion=value;lost=true;await route.abort('connectionreset');}else await route.fulfill({response});
 });
 for(let n=0;n<10&&!lost;n++){await page.getByRole('button',{name:'Continue account deletion',exact:true}).click();await expect(page.getByRole('button',{name:'Continue account deletion',exact:true})).toBeEnabled();}
 expect(lost).toBe(true);await expect(page.getByRole('alert')).toContainText('completion is unconfirmed');await expect(page.getByRole('heading',{name:'Account deletion completed',exact:true})).toHaveCount(0);
 await page.reload();await expect(page.getByRole('heading',{name:'Account status unconfirmed'})).toBeVisible();await expect(page.getByRole('navigation',{name:'Primary'})).toHaveCount(0);
 // A status request verified before Auth removal can finish after the journal commits.
 // Replay only the actual server completion receipt obtained above, never a fabricated PASS.
 await page.route('**/api/account',async route=>{if(route.request().method()==='GET')await route.fulfill({status:200,json:completion});else await route.continue();});
 await page.reload();await expect(page.getByRole('heading',{name:'Account deletion completed',exact:true})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('vulpes.auth.session.v1'))).toBeNull();
});
test('account lifecycle discards an export response after sign-out',async({page})=>{
 await signIn(page);await page.goto('/settings');await page.addInitScript(()=>{const original=URL.createObjectURL;URL.createObjectURL=(blob)=>{document.documentElement.dataset.accountDownload='created';return original(blob);};});await page.reload();await expect(page.getByRole('button',{name:'Download account JSON'})).toBeVisible();
 let release!:()=>void;let started!:()=>void;const waiting=new Promise<void>(resolve=>{release=resolve;});const captured=new Promise<void>(resolve=>{started=resolve;});
 await page.route('**/api/account',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}const response=await route.fetch();started();await waiting;await route.fulfill({response}).catch(()=>undefined);});
 await page.getByRole('button',{name:'Download account JSON'}).click();await captured;await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Vulpes'})).toBeVisible();release();
 await expect(page.locator('html')).not.toHaveAttribute('data-account-download','created');
});
