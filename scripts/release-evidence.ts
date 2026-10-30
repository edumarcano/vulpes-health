import {createHash} from 'node:crypto';
import {spawnSync,spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,copyFileSync,symlinkSync,lstatSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {z} from 'zod';
import {models,getRoleAvailability} from '../server/config/models.js';
import {everydayAdapterVersion,everydayTemplateVersion} from '../server/config/everyday-versions.js';
import {vertexAdapterVersion} from '../server/ai/providers/vertex.js';
import {localEnvironment} from './local-database.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const work=path.join(root,'.scratch/pr17-verification');
const records=path.join(root,'.scratch/release-records');
const destination=path.join(root,'docs/evidence/release');
export const checks={
 lint:['run','lint'],typecheck:['run','typecheck'],unit:['test','--','--maxWorkers=2'],build:['run','build'],bundle:['run','test:bundle'],spec:['run','test:spec'],
 start:['run','db:start'],reset:['run','db:reset:test'],upgrade:['run','test:lifecycle-upgrade','--','--allow-disposable-reset'],
 dbLint:['run','db:lint'],dbTests:['run','test:db'],dbTypes:['run','db:types:check'],integration:['run','test:integration'],
 integrationThreads:['run','test:integration','--','--pool=threads'],
 cleanup:['run','maintenance:cleanup'],restore:['run','backup:verify'],executions:['run','test:executions'],evaluations:['run','test:evaluations'],
 providers:['run','test:providers'],browser:['run','test:e2e'],development:['run','test:dev'],pwa:['run','test:pwa'],stop:['run','db:stop'],
} as const;
const Check=z.enum(Object.keys(checks) as [keyof typeof checks,...(keyof typeof checks)[]]);
const Hash=z.string().regex(/^[a-f0-9]{64}$/);
const proofKeys=['actualProviderRequests','providerRequests','actualSpendUSD','inferenceSpendUSD','admitted','prepared','budgetDenied','transportRequests','capturedBytesEqual','bodyBytes','heldUSD','conservativeUSD','correctedUSD','encryptedArchive','maximumBackupDays','schemaFunctionsGrantsRlsOwners','rowAndStorageInventory','currentAndRetainedKeys','missingKeyAndTamperDenied','postBackupDeletionApplied','currentIndependentJournalRequired','restoredSessionsRevoked','authPasswordRecovery','twoOwnerIsolation','operatorAssistedRecovery','removed','expired','batches','goalWork','runWork','interrupted','conservative','runsRemoved','receiptsRemoved','deletionsResumed','pendingDeletions','unfinished','exportArtifactsRemoved','expiredBackupsRemoved','batchLimit','maxBatches','maxDeletionSteps'] as const;
const ProofSchema=z.partialRecord(z.enum(proofKeys),z.union([z.boolean(),z.number().finite(),z.string().regex(/^\d+(?:\.\d+)?$/).max(40)]));
export const RecordSchema=z.strictObject({check:Check,sourceRevision:z.string().regex(/^[a-f0-9]{40}$/),sourceDigest:Hash,workspaceDigest:Hash,
 startedAt:z.iso.datetime(),endedAt:z.iso.datetime(),exitCode:z.number().int().nullable(),status:z.enum(['passed','failed']),
 outputSHA256:Hash,outputBytes:z.number().int().nonnegative(),summary:z.array(z.string().max(160)).max(20),proof:ProofSchema.optional()}).superRefine((r,c)=>{
 if((r.exitCode===0)!==(r.status==='passed'))c.addIssue({code:'custom',message:'Exit status disagrees with outcome.'});
 if(r.summary.some(s=>!outputSummary(s).includes(s)))c.addIssue({code:'custom',message:'Unsafe summary.'});
});
export function sha(bytes:Buffer|string){return createHash('sha256').update(bytes).digest('hex');}
// Deliberately publish only numeric runner summaries. Never echo arbitrary test/service output.
export function outputSummary(output:string){
 const clean=output.replace(new RegExp(String.fromCharCode(27)+'\\[[0-9;]*m','g'),'');
 const rows=clean.split(/\r?\n/).map(line=>line.trim()).flatMap(line=>{
  if(/^(?:Test Files|Tests)\s+\d+ (?:passed|failed|skipped)(?: \|\s*\d+ (?:passed|failed|skipped))* \(\d+\)$/.test(line)||
    /^\d+ (?:passed|failed|skipped)(?: \([\d.ms ]+\))?$/.test(line)||/^All \d+ checks passed\.$/.test(line))return [line];
  const db=line.match(/^Files=(\d+), Tests=(\d+)(?:,|$)/);if(db)return [`Files=${db[1]}, Tests=${db[2]}`];
  const spec=line.match(/^(?:PASS: )?(\d+) specification and fixture checks passed$/);return spec?[`${spec[1]} specification and fixture checks passed`]:[];
 });return [...new Set(rows)].slice(-20);
}
export function safeProof(output:string){
 try{const start=output.indexOf('{'),end=output.lastIndexOf('}');if(start<0)return {};
  const value=JSON.parse(output.slice(start,end+1)) as Record<string,unknown>;
  return ProofSchema.parse(Object.fromEntries(proofKeys.filter(k=>k in value).map(k=>[k,value[k]])));
 }catch{return {};}
}
function git(args:string[]){const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});if(r.status!==0)throw new Error('Git identity unavailable.');return r.stdout.trim();}
function files(dir:string,base=dir):string[]{return readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
 const p=path.join(dir,e.name);if(e.isSymbolicLink())throw new Error('Source symlinks are unsupported.');
 return e.isDirectory()?files(p,base):[path.relative(base,p).replaceAll('\\','/')];
});}
function executableFiles(){return [...['src','server','shared','api','scripts','tests','supabase/migrations','supabase/tests','public'].flatMap(p=>files(path.join(root,p)).map(f=>`${p}/${f}`)),
 ...['package.json','package-lock.json','vite.config.ts','playwright.config.ts','vitest.config.ts','vitest.integration.config.ts','vercel.json','index.html','eslint.config.js','supabase/config.toml','.env.example','.github/workflows/ci.yml'],
 ...readdirSync(root).filter(f=>/^tsconfig.*\.json$/.test(f)),...files(path.join(root,'docs/spec/v0.1.0')).map(f=>`docs/spec/v0.1.0/${f}`)].sort();}
function digest(base:string,list:string[]){return sha(list.map(f=>`${f}\0${sha(readFileSync(path.join(base,f)))}\n`).join(''));}
const replacements=[['vulpes-health-pr03-test','vulpes-health-pr17-test'],['54321','27421'],['54322','27422'],['54320','27420'],['5173','25173']] as const;
function prepare(refresh=false){
 if(existsSync(work)&&!refresh)throw new Error('Disposable workspace already exists; inspect it and use --sync to copy a changed candidate without resetting data.');
 if(refresh&&!readFileSync(path.join(work,'supabase/config.toml'),'utf8').includes('vulpes-health-pr17-test'))throw new Error('Unexpected workspace.');
 mkdirSync(work,{recursive:true});
 const list=git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
 for(const f of list){if(f.startsWith('.git/')||f!=='.env.example'&&/(^|\/)\.env(?:\.|$)/.test(f)||f.startsWith('supabase/.temp/'))continue;
  const from=path.join(root,f);if(!existsSync(from))continue;if(lstatSync(from).isSymbolicLink())throw new Error('Unexpected source link.');
  const to=path.join(work,f);mkdirSync(path.dirname(to),{recursive:true});copyFileSync(from,to);
  if(/\.(ts|tsx|json|toml|md)$/.test(f)){let text=readFileSync(to,'utf8');for(const [a,b] of replacements)text=text.replaceAll(a,b);writeFileSync(to,text);}
 }
 if(!existsSync(path.join(work,'node_modules')))symlinkSync(path.join(root,'node_modules'),path.join(work,'node_modules'),process.platform==='win32'?'junction':'dir');
 console.info('Prepared isolated synthetic workspace; retained M3 database and allocations unchanged.');
}
function identity(){const list=executableFiles();return {sourceRevision:git(['rev-parse','HEAD']),sourceDigest:digest(root,list),workspaceDigest:digest(work,list)};}
function assertCopy(){
 const config=readFileSync(path.join(work,'supabase/config.toml'),'utf8');
 if(!config.includes('vulpes-health-pr17-test')||!config.includes('27421')||existsSync(path.join(work,'supabase/.temp/project-ref')))throw new Error('Refusing an unexpected verification workspace.');
 // Verify every executable byte, permitting only the documented local harness substitutions.
 for(const f of executableFiles()){
  const original=readFileSync(path.join(root,f));let expected=original;
  if(/\.(ts|tsx|json|toml|md)$/.test(f)){let text=original.toString();for(const [a,b] of replacements)text=text.replaceAll(a,b);expected=Buffer.from(text);}
  if(!expected.equals(readFileSync(path.join(work,f))))throw new Error('Verification copy differs from the candidate. Reconcile it before running checks.');
 }
}
async function run(check:keyof typeof checks){
 assertCopy();const before=identity();mkdirSync(records,{recursive:true});
 const npm=process.env.npm_execpath;if(!npm)throw new Error('Use npm run evidence:release.');
 const startedAt=new Date().toISOString();const chunks:Buffer[]=[];let size=0;
 const child=spawn(process.execPath,[npm,...checks[check]],{cwd:work,env:{...localEnvironment(),VULPES_LIVE_AI_ENABLED:'false'},stdio:['ignore','pipe','pipe']});
 for(const stream of [child.stdout,child.stderr])stream.on('data',(b:Buffer)=>{size+=b.length;if(size>16*1024*1024)child.kill();else chunks.push(b);});
 const exitCode=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 const output=Buffer.concat(chunks);const stable=JSON.stringify(identity())===JSON.stringify(before);
 const record=RecordSchema.parse({check,...before,startedAt,endedAt:new Date().toISOString(),exitCode:stable?exitCode:null,
  status:stable&&exitCode===0?'passed':'failed',outputSHA256:sha(output),outputBytes:size,summary:outputSummary(output.toString()),proof:safeProof(output.toString())});
 const filename=`${check}-${Date.now()}.json`;writeFileSync(path.join(records,filename),JSON.stringify(record,null,2)+'\n');
 // Full output stays ignored and local. It may contain credentials; never upload it.
 writeFileSync(path.join(records,filename+'.private-output'),output,{mode:0o600});
 console.info(JSON.stringify(record,null,2));if(record.status==='failed')process.exitCode=1;
}
export function currentOutcome(history:z.infer<typeof RecordSchema>[],check:keyof typeof checks,current:{sourceDigest:string;workspaceDigest:string}){
 const rows=history.filter(r=>r.check===check&&r.sourceDigest===current.sourceDigest&&r.workspaceDigest===current.workspaceDigest).sort((a,b)=>a.endedAt.localeCompare(b.endedAt));
 return rows.at(-1)?.status??'not_run';
}
function assemble(){
 assertCopy();const current=identity();
 const history=existsSync(records)?readdirSync(records).filter(f=>f.endsWith('.json')).map(f=>RecordSchema.parse(JSON.parse(readFileSync(path.join(records,f),'utf8')))):[];
 const outcomes=Object.fromEntries(Object.keys(checks).map(c=>[c,currentOutcome(history,c as keyof typeof checks,current)]));
 const assessment=JSON.parse(readFileSync(path.join(root,'docs/evidence/release/acceptance-map.json'),'utf8')) as Array<{id:string;checks:(keyof typeof checks)[];scope:string;external:string|null;applicability:'required'|'optional_disabled'}>;
 const ids=[...readFileSync(path.join(root,'docs/spec/v0.1.0/ACCEPTANCE_TESTS.md'),'utf8').matchAll(/^\| ([A-Z]+-\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/gm)];
 if(assessment.length!==ids.length||new Set(assessment.map(a=>a.id)).size!==ids.length||ids.some(i=>!assessment.some(a=>a.id===i[1])))throw new Error('Acceptance inventory is incomplete.');
 const acceptance=ids.map(i=>{const a=assessment.find(a=>a.id===i[1])!;if(a.checks.some(c=>!Check.safeParse(c).success))throw new Error('Unknown acceptance evidence.');
  const localStatus=a.checks.length===0?'not_run':a.checks.some(c=>outcomes[c]==='failed')?'failed':a.checks.every(c=>outcomes[c]==='passed')?'passed':'not_run';
  return {id:a.id,gate:i[2]!.trim(),requirement:i[3]!.trim(),expected:i[4]!.trim(),environment:'disposable local synthetic; Chromium emulation',
   testedRevision:current.sourceRevision,sourceDigest:current.sourceDigest,checks:a.checks,localScope:a.scope,localStatus,
   commands:a.checks.map(c=>`npm ${checks[c].join(' ')}`),artifact:'docs/evidence/release/m6-local.json#verificationRecords',manualProcedure:a.external?'docs/operations/release-readiness.md#required-deployment-and-pilot-checklist':null,
   status:a.applicability==='optional_disabled'?'optional_disabled':localStatus==='failed'?'failed':a.external?'blocked':localStatus,remainingConsequence:a.external};});
 const pkg=JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'));
 const dependencies=Object.fromEntries(Object.keys({...pkg.dependencies,...pkg.devDependencies}).sort().map(name=>{
  const file=path.join(root,'node_modules',name,'package.json');return [name,JSON.parse(readFileSync(file,'utf8')).version as string];}));
 const buildFiles=['dist','.build'].flatMap(dir=>existsSync(path.join(work,dir))?files(path.join(work,dir)).map(f=>({path:`${dir}/${f}`,sha256:sha(readFileSync(path.join(work,dir,f)))})):[]);
 const screenshots=JSON.parse(readFileSync(path.join(destination,'screenshots.json'),'utf8')) as Array<{file:string;sha256:string;reviewed:boolean;description:string}>;
 for(const s of screenshots)if(!s.reviewed||sha(readFileSync(path.join(destination,s.file)))!==s.sha256)throw new Error('Screenshot review/hash missing.');
 const npm=process.env.npm_execpath;if(!npm)throw new Error('Use npm.');const measured=spawnSync(process.execPath,[npm,'--version'],{cwd:root,env:localEnvironment(),encoding:'utf8'});
 if(measured.status!==0||!/^\d+\.\d+\.\d+$/.test(measured.stdout.trim()))throw new Error('npm version unavailable.');
 const report={schemaVersion:1,generatedAt:new Date().toISOString(),...current,environment:{node:process.version,platform:process.platform,npm:measured.stdout.trim(),declaredPackageManager:pkg.packageManager,substitutions:replacements},
  releaseReady:false,providerRequests:0,externalSpendUSD:'0',dependencies,buildFiles,commands:checks,outcomes,verificationRecords:history,
  acceptance,screenshots,providers:Object.values(models).map(m=>({role:m.role,model:m.modelId,adapter:m.provider==='vertex_ai'?vertexAdapterVersion:everydayAdapterVersion,
   template:everydayTemplateVersion,catalogSHA256:sha(readFileSync(path.join(root,'server/config/models.ts'))),priceStatus:m.price.status,privacy:m.privacyPolicy,production:getRoleAvailability(m.role),currentLiveEvidence:'not_run',historical:m.role==='everyday'?'M3 v3 evidence retained; does not validate v4':'none'})),
  limitations:['No current-template live model or safety evaluation.','No hosted routing/CSP/Auth/storage/restore verification.','No physical keyboard/PWA/assistive-technology test.','No human recovery handoff, family invitation or pilot.','Combined independent M5/M6 review and formal M2/M3/M4 acceptance remain separate.'],
  approvedDeviations:['PR 14 deferred and disabled; combined independent M5/M6 review follows PR 17.'],
 };
 mkdirSync(destination,{recursive:true});writeFileSync(path.join(destination,'m6-local.json'),JSON.stringify(report,null,2)+'\n');
 console.info(JSON.stringify({report:'docs/evidence/release/m6-local.json',acceptanceRows:acceptance.length,outcomes,releaseReady:false}));
}
async function main(){const args=process.argv.slice(2);if(args.length===1&&['--prepare','--sync'].includes(args[0]!))prepare(args[0]==='--sync');else if(args.length===1&&args[0]!.startsWith('--check='))await run(Check.parse(args[0]!.slice(8)));else if(args.length===0)assemble();else throw new Error('Use --prepare, --sync, --check=<named local check>, or no arguments to assemble.');}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main().catch(()=>{console.error('Release evidence failed closed. Inspect local private records; do not publish raw output.');process.exitCode=1;});
