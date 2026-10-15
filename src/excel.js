import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';
import config from './config.json' with {type:'json'};
export const HEADERS=['USUÁRIO DA SAÚDE','DATA DE NASCIMENTO','CPF','CNS USUÁRIO SAÚDE','PROCEDIMENTO','ÁREA DO CORPO','ESTABELECIMENTO SOLICITANTE','DATA SOLICITAÇÃO','DATA CRIAÇÃO SOLICITAÇÃO','DATA ENTRADA REGULAÇÃO','DATA ATENDIMENTO','PROFISSIONAL SOLICITANTE','ESPECIALIDADE DO PROFISSIONAL','DIAGNÓSTICO','TEL CELULAR','TEL. RECADO','TEL. RESIDENCIAL','TIPO DA SOLICITAÇÃO','SITUAÇÃO','PRIORIDADE','QUANTIDADE PROCEDIMENTOS','ORIGEM DA SOLICITAÇÃO','QUEM APROVOU SOLICITAÇÃO:'];
export const norm=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().replace(/\s+/g,' ');
const arr=v=>v==null?[]:Array.isArray(v)?v:[v];
const text=v=>typeof v==='object'?String(v?.['#text']??''):String(v??'');
function runs(v){if(v==null)return '';return arr(v.r).length?arr(v.r).map(r=>text(r.t)).join(''):text(v.t);}
function date(v){if(v==null||v==='')return '';if(typeof v==='number')return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10);const s=String(v),b=s.match(/^(\d{2})\/(\d{2})\/(\d{4})/),i=s.match(/^\d{4}-\d{2}-\d{2}/);const d=b?`${b[3]}-${b[2]}-${b[1]}`:i?.[0];if(!d||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d)throw Error('Data inválida na planilha.');return d;}
export function parseExcel(bytes){
 if(bytes.length>15*1024*1024)throw Error('Limite de 15 MB por Excel.');let expanded=0;
 const zip=unzipSync(bytes,{filter:f=>{expanded+=f.originalSize;if(expanded>100*1024*1024)throw Error('Excel expandido excede 100 MB.');return /^(xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml))$/.test(f.name);}});
 const parser=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@',removeNSPrefix:true,parseTagValue:false,processEntities:true});
 const xml=n=>{if(!zip[n])throw Error('Estrutura Excel incompleta: '+n);const s=strFromU8(zip[n]);if(/<!DOCTYPE|<!ENTITY/i.test(s))throw Error('XML não permitido.');return parser.parse(s);};
 const sheets=arr(xml('xl/workbook.xml').workbook?.sheets?.sheet);if(sheets.length!==1)throw Error('Use um Excel com uma única aba de dados.');
 const rel=arr(xml('xl/_rels/workbook.xml.rels').Relationships?.Relationship).find(r=>r['@Id']===sheets[0]['@id']);if(!rel)throw Error('Aba não encontrada.');
 let target=String(rel['@Target']);target=target.startsWith('/')?target.slice(1):'xl/'+target;target=target.replaceAll('/./','/');if(!/^xl\/worksheets\/[^/]+\.xml$/.test(target))throw Error('Aba inválida.');
 const shared=zip['xl/sharedStrings.xml']?arr(xml('xl/sharedStrings.xml').sst?.si).map(runs):[];
 const rows=arr(xml(target).worksheet?.sheetData?.row).map(row=>{const result=[];for(const c of arr(row.c)){if(c.f!==undefined)throw Error('Importe valores, sem fórmulas.');const ref=String(c['@r']||'').match(/^[A-Z]+/);if(!ref)throw Error('Célula inválida.');let index=0;for(const char of ref[0])index=index*26+char.charCodeAt(0)-64;if(index>1000)throw Error('Colunas excedem a estrutura esperada.');const type=c['@t'];let value=type==='s'?shared[Number(c.v)]??'':type==='inlineStr'?runs(c.is):text(c.v);if(!type&&value!==''&&Number.isFinite(Number(value)))value=Number(value);result[index-1]=value;}return result;}).filter(r=>r.some(v=>String(v??'').trim()));
 if(rows.length<2)throw Error('Excel sem registros.');if(rows.length>20001)throw Error('Limite de 20.000 linhas por mailing.');
 const headers=rows.shift().map(norm);if(headers.length!==HEADERS.length||new Set(headers).size!==HEADERS.length||HEADERS.some(h=>!headers.includes(norm(h))))throw Error('O Excel precisa dos 23 cabeçalhos da base de aprovados.');
 const at=h=>headers.indexOf(norm(h));let ignored=0;const records=[];
 for(const row of rows){const value=h=>String(row[at(h)]??'').trim();if(!value('USUÁRIO DA SAÚDE'))throw Error('Linha sem usuário da saúde.');const unit=config.units.find(u=>norm(u)===norm(value('ESTABELECIMENTO SOLICITANTE')));if(!unit){ignored++;continue;}const identifier=(h,n)=>/^\d+$/.test(value(h))?value(h).padStart(n,'0'):value(h);
  records.push({unit,name:value('USUÁRIO DA SAÚDE'),birth:date(row[at('DATA DE NASCIMENTO')]),cpf:identifier('CPF',11),cns:identifier('CNS USUÁRIO SAÚDE',15),procedure:value('PROCEDIMENTO'),requested:date(row[at('DATA SOLICITAÇÃO')]),phone:value('TEL CELULAR'),phone2:value('TEL. RECADO'),phone3:value('TEL. RESIDENCIAL'),professional:value('PROFISSIONAL SOLICITANTE'),priority:value('PRIORIDADE')});
 }
 if(!records.length)throw Error('Nenhuma linha pertence ao de/para de unidades.');return {records,ignored};
}
