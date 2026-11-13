import {scrypt as scryptCallback,randomBytes,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {requireThat} from './errors.mjs';
const scrypt=promisify(scryptCallback);
const params={N:32768,r:8,p:1,maxmem:64*1024*1024};
const dummy='scrypt$1$32768$8$1$'+'0'.repeat(32)+'$'+'0'.repeat(128);
let activeKdfs=0;
async function derive(password,salt){requireThat(activeKdfs<2,429,'SIGN_IN_BUSY','Sign-in is busy. Try again shortly.');activeKdfs++;try{return await scrypt(password,salt,64,params);}finally{activeKdfs--;}}
export async function encodePassword(password){
  requireThat(typeof password==='string'&&password.length>=12&&password.length<=128&&Buffer.byteLength(password)<=512,422,'PASSWORD_LENGTH','Use a password of 12 to 128 characters.');
  const salt=randomBytes(16).toString('hex'),key=await derive(password,salt);
  return `scrypt$1$32768$8$1$${salt}$${key.toString('hex')}`;
}
export async function verifyPassword(password,encoded){
  requireThat(typeof password==='string'&&password.length<=128&&Buffer.byteLength(password)<=512,401,'SIGN_IN_FAILED','The email or password is incorrect.');
  const safe=typeof encoded==='string'&&/^scrypt\$1\$32768\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)?encoded:dummy;
  const parts=safe.split('$'),key=await derive(password,parts[5]);
  return timingSafeEqual(key,Buffer.from(parts[6],'hex'))&&safe!==dummy;
}
