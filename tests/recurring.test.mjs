import test from 'node:test';
import assert from 'node:assert/strict';
import {occurrenceDate,normalizeSchedule} from '../src/recurring.mjs';
import {normalize} from '../src/commands.mjs';
test('month-end recurrence anchors to the original day across leap years',()=>{
 assert.deepEqual([0,1,2,3].map(i=>occurrenceDate('2027-01-31',1,i)),['2027-01-31','2027-02-28','2027-03-31','2027-04-30']);
 assert.equal(occurrenceDate('2028-02-29',12,1),'2029-02-28');assert.equal(occurrenceDate('2028-02-29',12,4),'2032-02-29');assert.equal(occurrenceDate('2027-11-30',3,1),'2028-02-29');
 assert.throws(()=>occurrenceDate('9999-12-31',12,1));
});
test('schedule input retains exact balanced amounts and rejects control metadata abuse',()=>{
 const p={code:'rent',name:'Monthly rent',description:'Fixed rent journal',firstDate:'2027-01-31',everyMonths:1,occurrences:12,lines:[{accountId:'expense',debit:'123.45',credit:'0'},{accountId:'bank',debit:'0',credit:'123.45'}]},s=normalizeSchedule(p);assert.equal(s.code,'RENT');assert.equal(s.lines[0].debit,'123.45');
 assert.throws(()=>normalizeSchedule({...p,lines:[p.lines[0],{...p.lines[1],credit:'123.44'}]}));assert.throws(()=>normalizeSchedule({...p,occurrences:121}));assert.throws(()=>normalizeSchedule({...p,everyMonths:2}));
 const d={kind:'journal',date:p.firstDate,reference:'RENT-2027-01-31-A1',description:p.description,lines:s.lines,recurrence:{scheduleId:'s1',index:0,attempt:1}};assert.deepEqual(normalize(d).recurrence,d.recurrence);assert.throws(()=>normalize({...d,recurrence:{...d.recurrence,attempt:0}}));assert.throws(()=>normalize({...d,recurrence:{...d.recurrence,postAutomatically:true}}));
});
