// Run only after stopping the native application. A running PID/lock check is
// enforced by the deployment wrapper; do not treat concurrent copies as atomic.
import {DatabaseSync} from 'node:sqlite';
import {mkdir,readdir,copyFile,readFile,writeFile,lstat} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {verifiedBackup,digest} from '../src/local/sqlite.mjs';
const root=resolve(process.env.SAVEN_DATA_DIR),destination=resolve(process.env.SAVEN_BACKUP_DIR??'');
if(!process.env.SAVEN_BACKUP_DIR||destination===root||destination.startsWith(root+'/')||destination.startsWith(root+'\\'))throw Error('A separate, new backup directory is required');
if(process.env.SAVEN_CONFIRMED_STOPPED!=='yes')throw Error('Stop the application and confirm the maintenance gate before backup');
await mkdir(destination,{recursive:false,mode:0o700});
const manifest={version:1,createdAt:new Date().toISOString(),consistency:'Application stopped, no background writers',stores:[],objects:[]};
async function store(name){const source=join(root,name);if((await lstat(source)).isSymbolicLink())throw Error('Symlink rejected');const db=new DatabaseSync(source,{readOnly:true});try{const path=join(destination,name);await mkdir(dirname(path),{recursive:true});const result=await verifiedBackup(db,path);manifest.stores.push({path:name,...result,sha256:digest(await readFile(path))});}finally{db.close();}}
for(const name of ['identity','commerce','fleet','jobs'])await store(name+'.sqlite');
for(const name of await readdir(join(root,'tenants'))){if(!name.endsWith('.sqlite'))continue;if(!/^[A-Za-z0-9_-]{1,80}\.sqlite$/.test(name))throw Error('Unsafe tenant filename');await store('tenants/'+name);}
async function copyObjects(source){for(const name of await readdir(source)){const p=join(source,name),stat=await lstat(p);if(stat.isSymbolicLink())throw Error('Symlink rejected in backup');if(stat.isDirectory())await copyObjects(p);else{const rel=relative(join(root,'objects'),p),out=join(destination,'objects',rel);await mkdir(dirname(out),{recursive:true});await copyFile(p,out);manifest.objects.push({path:'objects/'+rel.replaceAll('\\','/'),sha256:digest(await readFile(out))});}}}
await copyObjects(join(root,'objects'));
await writeFile(join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({backedUp:true,stores:manifest.stores.length,objects:manifest.objects.length}));
