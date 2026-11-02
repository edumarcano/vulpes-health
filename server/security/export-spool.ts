import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {mkdtemp,open,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

export async function stageExport(owner:string,records:AsyncIterable<string>,signal:AbortSignal){
 const directory=await mkdtemp(join(tmpdir(),'vulpes-export-')),path=join(directory,'data.enc');
 const key=randomBytes(32),nonce=randomBytes(12),aad=Buffer.from(JSON.stringify([1,owner]));
 let file:Awaited<ReturnType<typeof open>>|undefined,closed=false;
 async function cleanup(){
  if(closed)return;closed=true;key.fill(0);
  try{await file?.close();}finally{
   await unlink(path).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
   await rmdir(directory).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
  }
 }
 try{
  file=await open(path,'wx+',0o600);
  // Remove the name before requesting any private bytes. The descriptor remains
  // usable; process exit closes it and releases the unlinked encrypted spool.
  // Platforms that cannot unlink an open file fail before consuming the export.
  await unlink(path);await rmdir(directory);signal.throwIfAborted();
  const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad);
  // Keep descriptor ownership here: native fs streams may close a supplied fd
  // when pipeline destroys them after an error, even with autoClose disabled.
  const output=new Writable({write(chunk:Buffer,_encoding,done){
   (async()=>{let offset=0;while(offset<chunk.length){const result=await file!.write(chunk,offset,chunk.length-offset);if(!result.bytesWritten)throw new Error('Export spool write incomplete.');offset+=result.bytesWritten;}})().then(()=>done(),done);
  }});
  await pipeline(Readable.from(records),cipher,output,{signal});
  const tag=cipher.getAuthTag(),size=(await file.stat()).size;
  return {cleanup,open(){
   if(closed)throw new Error('Export already closed.');
   const decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(aad);decipher.setAuthTag(tag);
   const ciphertext=Readable.from((async function*(){
    let position=0;while(position<size){const bytes=Buffer.alloc(Math.min(65536,size-position)),read=await file!.read(bytes,0,bytes.length,position);if(!read.bytesRead)throw new Error('Export spool read incomplete.');position+=read.bytesRead;yield bytes.subarray(0,read.bytesRead);}
   })());
   return {ciphertext,decipher};
  }};
 }catch(error){await cleanup();throw error;}
}
