export async function downloadAccountingExport(endpoint,parameters){
 const response=await fetch(endpoint+'?'+new URLSearchParams(parameters),{credentials:'same-origin'});
 if(!response.ok){const result=await response.json();throw Error(result.error?.message??'The export could not be completed.');}
 const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??'SAVEN-accounting.csv';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
