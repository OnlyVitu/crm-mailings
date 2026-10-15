import config from './config.json' with {type:'json'};
import {parseExcel} from './excel.js';
import {exportExcel} from './export.js';
import {token,digest,passwordHash,verify,publicUser,fail,boundedJson} from './auth.js';
const FINAL=['RETIRADO','AGENDADO','AGENDADO PELO CALL CENTER','RETIRADO PELO CALL CENTER','CIENTE'];
const STATUS=[...FINAL,'SEM DISPONIBILIDADE','1ª TENTATIVA','2ª TENTATIVA','BLOQUEADO'];
const now=()=>new Date().toISOString();
const statement=(db,sql,...values)=>db.prepare(sql).bind(...values);
const all=async(db,sql,...values)=>(await statement(db,sql,...values).all()).results;
const first=(db,sql,...values)=>statement(db,sql,...values).first();
const run=(db,sql,...values)=>statement(db,sql,...values).run();
const audit=(db,user,action)=>statement(db,'INSERT INTO audit(at,user,action) VALUES(?,?,?)',now(),user,action);
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{...headers,...extra}});
async function throttle(db,key){const at=Date.now();await run(db,'INSERT INTO attempts(key,n,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET n=CASE WHEN expires<? THEN 1 ELSE n+1 END, expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END',key,at+900000,at,at);const row=await first(db,'SELECT n FROM attempts WHERE key=?',key);if(row.n>10)fail('Muitas tentativas. Aguarde 15 minutos.',429);}
async function getSession(request,db){const raw=String(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('crm_session='))?.slice(12);if(!raw)return null;return first(db,'SELECT u.* FROM users u JOIN sessions s ON s.user=u.id WHERE s.token=? AND s.expires>? AND u.active=1',await digest(raw),Date.now());}
async function getState(db,u){const units=JSON.parse(u.units);const records=u.admin?await all(db,"SELECT r.data FROM records r JOIN lots l ON l.id=r.lot WHERE l.status='ready'"):units.length?await all(db,`SELECT r.data FROM records r JOIN lots l ON l.id=r.lot WHERE l.status='ready' AND r.unit IN (${units.map(()=>'?').join(',')})`,...units):[];
 const rows=records.map(r=>JSON.parse(r.data)),ids=[...new Set(rows.map(r=>r.lot))];
 return {me:publicUser(u),users:u.admin?(await all(db,'SELECT * FROM users WHERE admin=0')).map(publicUser):[publicUser(u)],records:rows,lots:(u.admin?await all(db,"SELECT data FROM lots WHERE status='ready'"):ids.length?await all(db,`SELECT data FROM lots WHERE status='ready' AND id IN (${ids.map(()=>'?').join(',')})`,...ids):[]).map(x=>JSON.parse(x.data)),activity:u.admin?await all(db,'SELECT a.at,a.action AS text,u.name AS by FROM audit a JOIN users u ON a.user=u.id ORDER BY a.id DESC LIMIT 100'):[]};
}
function inviteStatement(db,user,origin){const t=token(),expires=Date.now()+86400000;return digest(t).then(hash=>({stmt:statement(db,'INSERT INTO invites(token,user,expires) VALUES(?,?,?) ON CONFLICT(user) DO UPDATE SET token=excluded.token,expires=excluded.expires',hash,user,expires),inviteUrl:origin+'/#convite='+t,expires}));}
async function api(request,env){const db=env.DB,route=new URL(request.url).pathname,origin=env.APP_ORIGIN||new URL(request.url).origin;
 if(request.method==='POST'){if(request.headers.get('Origin')!==origin)fail('Origem não autorizada.',403);if(!request.headers.get('Content-Type')?.startsWith('application/json'))fail('Conteúdo não autorizado.',415);}
 if(route==='/api/login'&&request.method==='POST'){
  await throttle(db,'login:'+(request.headers.get('CF-Connecting-IP')||'local'));const b=await boundedJson(request);const u=await first(db,'SELECT * FROM users WHERE email=? AND active=1',String(b.email||'').trim().toLowerCase());
  if(typeof b.password!=='string'||b.password.length>128||!u||!await verify(b.password,u.password))fail('E-mail ou senha inválidos.',401);
  const t=token();await db.batch([statement(db,'INSERT INTO sessions VALUES(?,?,?)',await digest(t),u.id,Date.now()+28800000),audit(db,u.id,'Login'),statement(db,'DELETE FROM sessions WHERE expires<?',Date.now()),statement(db,'DELETE FROM attempts WHERE expires<?',Date.now())]);
  return json({ok:true},200,{'Set-Cookie':`crm_session=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${origin.startsWith('https:')?'; Secure':''}`});
 }
 if(route==='/api/activate'&&request.method==='POST'){
  await throttle(db,'activate:'+(request.headers.get('CF-Connecting-IP')||'local'));const b=await boundedJson(request);if(typeof b.password!=='string'||b.password.length<12||b.password.length>128)fail('Use uma senha de 12 a 128 caracteres.');
  const hash=await digest(String(b.token||'')),password=await passwordHash(b.password),inv=await first(db,'SELECT i.*,u.active FROM invites i JOIN users u ON u.id=i.user WHERE i.token=? AND i.expires>?',hash,Date.now());if(!inv?.active)fail('Convite inválido ou expirado. Solicite outro ao administrador.');
  const result=await db.batch([statement(db,'UPDATE users SET password=? WHERE id=? AND active=1 AND EXISTS(SELECT 1 FROM invites WHERE token=? AND user=users.id AND expires>?)',password,inv.user,hash,Date.now()),statement(db,'DELETE FROM sessions WHERE user=? AND EXISTS(SELECT 1 FROM invites WHERE token=?)',inv.user,hash),statement(db,'DELETE FROM invites WHERE token=?',hash)]);
  if(!result[0].meta.changes)fail('Convite inválido ou já utilizado.');await audit(db,inv.user,'Senha definida pelo titular').run();return json({ok:true});
 }
 const u=await getSession(request,db);if(!u)fail('Faça login para continuar.',401);
 if(route==='/api/state'&&request.method==='GET')return json(await getState(db,u));
 if(route==='/api/export'&&request.method==='GET'){
  const state=await getState(db,u),q=new URL(request.url).searchParams;
  const norm=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
  const rows=state.records.filter(r=>(!q.get('lot')||r.lot===q.get('lot'))&&(!q.get('unit')||r.unit===q.get('unit'))&&(!q.get('status')||(q.get('status')==='empty'?!r.status:r.status===q.get('status')))&&(!q.get('search')||norm([r.name,r.cpf,r.cns,r.procedure].join(' ')).includes(norm(q.get('search')))));
  return new Response(exportExcel(rows,state.lots),{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="RECORTE_MICROREGULACAO.xlsx"'}});
 }
 if(route==='/api/logout'&&request.method==='POST'){await run(db,'DELETE FROM sessions WHERE user=?',u.id);return json({ok:true},200,{'Set-Cookie':'crm_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
 if(route==='/api/record'&&request.method==='POST'){
  const b=await boundedJson(request),row=await first(db,"SELECT r.data,r.version FROM records r JOIN lots l ON l.id=r.lot WHERE r.id=? AND l.status='ready'",String(b.id));if(!row)fail('Registro indisponível.',404);const r=JSON.parse(row.data);
  if(!u.admin&&!JSON.parse(u.units).includes(r.unit))fail('Sem acesso a esta unidade.',403);if(b.version!==row.version)fail('Outro usuário alterou o registro. Reabra para revisar.',409);
  if(!['',...STATUS].includes(b.status)||!Array.isArray(b.contacts)||b.contacts.length!==3)fail('Preenchimento inválido.');
  const lot=JSON.parse((await first(db,'SELECT data FROM lots WHERE id=?',r.lot)).data),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const publishedDay=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(lot.published));
  b.contacts.forEach((d,i)=>{if(d!==''&&(typeof d!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d))||new Date(d).toISOString().slice(0,10)!==d||d<publishedDay||d>today||i>0&&(!b.contacts[i-1]||d<b.contacts[i-1])))fail('Datas devem seguir a ordem, entre a publicação e hoje.');});
  if(b.status&&!b.contacts[0])fail('Informe a data do primeiro contato.');
  const before=JSON.stringify(r),at=now();Object.assign(r,{status:b.status,contacts:b.contacts,collaborator:u.name,ownerId:u.id,updated:at,version:row.version+1,completedAt:FINAL.includes(b.status)?(FINAL.includes(r.status)&&r.completedAt?r.completedAt:at):null});
  const updated=JSON.stringify(r),change=await db.batch([statement(db,'UPDATE records SET data=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=1 AND (admin=1 OR EXISTS(SELECT 1 FROM json_each(users.units) WHERE value=records.unit)))',updated,r.id,row.version,u.id),statement(db,'INSERT INTO edits(at,user,record,before,after) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM records WHERE id=? AND data=?)',at,u.id,r.id,before,updated,r.id,updated)]);
  if(!change[0].meta.changes)fail('O registro ou seu acesso mudou. Reabra para revisar.',409);return json(await getState(db,u));
 }
 if(!u.admin)fail('Apenas o administrador pode realizar esta operação.',403);
 if(route==='/api/user'&&request.method==='POST'){
  const b=await boundedJson(request),existing=b.id?await first(db,'SELECT * FROM users WHERE id=? AND admin=0',String(b.id)):null;if(b.id&&!existing)fail('Usuário indisponível.');
  if(typeof b.name!=='string'||!b.name.trim()||b.name.length>80||typeof b.email!=='string'||!/^\S+@\S+\.\S+$/.test(b.email)||b.email.length>120||!Array.isArray(b.units)||b.units.some(x=>!config.units.includes(x)))fail('Verifique nome, e-mail e unidades.');
  const id=existing?.id||crypto.randomUUID(),email=b.email.trim().toLowerCase();if(await first(db,'SELECT id FROM users WHERE email=? AND id<>?',email,id))fail('E-mail já cadastrado.');const changed=existing&&existing.email!==email;
  const statements=[statement(db,'INSERT INTO users VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,email=excluded.email,active=excluded.active,units=excluded.units,password=excluded.password',id,email,b.name.trim(),0,b.active?1:0,JSON.stringify([...new Set(b.units)]),changed?null:existing?.password||null),audit(db,u.id,'Acesso atualizado: '+id)];
  if(!b.active||changed)statements.push(statement(db,'DELETE FROM sessions WHERE user=?',id));if(!b.active)statements.push(statement(db,'DELETE FROM invites WHERE user=?',id));
  let result={};if(b.active&&(!existing||changed||b.renew)){const inv=await inviteStatement(db,id,origin);statements.push(inv.stmt);result={inviteUrl:inv.inviteUrl,expires:inv.expires};}
  await db.batch(statements);return json(result);
 }
 if(route==='/api/import'&&request.method==='POST'){
  const b=await boundedJson(request);if(typeof b.source!=='string'||!b.source.toLowerCase().endsWith('.xlsx')||typeof b.file!=='string')fail('Escolha um Excel .xlsx.');
  const bytes=Buffer.from(b.file,'base64');let parsed;try{parsed=parseExcel(bytes);}catch(e){fail(e.message);}const hash=await digest(bytes);if(await first(db,'SELECT id FROM lots WHERE hash=?',hash))fail('Esta base já foi registrada.',409);
  const id=crypto.randomUUID(),at=now(),name=b.source.split(/[\\/]/).at(-1).slice(0,240),lot={id,name,source:name,hash,published:at,extracted:at,count:parsed.records.length,ignored:parsed.ignored};
  await run(db,"INSERT INTO lots(id,hash,data,status) VALUES(?,?,?,'loading')",id,hash,JSON.stringify(lot));
  try{for(let i=0;i<parsed.records.length;i+=50){await db.batch(parsed.records.slice(i,i+50).map(r=>{const record={...r,id:crypto.randomUUID(),lot:id,status:'',contacts:['','',''],collaborator:'',ownerId:null,updated:null,completedAt:null,version:0};return statement(db,'INSERT INTO records VALUES(?,?,?,?,?)',record.id,id,r.unit,0,JSON.stringify(record));}));}
   await db.batch([statement(db,"UPDATE lots SET status='ready' WHERE id=?",id),audit(db,u.id,'Mailing publicado: '+name+' ('+parsed.records.length+' linhas)')]);
  }catch(e){await db.batch([statement(db,'DELETE FROM records WHERE lot=?',id),statement(db,'DELETE FROM lots WHERE id=?',id)]);throw e;}
  return json(lot);
 }
 fail('Não encontrado.',404);
}
export default {async fetch(request,env){try{if(new URL(request.url).pathname.startsWith('/api/'))return await api(request,env);const response=await env.ASSETS.fetch(request);const out=new Response(response.body,response);for(const[k,v]of Object.entries(headers))out.headers.set(k,v);return out;}catch(e){if(!e.status)console.error(JSON.stringify({event:'request_failed',message:e.message}));return json({error:e.status?e.message:'Falha ao processar a solicitação.'},e.status||500);}}};
