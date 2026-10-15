import { timingSafeEqual } from 'node:crypto';
const encoder=new TextEncoder();
export const token=()=>Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
export const digest=async t=>Buffer.from(await crypto.subtle.digest('SHA-256',typeof t==='string'?encoder.encode(t):t)).toString('hex');
export async function passwordHash(p,salt=token()){
 const key=await crypto.subtle.importKey('raw',encoder.encode(p),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:encoder.encode(salt),iterations:100000},key,256);
 return `pbkdf2:100000:${salt}:${Buffer.from(bits).toString('hex')}`;
}
export async function verify(p,stored){if(!stored)return false;const salt=stored.split(':')[2];const actual=await passwordHash(p,salt);return actual.length===stored.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(stored));}
export const publicUser=u=>({id:u.id,email:u.email,name:u.name,admin:!!u.admin,active:!!u.active,units:JSON.parse(u.units),activated:!!u.password});
export function fail(message,status=400){throw Object.assign(Error(message),{status});}
export async function boundedJson(request){const reader=request.body?.getReader();if(!reader)fail('Conteúdo ausente.');let size=0;const chunks=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>22*1024*1024){await reader.cancel();fail('Conteúdo excede o limite.',413);}chunks.push(value);}const raw=new Uint8Array(size);let at=0;for(const c of chunks){raw.set(c,at);at+=c.length;}try{return JSON.parse(new TextDecoder().decode(raw));}catch{fail('Conteúdo inválido.');}}
