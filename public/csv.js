export function csvCell(value){
 const text=String(value??'');
 // Retain numeric negatives as numbers. Protect untrusted text from spreadsheet
 // formula interpretation, including whitespace before a formula prefix.
 const numeric=/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(text);
 const safe=(!numeric&&/^\s*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))?"'"+text:text;
 return '"'+safe.replaceAll('"','""')+'"';
}
export function downloadCsv(rows,filename){
 const csv=rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));
 const link=document.createElement('a');link.href=url;link.download=filename;link.click();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
