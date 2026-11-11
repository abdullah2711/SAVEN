import { readdir,readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
let count=0;
for(const dir of ['src','scripts','tests','public']) {
  const files=await readdir(resolve(root,dir));
  for(const file of files.filter(name=>/\.(mjs|js)$/.test(name))) {
    const result=spawnSync(process.execPath,['--check',resolve(root,dir,file)],{encoding:'utf8'});
    if(result.status!==0){process.stderr.write(result.stderr);process.exit(1);}count++;
  }
}
JSON.parse(await readFile(resolve(root,'package.json'),'utf8'));
console.log(`PASS: ${count} JavaScript files parsed; package manifest valid.`);
