import {timingSafeEqual} from 'node:crypto';
export function requestOrigin(host,headers,{appOrigin,operatorOrigin,relayOrigin,relayKey}){
 const direct=[new URL(appOrigin),new URL(operatorOrigin)].find(o=>o.host===host);if(direct)return direct.origin;
 if(!relayOrigin||new URL(relayOrigin).host!==host||!/^[a-f0-9]{64}$/.test(relayKey??''))return null;
 const supplied=headers['x-sa7en-relay-key'],origin=headers['x-sa7en-relay-origin'];
 if(typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(relayKey,'hex')))return null;
 return [appOrigin,operatorOrigin].map(o=>new URL(o).origin).includes(origin)?origin:null;
}
