import {createInterface} from 'node:readline/promises';
import {localStatus} from './local-database.js';
import {administrativeClient} from '../server/db/administrative.js';
import {recoverAccount} from '../server/security/account-recovery.js';

async function hiddenPassword(){
 if(!process.stdin.isTTY || !process.stdout.isTTY)throw new Error('An interactive private terminal is required.');
 process.stdout.write('New password (hidden, at least 12 characters): ');process.stdin.setRawMode(true);process.stdin.resume();
 try{return await new Promise<string>((resolve,reject)=>{let value='';const read=(chunk:Buffer)=>{for(const character of chunk.toString('utf8')){
  if(character==='\u0003'){process.stdin.off('data',read);reject(new Error('Cancelled.'));return;}
  if(character==='\r'||character==='\n'){process.stdin.off('data',read);resolve(value);value='';return;}
  if(character==='\u007f'||character==='\b')value=value.slice(0,-1);else if(character>=' '&&value.length<200)value+=character;
 }};process.stdin.on('data',read);});}finally{process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n');}
}
try{
 if(process.argv.length!==2)throw new Error('Connection/credential arguments are forbidden.');
 const status=localStatus();process.env.VITE_SUPABASE_URL=status.apiUrl;process.env.VITE_SUPABASE_PUBLISHABLE_KEY=status.anonKey;process.env.SUPABASE_SERVICE_ROLE_KEY=status.adminKey;
 const terminal=createInterface({input:process.stdin,output:process.stdout});
 let userId:string,confirmation:string;
 try{userId=(await terminal.question('Verified account UUID: ')).trim();confirmation=await terminal.question('After independent identity verification, type IDENTITY VERIFIED: ');}finally{terminal.close();}
 let password=await hiddenPassword();
 try{const result=await recoverAccount(administrativeClient(),{userId,password,identityVerified:confirmation==='IDENTITY VERIFIED'});console.info(JSON.stringify(result));}finally{password='';}
}catch{console.error('Local recovery failed or was cancelled. Do not hand off credentials until reset and session revocation are confirmed.');process.exitCode=1;}
