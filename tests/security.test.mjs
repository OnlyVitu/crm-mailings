import test from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {build} from 'esbuild';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {digest,passwordHash} from '../src/auth.js';
test('D1: convite único, autenticação, UBS, revogação e escrita exclusiva do administrador',async()=>{
 const bundle=await build({entryPoints:[fileURLToPath(new URL('../src/worker.js',import.meta.url))],bundle:true,write:false,format:'esm',platform:'browser',external:['node:crypto']});
 const mf=new Miniflare(convertV4MiniflareOptions({name:"crm-test",modules:true,script:new TextDecoder().decode(bundle.outputFiles[0].contents),compatibilityDate:'2026-10-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'test-db'},bindings:{APP_ORIGIN:'http://localhost'}}));
 try{const db=await mf.getD1Database('DB');await db.exec(fs.readFileSync(new URL('../migrations/0001_initial.sql',import.meta.url),'utf8'));
  const adminPassword=await passwordHash('SenhaAdministrador123!');await db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?,?)').bind('adm','adm@example.com','Administrador',1,1,'[]',adminPassword).run();
  const post=(route,data,cookie)=>mf.dispatchFetch('http://localhost/api/'+route,{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(data)});
  assert.equal((await mf.dispatchFetch('http://localhost/api/state')).status,401);
  let r=await post('login',{email:'adm@example.com',password:'SenhaAdministrador123!'});assert.equal(r.status,200);const admin=r.headers.get('Set-Cookie').split(';')[0];
  r=await post('user',{name:'Ana',email:'ana@example.com',active:true,units:['UBS PEDRO IZZO']},admin);assert.equal(r.status,200);const invitation=await r.json(),t=new URLSearchParams(new URL(invitation.inviteUrl).hash.slice(1)).get('convite');
  assert.equal((await post('activate',{token:t,password:'SenhaUsuarioTeste123!'})).status,200);assert.equal((await post('activate',{token:t,password:'SenhaUsuarioTeste456!'})).status,400);
  r=await post('login',{email:'ana@example.com',password:'SenhaUsuarioTeste123!'});const user=r.headers.get('Set-Cookie').split(';')[0];assert.equal(r.status,200);
  assert.equal((await post('user',{name:'Intruso'},user)).status,403);
  const at=new Date().toISOString(),day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const lot={id:'l',name:'Teste.xlsx',published:at,extracted:at,count:2,ignored:0};await db.prepare('INSERT INTO lots(id,hash,data) VALUES(?,?,?)').bind('l','test',JSON.stringify(lot)).run();
  for(const[id,unit]of [['r1','UBS PEDRO IZZO'],['r2','UBS ALDEIA DA SERRA']]){const record={id,lot:'l',unit,name:'Fictício',procedure:'Fictício',status:'',contacts:['','',''],version:0};await db.prepare('INSERT INTO records VALUES(?,?,?,?,?)').bind(id,'l',unit,0,JSON.stringify(record)).run();}
  let state=await (await mf.dispatchFetch('http://localhost/api/state',{headers:{Cookie:user}})).json();assert.equal(state.records.length,1);assert.equal(state.records[0].id,'r1');assert.equal(state.users.length,1);
  assert.equal((await post('record',{id:'r2',version:0,status:'CIENTE',contacts:[day,'','']},user)).status,403);
  assert.equal((await post('record',{id:'r1',version:0,status:'CIENTE',contacts:[day,'','']},user)).status,200);
  assert.equal((await post('record',{id:'r1',version:0,status:'CIENTE',contacts:[day,'','']},user)).status,409);
  const ana=state.me;assert.equal((await post('user',{...ana,units:[]},admin)).status,200);state=await (await mf.dispatchFetch('http://localhost/api/state',{headers:{Cookie:user}})).json();assert.equal(state.records.length,0);
  assert.equal((await post('record',{id:'r1',version:1,status:'CIENTE',contacts:[day,'','']},user)).status,403);
  assert.equal((await post('user',{...ana,active:false},admin)).status,200);assert.equal((await mf.dispatchFetch('http://localhost/api/state',{headers:{Cookie:user}})).status,401);
  assert.equal((await mf.dispatchFetch('http://localhost/api/user',{method:'POST',headers:{Origin:'http://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
 }finally{await mf.dispose();}
});
