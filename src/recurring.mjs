import {requireThat,AppError} from './errors.mjs';
import {companyAccess,canPrepare} from './auth.mjs';
import {canonical} from './crypto.mjs';
import {normalizeExtended} from './extended-accounting.mjs';
import {object,text,date,databaseError} from './operating.mjs';

export function occurrenceDate(firstDate,everyMonths,index){
 date(firstDate);requireThat([1,3,12].includes(everyMonths)&&Number.isInteger(index)&&index>=0&&index<120,422,'INVALID_OCCURRENCE','Choose a supported schedule occurrence.');
 const [year,month,day]=firstDate.split('-').map(Number),offset=month-1+everyMonths*index,y=year+Math.floor(offset/12),m=offset%12;
 requireThat(y<=9999,422,'INVALID_DATE','The schedule exceeds the supported calendar.');
 const last=[31,(y%4===0&&(y%100!==0||y%400===0))?29:28,31,30,31,30,31,31,30,31,30,31][m];
 return `${String(y).padStart(4,'0')}-${String(m+1).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;
}
export function normalizeSchedule(p){
 object(p,['code','name','description','firstDate','everyMonths','occurrences','lines']);
 const code=text(p.code,'schedule code',20).toUpperCase();requireThat(/^[A-Z0-9][A-Z0-9_-]*$/.test(code),422,'INVALID_CODE','Use letters, digits, underscores or hyphens for the schedule code.');
 const firstDate=date(p.firstDate),everyMonths=p.everyMonths,occurrences=p.occurrences;
 requireThat([1,3,12].includes(everyMonths)&&Number.isInteger(occurrences)&&occurrences>=1&&occurrences<=120,422,'INVALID_SCHEDULE','Choose monthly, quarterly or annual frequency and 1 to 120 occurrences.');
 occurrenceDate(firstDate,everyMonths,occurrences-1);
 const journal=normalizeExtended({kind:'journal',date:firstDate,reference:code,description:text(p.description,'accounting description',500),lines:p.lines});
 return {code,name:text(p.name,'schedule name'),description:journal.description,firstDate,everyMonths,occurrences,lines:journal.lines};
}
async function access(db,actor,cid){
 const company=await companyAccess(db,actor,cid);requireThat(db.schemaVersion>=9,503,'UPGRADE_REQUIRED','Recurring journals are being installed.');
 requireThat(!(await db.prepare('SELECT resource_id FROM resource_denials WHERE company_id=? AND user_id=? LIMIT 1').bind(cid,actor.id).first()),403,'REPORT_ACCESS','Recurring schedules require complete company resource access.');return company;
}
const scheduleRow=r=>({...r,lines:typeof r.lines_json==='string'?JSON.parse(r.lines_json):r.lines_json,lines_json:undefined});
export async function recurringList(db,actor,cid){const company=await access(db,actor,cid);const schedules=(await db.prepare('SELECT * FROM recurring_schedules WHERE company_id=? ORDER BY created_at DESC,id DESC LIMIT 201').bind(cid).all()).results;return {canManage:['owner','admin'].includes(company.role),canPrepare:canPrepare(company.role),limited:schedules.length>200,schedules:schedules.slice(0,200).map(scheduleRow)};}
export async function recurringDetail(db,actor,cid,id){
 await access(db,actor,cid);const row=await db.prepare('SELECT * FROM recurring_schedules WHERE company_id=? AND id=?').bind(cid,id).first();requireThat(row,404,'NOT_FOUND','The recurring schedule is unavailable.');
 const runs=(await db.prepare('SELECT r.occurrence_no,r.attempt,r.document_id,d.status,d.reference FROM recurring_runs r JOIN documents d ON d.company_id=r.company_id AND d.id=r.document_id WHERE r.company_id=? AND r.schedule_id=? ORDER BY r.occurrence_no,r.attempt').bind(cid,id).all()).results;
 return {schedule:scheduleRow(row),occurrences:Array.from({length:row.occurrences},(_,index)=>{const attempts=runs.filter(r=>r.occurrence_no===index),active=attempts.find(r=>r.status!=='rejected');return {index,date:occurrenceDate(row.first_date,row.every_months,index),status:active?.status??(attempts.length?'returned':'unprepared'),documentId:active?.document_id??null,nextAttempt:attempts.length+1,attempts};})};
}
export async function recurringDocument(db,actor,cid,id,index,attempt){
 const company=await access(db,actor,cid);requireThat(canPrepare(company.role),403,'PREPARATION_DENIED','Your role cannot prepare transactions.');
 const row=await db.prepare('SELECT * FROM recurring_schedules WHERE company_id=? AND id=?').bind(cid,id).first();requireThat(row,404,'NOT_FOUND','The recurring schedule is unavailable.');
 requireThat(row.enabled,409,'SCHEDULE_PAUSED','This schedule is paused. An administrator must resume it.');
 requireThat(Number.isInteger(index)&&index>=0&&index<row.occurrences&&Number.isInteger(attempt)&&attempt>=1&&attempt<=1000,422,'INVALID_OCCURRENCE','Choose an available occurrence and attempt.');
 const runs=(await db.prepare('SELECT r.attempt,d.status FROM recurring_runs r JOIN documents d ON d.company_id=r.company_id AND d.id=r.document_id WHERE r.company_id=? AND r.schedule_id=? AND r.occurrence_no=? ORDER BY r.attempt').bind(cid,id,index).all()).results;
 requireThat(!runs.some(r=>r.status!=='rejected')&&attempt===runs.length+1,409,'OCCURRENCE_EXISTS','This occurrence was already prepared or its retry changed. Refresh the schedule.');
 const accountingDate=occurrenceDate(row.first_date,row.every_months,index);
 return {kind:'journal',date:accountingDate,reference:`${row.code}-${accountingDate}-A${attempt}`,description:row.description,lines:scheduleRow(row).lines,recurrence:{scheduleId:id,index,attempt}};
}
export async function validateRecurring(db,actor,cid,document){if(!document.recurrence)return;const r=document.recurrence,expected=await recurringDocument(db,actor,cid,r.scheduleId,r.index,r.attempt);requireThat(canonical(document)===canonical(expected),409,'SCHEDULE_CHANGED','The journal must exactly match its immutable schedule. Prepare a fresh occurrence.');}
export async function recurringCommand(db,actor,cid,input,key){
 const company=await access(db,actor,cid);requireThat(['owner','admin'].includes(company.role),403,'ADMIN_REQUIRED','A company administrator must manage recurring templates.');object(input,['action','data','expectedRevision']);requireThat(['create','pause','resume'].includes(input.action),422,'INVALID_ACTION','Choose create, pause or resume.');requireThat(Number.isSafeInteger(input.expectedRevision)&&input.expectedRevision>0&&typeof key==='string'&&/^[a-zA-Z0-9_-]{16,128}$/.test(key),422,'VERSION_REQUIRED','Refresh the workspace and use a stable command key.');
 const p=input.action==='create'?normalizeSchedule(input.data):(object(input.data,['id','reason']),{id:text(input.data.id,'schedule'),reason:text(input.data.reason,'change reason',500)});
 try{return (await db.prepare('SELECT saven_recurring_admin(?,?,?,?,?) AS result').bind(cid,input.action,JSON.stringify(p),input.expectedRevision,key).first()).result;}catch(error){if(String(error.message).includes('INVALID_SCHEDULE'))throw new AppError(422,'INVALID_SCHEDULE','Check the schedule dates, balanced lines and active general-ledger accounts.');databaseError(error);}
}
