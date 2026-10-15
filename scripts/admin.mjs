import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {token,digest} from '../src/auth.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args=process.argv.slice(2),local=args.includes('--local'),email=args.find(x=>x.startsWith('--email='))?.slice(8),origin=args.find(x=>x.startsWith('--origin='))?.slice(9)||'http://localhost:8765';
if(!local&&!args.includes('--remote'))throw Error('Escolha explicitamente --local ou --remote.');
if(!local&&!origin.startsWith('https://'))throw Error('Informe --origin=https://seu-dominio para o banco remoto.');
if(!email||!/^\S+@\S+\.\S+$/.test(email))throw Error('Informe --email=seu@email.com. Use --local para o banco de desenvolvimento e --origin=https://seu-worker.workers.dev para produção.');
const u=crypto.randomUUID(),t=token(),hash=await digest(t),expires=Date.now()+86400000;
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
const sql=`INSERT INTO users(id,email,name,admin,active,units) SELECT ${quote(u)},${quote(email.toLowerCase())},'Administrador',1,1,'[]' WHERE NOT EXISTS(SELECT 1 FROM users WHERE admin=1);
INSERT INTO invites(token,user,expires) SELECT ${quote(hash)},id,${expires} FROM users WHERE admin=1 AND email=${quote(email.toLowerCase())} ON CONFLICT(user) DO UPDATE SET token=excluded.token,expires=excluded.expires;`;
fs.mkdirSync(path.join(root,'.wrangler'),{recursive:true});const file=path.join(root,'.wrangler','admin-invite.sql');fs.writeFileSync(file,sql);
try{const result=spawnSync(process.execPath,[path.join(root,'node_modules','wrangler','bin','wrangler.js'),'d1','execute','crm-mailings',local?'--local':'--remote','--file',file,'--yes'],{cwd:root,stdio:'inherit'});if(result.status!==0)throw Error('Não foi possível gerar o acesso.');console.log('Convite do administrador (válido somente se o e-mail corresponde ao administrador do banco):\n'+origin.replace(/\/$/,'')+'/#convite='+t);}finally{fs.unlinkSync(file);}
