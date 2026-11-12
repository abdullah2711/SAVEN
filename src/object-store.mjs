import {mkdir,open,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createConnection} from 'node:net';
import {AppError,requireThat} from './errors.mjs';

export const FILE_LIMIT=10*1024*1024;
export function fingerprint(bytes){return createHash('sha256').update(bytes).digest('hex');}
export function inspectFile(name,bytes){
 requireThat(typeof name==='string'&&name.length>0&&name.length<=180&&!/[\u0000-\u001f\u007f/\\]/.test(name)&&!name.startsWith('.'),422,'FILE_NAME','Use a plain filename of at most 180 characters.');
 requireThat(bytes.length>0&&bytes.length<=FILE_LIMIT,413,'FILE_SIZE','Upload a file between 1 byte and 10 MB.');
 const ext=name.toLowerCase().split('.').pop();let media;
 if(ext==='pdf'&&bytes.subarray(0,5).toString()==='%PDF-')media='application/pdf';
 if(ext==='png'&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))media='image/png';
 if(['jpg','jpeg'].includes(ext)&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)media='image/jpeg';
 if(['txt','csv'].includes(ext)){try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);requireThat(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text),422,'FILE_TYPE','The text file contains unsupported control characters.');media=ext==='csv'?'text/csv':'text/plain';}catch(error){if(error instanceof AppError)throw error;}}
 requireThat(media,422,'FILE_TYPE','Supported files are PDF, PNG, JPEG, UTF-8 text and CSV. The contents must match the filename.');
 return {name,mediaType:media,sha256:fingerprint(bytes),byteSize:bytes.length};
}
export async function fileBody(request){
 requireThat(request.headers.get('content-type')?.split(';')[0]==='application/octet-stream',415,'BINARY_REQUIRED','Upload the original file bytes.');
 const reader=request.body?.getReader();requireThat(reader,400,'BODY_REQUIRED','Choose a file.');const chunks=[];let total=0;
 while(true){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>FILE_LIMIT){await reader.cancel();throw new AppError(413,'FILE_SIZE','The file exceeds 10 MB.');}chunks.push(Buffer.from(value));}
 return Buffer.concat(chunks,total);
}
export class LocalBucket{
 constructor(root){requireThat(typeof root==='string'&&root.length>0,503,'STORAGE_UNAVAILABLE','Private file storage is not configured.');this.root=resolve(root);}
 async location(company,id,sha){requireThat(/^[a-zA-Z0-9_-]{1,80}$/.test(company)&&/^[a-f0-9-]{36}$/.test(id)&&/^[a-f0-9]{64}$/.test(sha),422,'OBJECT_KEY','Invalid object reference.');await mkdir(this.root,{recursive:true,mode:0o700});const root=await realpath(this.root),dir=resolve(root,company,id);await mkdir(dir,{recursive:true,mode:0o700});const actual=await realpath(dir);requireThat(actual.startsWith(root+sep),403,'OBJECT_KEY','The object path is outside storage.');return resolve(actual,sha);}
 async put(company,id,meta,bytes){const path=await this.location(company,id,meta.sha256);requireThat(fingerprint(bytes)===meta.sha256,422,'OBJECT_HASH','The file content changed.');const file=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}return path;}
 async get(company,id,meta){const file=await open(await this.location(company,id,meta.sha256),constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const stat=await file.stat();requireThat(stat.isFile()&&stat.size===Number(meta.byte_size)&&stat.size<=FILE_LIMIT,409,'OBJECT_INTEGRITY','The retained file is unavailable or changed.');const bytes=await file.readFile();requireThat(fingerprint(bytes)===meta.sha256,409,'OBJECT_INTEGRITY','The retained file did not pass its integrity check.');return bytes;}finally{await file.close();}}
}
export function scanWithClamd(bytes,{host='saven-antivirus',port=3310,timeout=15000}={}){
 return new Promise((resolveScan,reject)=>{const socket=createConnection({host,port});let response='',finished=false;const finish=(error,result)=>{if(finished)return;finished=true;socket.destroy();error?reject(error):resolveScan(result);};socket.setTimeout(timeout,()=>finish(new AppError(503,'SCANNER_UNAVAILABLE','Virus scanning timed out. The file remains quarantined.')));socket.on('error',()=>finish(new AppError(503,'SCANNER_UNAVAILABLE','Virus scanning is unavailable. The file remains quarantined.')));socket.on('connect',()=>{socket.write(Buffer.from('zINSTREAM\0'));for(let offset=0;offset<bytes.length;offset+=65536){const part=bytes.subarray(offset,offset+65536),size=Buffer.alloc(4);size.writeUInt32BE(part.length);socket.write(size);socket.write(part);}socket.write(Buffer.alloc(4));});socket.on('data',chunk=>{response+=chunk.toString();if(response.length>2048){finish(new AppError(503,'SCANNER_UNAVAILABLE','The scanner returned an invalid response.'));return;}if(response.includes('\0')){if(/: OK\x00/.test(response))finish(null,'clean');else if(/ FOUND\x00/.test(response))finish(null,'infected');else finish(new AppError(503,'SCANNER_UNAVAILABLE','The scanner could not inspect this file.'));}});socket.on('end',()=>{if(!finished)finish(new AppError(503,'SCANNER_UNAVAILABLE','The scanner response was incomplete.'));});});
}
export const fileId=()=>randomUUID();
