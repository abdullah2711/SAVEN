import { readdir,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
let count=0;
async function checkDirectory(dir){
 for(const entry of await readdir(dir,{withFileTypes:true})){
  const path=resolve(dir,entry.name);
  if(entry.isDirectory())await checkDirectory(path);
  else if(/\.(mjs|js)$/.test(entry.name)){const result=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}count++;}
 }
}
for(const dir of ['src','scripts','tests','public','reference'])await checkDirectory(resolve(root,dir));
JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
console.log(`PASS: ${count} JavaScript files parsed; package manifest valid.`);
// PIVOT-008: the ordinary check above stays dependency-free and runs without
// PostgreSQL. --postgres is the explicit optional database gate; it fails nonzero
// when the disposable cluster is unavailable instead of silently skipping coverage.
if(process.argv.includes('--postgres')){
 const gate=spawnSync(process.execPath,[resolve(root,'scripts/verify-pg-rls.mjs')],{stdio:'inherit'});
 if(gate.error){process.stderr.write(`PIVOT-008 coverage gate could not start: ${gate.error.message}\n`);process.exit(1);}
 if(gate.status!==0)process.exit(gate.status??1);
}
