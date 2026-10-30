import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {z} from 'zod';

const MAX_BYTES=256*1024*1024;
const HeaderSchema=z.strictObject({version:z.literal(1),kind:z.enum(['database','deletion_journal']),keyId:z.string().min(1).max(100),createdAt:z.iso.datetime(),expiresAt:z.iso.datetime()});
export function sealArchive(bytes:Buffer,key:Buffer,keyId:string,kind:'database'|'deletion_journal',now=Date.now()){
 if(key.length!==32 || bytes.length>MAX_BYTES)throw new Error('Invalid backup material.');
 const header=Buffer.from(JSON.stringify(HeaderSchema.parse({version:1,kind,keyId,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+(kind==='database'?30*24*3600_000:5*60_000)).toISOString()})));
 const nonce=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(header);
 const size=Buffer.alloc(4);size.writeUInt32BE(header.length);
 return Buffer.concat([size,header,nonce,cipher.update(bytes),cipher.final(),cipher.getAuthTag()]);
}
export function openArchive(archive:Buffer,keys:ReadonlyMap<string,Buffer>,kind:'database'|'deletion_journal',now=Date.now()){
 if(archive.length<34 || archive.length>MAX_BYTES+4096)throw new Error('Invalid encrypted archive.');
 const size=archive.readUInt32BE();if(size<2 || size>2048 || archive.length<4+size+28)throw new Error('Invalid encrypted archive.');
 const headerBytes=archive.subarray(4,4+size);const header=HeaderSchema.parse(JSON.parse(headerBytes.toString('utf8')));const key=keys.get(header.keyId);
 if(header.kind!==kind || !key || key.length!==32)throw new Error('Required archive key is unavailable.');
 const start=Date.parse(header.createdAt),end=Date.parse(header.expiresAt);const maximum=kind==='database'?30*24*3600_000:5*60_000;
 if(start>now+5000 || end<=now || end<=start || end-start>maximum)throw new Error('Archive expired or retention metadata is invalid.');
 const decipher=createDecipheriv('aes-256-gcm',key,archive.subarray(4+size,16+size));decipher.setAAD(headerBytes);decipher.setAuthTag(archive.subarray(-16));
 // Authenticate all bytes before the caller can feed a database restore.
 const bytes=Buffer.concat([decipher.update(archive.subarray(16+size,-16)),decipher.final()]);
 return {header,bytes};
}
