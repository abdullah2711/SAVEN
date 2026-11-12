const cache=new WeakMap();
export const supportingFilesMarkup=()=>'<section class="section-gap"><label>Supporting documents<input type="file" data-submission-files multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.csv,.xlsx,.docx"></label><p class="muted">Choose up to ten files, 10 MB each. They will be scanned before submission and retained with this transaction.</p><p data-submission-file-status role="status"></p></section>';
export async function submissionFiles(form,filesEndpoint){
 const files=[...(form.querySelector('[data-submission-files]')?.files??[])],status=form.querySelector('[data-submission-file-status]');if(!files.length)return [];
 if(files.length>10||files.some(f=>f.size>10485760))throw Error('Choose up to ten supporting files of 10 MB each.');
 let saved=cache.get(form);if(!saved){saved=new Map();cache.set(form,saved);}const ids=[];
 for(const [index,file] of files.entries()){
  if(status)status.textContent=`Scanning supporting file ${index+1} of ${files.length}: ${file.name}`;
  let entry=saved.get(file);if(!entry){entry={key:crypto.randomUUID()};saved.set(file,entry);}
  if(entry.clean){ids.push(entry.id);continue;}
  const response=await fetch(entry.id?filesEndpoint+'/'+entry.id+'/scan':filesEndpoint,{method:'POST',credentials:'same-origin',headers:entry.id?{'content-type':'application/json'}:{'content-type':'application/octet-stream','x-saven-filename':encodeURIComponent(file.name),'x-saven-visibility':'company','idempotency-key':entry.key},body:entry.id?'{}':file});
  const result=await response.json();if(!response.ok)throw Error(result.error?.message??'The supporting file could not be uploaded.');entry.id=result.id;
  if(result.scanState!=='clean')throw Error(result.message??`Supporting file ${file.name} did not pass scanning. The transaction has not been submitted.`);entry.clean=true;ids.push(entry.id);
 }
 if(status)status.textContent=`${ids.length} supporting file(s) scanned and ready.`;return ids;
}
