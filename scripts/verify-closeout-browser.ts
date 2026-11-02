import {chromium,expect} from '@playwright/test';
import type {CloseoutFixture} from './closeout-fixture.js';

export async function verifyCloseoutBrowser(input:{appOrigin:string;sourceOrigin:string;users:[{email:string;password:string;fixture:CloseoutFixture},{email:string;password:string;fixture:CloseoutFixture}];approved:boolean}){
 if(input.approved!==true)throw Error('browser_closeout_approval_required');
 for(const origin of [input.appOrigin,input.sourceOrigin]){const u=new URL(origin);if(u.origin!==origin||!(u.protocol==='https:'||u.protocol==='http:'&&u.hostname==='127.0.0.1'))throw Error('browser_closeout_origin');}
 const browser=await chromium.launch({headless:true}),checks:string[]=[];let step='start';
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',acceptDownloads:true});
  await context.route('**/*',route=>[input.appOrigin,input.sourceOrigin].includes(new URL(route.request().url()).origin)?route.continue():route.abort());
  const page=await context.newPage();let pageErrors=0;page.on('pageerror',()=>{pageErrors++;});
  const signin=async(index:number)=>{const u=input.users[index]!;await page.goto(input.appOrigin+'/ask');await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled({timeout:30000});await page.getByLabel('Email',{exact:true}).fill(u.email);await page.getByLabel('Password',{exact:true}).fill(u.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Ask Vulpes',exact:true})).toBeVisible({timeout:30000});};
  await signin(0);
  for(const [i,u]of input.users.entries()){
   if(i)await signin(i);step='owned-ask-'+i;
   await expect(page.getByText(u.fixture.marker+'; trusted security fixture, no provider request',{exact:true})).toBeVisible({timeout:30000});await expect(page.getByText(input.users[1-i]!.fixture.marker+'; trusted security fixture, no provider request',{exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Send',exact:true})).toBeDisabled();checks.push(step);
   step='owned-account-download-'+i;await page.getByRole('link',{name:'Settings',exact:true}).click();await expect(page.getByText(u.email,{exact:true})).toBeVisible();
   const download=page.waitForEvent('download');await page.getByRole('button',{name:'Download account JSON',exact:true}).click();const artifact=await download;expect(artifact.suggestedFilename()).toBe('vulpes-account-v1.json');expect(await artifact.failure()).toBeNull();await artifact.delete();checks.push(step);
   await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Vulpes',exact:true})).toBeVisible();
  }
  step='delayed-response-account-switch';await signin(0);
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});let held=false,armed=true;let settings:Awaited<ReturnType<typeof context.newPage>>|undefined;
  await page.route('**/api/data?view=sources*',async route=>{
   if(!armed){await route.continue();return;}armed=false;const response=await route.fetch({maxRedirects:0,timeout:25000});held=true;await gate;await route.fulfill({response}).catch(()=>undefined);
  });
  try{
   await page.getByRole('link',{name:'Data',exact:true}).click();await expect.poll(()=>held,{timeout:30000}).toBe(true);
   settings=await context.newPage();await settings.goto(input.appOrigin+'/settings');await settings.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Vulpes',exact:true})).toBeVisible();
   await signin(1);release();await settings.close();settings=undefined;
   await page.getByRole('link',{name:'Data',exact:true}).click();const sources=page.getByLabel('Source',{exact:true});await expect(sources.locator('option').filter({hasText:input.users[1].fixture.marker})).toHaveCount(1,{timeout:30000});await expect(sources.locator('option').filter({hasText:input.users[0].fixture.marker})).toHaveCount(0);checks.push(step);
  }finally{release();await settings?.close();}
  await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await expect(page.getByRole('heading',{name:'Sign in to Vulpes',exact:true})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('vulpes.auth.session.v1'))).toBeNull();expect(pageErrors).toBe(0);checks.push('signed-out-private-state-cleared');await context.close();

  step='public-only-service-worker';const pwa=await browser.newContext({serviceWorkers:'allow'});await pwa.route('**/*',route=>new URL(route.request().url()).origin===input.appOrigin?route.continue():route.abort());const offline=await pwa.newPage();
  await offline.goto(input.appOrigin+'/offline.html');await offline.evaluate(async()=>{await caches.open('vulpes-static-obsolete');await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});await offline.reload();await expect.poll(()=>offline.evaluate(()=>!!navigator.serviceWorker.controller)).toBe(true);
  const cached=await offline.evaluate(async()=>{for(const path of ['/api/data','/api/conversations','/api/executions?view=payload','/auth/callback','/login','/offline.html?private=synthetic'])await fetch(path).catch(()=>undefined);const names=await caches.keys();const urls=(await Promise.all(names.map(async n=>(await(await caches.open(n)).keys()).map(r=>r.url)))).flat();return {names,urls};});
  expect(cached.names).toHaveLength(1);expect(cached.names[0]).toMatch(/^vulpes-static-/);expect(cached.urls.length).toBeGreaterThan(8);expect(cached.urls.every(value=>{const u=new URL(value);return !u.search&&/^(?:\/assets\/[\w.-]+\.(?:js|css)|\/offline\.(?:html|css)|\/manifest.webmanifest|\/(?:brand|icons)\/[\w.-]+\.png)$/.test(u.pathname);})).toBe(true);checks.push(step);
  step='data-free-offline-route';await pwa.setOffline(true);await offline.goto(input.appOrigin+'/ask?conversation=synthetic-private-id');await expect(offline.getByRole('heading',{name:"You're offline"})).toBeVisible();await expect(offline.locator('body')).not.toContainText('synthetic-private-id');expect(await offline.locator('script').count()).toBe(0);for(const path of ['/api/data','/api/chat','/auth/callback'])expect(await offline.evaluate(url=>fetch(url).then(()=>'response',()=>'offline'),path)).toBe('offline');checks.push(step);await pwa.close();
  return {scope:'synthetic-hosted-browser-closeout',status:'passed',checks,pageErrors,providerRequests:0,physicalDevice:'not_run'} as const;
 }catch(error){throw new Error('browser_closeout_failed:'+step,{cause:error});}finally{await browser.close();}
}
