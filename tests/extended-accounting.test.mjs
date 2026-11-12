import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeExtended} from '../src/extended-accounting.mjs';
const base={kind:'journal',date:'2026-11-12',reference:'J-1',description:'Independent decimal journal check'};
test('manual journal normalization uses exact minor units and rejects imbalance/control-shaped fields',()=>{
 const result=normalizeExtended({...base,lines:[{accountId:'a',debit:'0.10',credit:'0.00'},{accountId:'a',debit:'0.20',credit:'0.00'},{accountId:'b',debit:'0.00',credit:'0.30'}]});assert.equal(result.lines.length,3);
 assert.throws(()=>normalizeExtended({...base,lines:[{accountId:'a',debit:'0.10',credit:'0.00'},{accountId:'b',debit:'0.00',credit:'0.11'}]}),e=>e.code==='UNBALANCED_JOURNAL');
 assert.throws(()=>normalizeExtended({...base,lines:[{accountId:'a',debit:'1.00',credit:'1.00'},{accountId:'b',debit:'1.00',credit:'0.00'}]}),e=>e.code==='INVALID_LINE');
});
test('supplier bill and settlement normalization reject floats, negative amounts and invented fields',()=>{
 const receipt={kind:'receipt',date:'2026-11-12',reference:'R-1',description:'Customer receipt',targetDocumentId:'invoice-1',amount:'12.30',cashAccountId:'bank'};
 assert.equal(normalizeExtended(receipt).amount,'12.30');
 for(const amount of [12.3,'-1.00','1.001','1e3'])assert.throws(()=>normalizeExtended({...receipt,amount}));
 assert.throws(()=>normalizeExtended({...receipt,approvedBy:'owner'}),e=>e.code==='INVALID_DOCUMENT');
});
