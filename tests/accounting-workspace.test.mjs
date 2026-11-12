import test from 'node:test';
import assert from 'node:assert/strict';
import {bankInput,signedMinor} from '../src/accounting.mjs';
import {normalizeExtended} from '../src/extended-accounting.mjs';
import {parseStatementCsv} from '../public/accounting.js';
test('bank statement amounts preserve signed minor units and reject floats or unreconciled rows',()=>{assert.equal(signedMinor('-0.01'),'-1');assert.equal(signedMinor('1000.10'),'100010');assert.throws(()=>signedMinor(1.1));assert.throws(()=>signedMinor('1e3'));assert.throws(()=>bankInput('statement_import',{accountId:'bank',reference:'TEST',from:'2026-01-01',to:'2026-01-31',opening:'0.00',closing:'1.01',lines:[{date:'2026-01-01',reference:'test',amount:'1.00'}]}));});
test('cash transfers reject same-account movements and reversal input cannot supply its own effects',()=>{const base={date:'2026-11-12',reference:'TEST',description:'Testing'};assert.throws(()=>normalizeExtended({...base,kind:'cash_transfer',fromAccountId:'bank',toAccountId:'bank',amount:'1.00'}));assert.throws(()=>normalizeExtended({...base,kind:'reversal',originalDocumentId:'id',lines:[]}));});
test('statement CSV preserves quoted bank references and rejects malformed input',()=>{assert.deepEqual(parseStatementCsv('\uFEFFdate,reference,amount\r\n2026-01-01,"Bank, charge",-10.05\r\n'),[{date:'2026-01-01',reference:'Bank, charge',amount:'-10.05'}]);assert.throws(()=>parseStatementCsv('date,reference,amount\n2026-01-01,"bad,1.00'));assert.throws(()=>parseStatementCsv('date,reference,amount\n2026-01-01,x,1.00,extra'));});
