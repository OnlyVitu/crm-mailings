import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const context={};vm.runInNewContext(fs.readFileSync(new URL('../public/crm_domain.js',import.meta.url),'utf8'),context);const {metrics}=context.CRM;
test('tentativas contam preenchimento e permanecem pendentes; médias não incluem contatos ausentes',()=>{
 const lots=[{id:'a',published:'2026-10-01T03:00:00Z'}],rows=[{lot:'a',status:'1ª TENTATIVA',contacts:['2026-10-03','',''],updated:'2026-10-03T03:00:00Z'},{lot:'a',status:'AGENDADO',contacts:['2026-10-02','2026-10-04','2026-10-07'],updated:'2026-10-07T03:00:00Z',completedAt:'2026-10-08T03:00:00Z'},{lot:'a',status:'',contacts:['','',''],updated:null}];
 const m=metrics(rows,lots,'2026-10-10T03:00:00Z');assert.equal(m.total,3);assert.equal(m.filled,2);assert.equal(m.done,1);assert.equal(m.pending,2);assert.equal(m.stalled,2);assert.equal(m.completion,33);assert.equal(m.contacts[0].value,1.5);assert.equal(m.contacts[0].n,2);assert.equal(m.contacts[2].value,6);assert.equal(m.gaps[0].value,2);assert.equal(m.gaps[1].value,3);assert.equal(m.finish.value,7);
});
test('base vazia não fabrica médias nem percentuais',()=>{const m=metrics([],[]);assert.equal(m.completion,0);assert.equal(m.finish.value,null);assert.equal(m.contacts[0].n,0);});
