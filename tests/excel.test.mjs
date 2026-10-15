import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {parseExcel,HEADERS} from '../src/excel.js';
export function fixture(){const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');const row=(values,n)=>'<row>'+values.map((v,i)=>`<c r="${String.fromCharCode(65+i)}${n}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')+'</row>';
 const values=HEADERS.map(h=>({'USUÁRIO DA SAÚDE':'Pessoa Fictícia','DATA DE NASCIMENTO':'15/06/1985','CPF':'01234567890','CNS USUÁRIO SAÚDE':'000000000000001','PROCEDIMENTO':'CONSULTA FICTÍCIA','ESTABELECIMENTO SOLICITANTE':'UBS PEDRO IZZO','DATA SOLICITAÇÃO':'01/10/2026','SITUAÇÃO':'APROVADO'}[h]||''));
 return zipSync({'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Dados" r:id="r1"/></sheets></workbook>'),'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>'),'xl/worksheets/sheet1.xml':strToU8('<worksheet><sheetData>'+row(HEADERS,1)+row(values,2)+row(values.map((v,i)=>i===6?'UNIDADE FORA DO APOIO':v),3)+'</sheetData></worksheet>')});}
test('Excel preserva zeros, ignora unidades fora do de/para e remove situação da fonte',()=>{const parsed=parseExcel(fixture());assert.equal(parsed.records.length,1);assert.equal(parsed.ignored,1);assert.equal(parsed.records[0].cpf,'01234567890');assert.equal(parsed.records[0].birth,'1985-06-15');assert.equal(parsed.records[0].status,undefined);});
test('arquivo inválido é rejeitado',()=>assert.throws(()=>parseExcel(strToU8('não é excel'))));
