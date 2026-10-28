import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {LocalSupabase} from '../helpers/local-supabase';
import {accounts,signIn,restrictNetwork} from './auth-helpers';
test('direct Goals review and approval persist without inference',async({page},info)=>{
 const db=new LocalSupabase();const owner=accounts[0]!.id;const source=randomUUID();
 await db.admin('/rest/v1/data_sources','POST',{id:source,user_id:owner,kind:'manual',label:'Synthetic Goals browser',source_namespace:randomUUID()});
 try{
 await restrictNetwork(page);await signIn(page);const calls:string[]=[];page.on('request',r=>{if(r.url().includes('/api/chat'))calls.push(r.url());});
 await page.goto('/goals');await page.getByLabel('Metric',{exact:true}).selectOption('body_fat_percent');await page.getByLabel('Title',{exact:true}).fill('Synthetic empty target');await page.getByRole('button',{name:'Review proposal',exact:true}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'Approve goal proposal',exact:true})).toHaveCount(0);await page.getByLabel('Metric',{exact:true}).selectOption('weight');await page.getByLabel('Title',{exact:true}).fill('Synthetic browser goal');await page.getByLabel('Source',{exact:true}).selectOption(source);await page.getByLabel('target',{exact:true}).fill('68');await page.getByRole('combobox',{name:'Baseline method',exact:true}).selectOption('user_reported');await page.getByLabel('Reported baseline',{exact:true}).fill('70');await page.getByRole('button',{name:'Review proposal',exact:true}).click();
 const review=page.getByRole('region',{name:'Review goal proposal'});await expect(review).toContainText('Synthetic browser goal');await expect(page.getByRole('button',{name:'Synthetic browser goal · active'})).toHaveCount(0);await review.getByRole('button',{name:'Approve goal proposal',exact:true}).click();
 await page.getByRole('button',{name:'Synthetic browser goal · active',exact:true}).click();await expect(page.getByRole('heading',{name:'Revision history',exact:true})).toBeVisible();await page.reload();await expect(page.getByRole('button',{name:'Synthetic browser goal · active',exact:true})).toBeVisible();expect(calls).toEqual([]);await page.screenshot({path:info.outputPath('goals-approved.png'),fullPage:true});
 }finally{await db.admin(`/rest/v1/goals?user_id=eq.${owner}`,'PATCH',{state:'draft',current_revision_id:null});await db.admin(`/rest/v1/goal_revisions?user_id=eq.${owner}`,'DELETE');await db.admin(`/rest/v1/action_proposals?user_id=eq.${owner}`,'DELETE');await db.admin(`/rest/v1/goals?user_id=eq.${owner}`,'DELETE');await db.admin(`/rest/v1/data_sources?id=eq.${source}`,'DELETE');}
});
