import {readFile,mkdir,copyFile,access,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {digest} from '../src/local/sqlite.mjs';
const source=resolve(process.env.SAVEN_BACKUP_DIR??''),target=resolve(process.env.SAVEN_RESTORE_DIR??'');
if(!process.env.SAVEN_BACKUP_DIR||!process.env.SAVEN_RESTORE_DIR||source===target)throw Error('Separate backup and new restore paths required');
let exists=true;try{await access(target);}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}if(exists)throw Error('Restore target must not exist');
const manifest=JSON.parse(await readFile(join(source,'manifest.json'),'utf8'));
if(manifest.version!==1||!Array.isArray(manifest.stores)||!Array.isArray(manifest.objects))throw Error('Unsupported backup manifest');
// A WAL-mode snapshot may need SQLite sidecars even for a read-only connection.
// Validate a throwaway copy so a read-only backup mount remains truly untouched.
const validation=await mkdtemp(join(tmpdir(),'saven-restore-validate-'));
try{
for(const row of [...manifest.stores,...manifest.objects]){if(typeof row.path!=='string'||!/^((identity|commerce|fleet|jobs)\.sqlite|tenants\/[A-Za-z0-9_-]+\.sqlite|objects\/[A-Za-z0-9_/-]+)$/.test(row.path)||row.path.split('/').includes('..'))throw Error('Unsafe manifest path');if(digest(await readFile(join(source,row.path)))!==row.sha256)throw Error('Backup checksum mismatch');if(row.path.endsWith('.sqlite')){const copied=join(validation,row.path);await mkdir(dirname(copied),{recursive:true});await copyFile(join(source,row.path),copied);if(digest(await readFile(copied))!==row.sha256)throw Error('Validation copy checksum mismatch');const db=new DatabaseSync(copied,{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Database integrity failed');if(row.path.startsWith('tenants/')){if(db.prepare('SELECT journal_id FROM journal_lines GROUP BY journal_id HAVING sum(debit)<>sum(credit)').all().length)throw Error('Unbalanced backup journal');if(db.prepare('SELECT b.company FROM stock_balances b WHERE b.quantity<>(SELECT coalesce(sum(m.quantity_delta),0) FROM stock_movements m WHERE m.company=b.company AND m.warehouse=b.warehouse AND m.item=b.item) OR b.value<>(SELECT coalesce(sum(m.value_delta),0) FROM stock_movements m WHERE m.company=b.company AND m.warehouse=b.warehouse AND m.item=b.item)').all().length)throw Error('Stock backup does not reconcile');}}finally{db.close();}}}
}finally{
 if(dirname(resolve(validation))!==resolve(tmpdir()))throw Error('Unsafe validation cleanup path');
 await rm(validation,{recursive:true,force:true});
}
for(const required of ['identity.sqlite','commerce.sqlite','fleet.sqlite','jobs.sqlite'])if(!manifest.stores.some(s=>s.path===required))throw Error('Incomplete control backup');
await mkdir(target,{recursive:false,mode:0o700});for(const row of [...manifest.stores,...manifest.objects]){const out=join(target,row.path);await mkdir(dirname(out),{recursive:true});await copyFile(join(source,row.path),out);if(digest(await readFile(out))!==row.sha256)throw Error('Restored file checksum mismatch');}await mkdir(join(target,'objects'),{recursive:true});console.log(JSON.stringify({restored:true,stores:manifest.stores.length,objects:manifest.objects.length,requires:'Independent sign-in, business/entitlement and application checks before cutover'}));
