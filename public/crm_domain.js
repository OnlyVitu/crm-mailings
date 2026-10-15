(function(){
'use strict';
const FINAL = ['RETIRADO','AGENDADO','AGENDADO PELO CALL CENTER','RETIRADO PELO CALL CENTER','CIENTE'];
const STATUS = [...FINAL,'SEM DISPONIBILIDADE','1ª TENTATIVA','2ª TENTATIVA','BLOQUEADO'];
const DAY=86400000;
const day = v => {if(!v)return NaN;const s=String(v);const d=s.length===10?s:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));return Date.parse(d+'T00:00:00Z');};
const days = (a,b) => (day(b)-day(a))/DAY;
const mean = xs => ({value:xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null,n:xs.length});
function metrics(records,lots,now=new Date().toISOString()) {
 const spans=[[],[],[]],gaps=[[],[]],finished=[],touched=records.filter(r=>r.status),done=records.filter(r=>FINAL.includes(r.status));
 for(const r of records){const lot=lots.find(l=>l.id===r.lot);if(!lot)continue;
  r.contacts.forEach((d,i)=>{const n=days(lot.published||lot.extracted,d);if(Number.isFinite(n)&&n>=0)spans[i].push(n);});
  for(let i=0;i<2;i++){const n=days(r.contacts[i],r.contacts[i+1]);if(Number.isFinite(n)&&n>=0)gaps[i].push(n);}
  if(FINAL.includes(r.status)&&r.completedAt)finished.push(Math.max(0,(Date.parse(r.completedAt)-Date.parse(lot.published||lot.extracted))/DAY));
 }
 const pending=records.filter(r=>!FINAL.includes(r.status));
 return {total:records.length,filled:touched.length,done:done.length,pending:pending.length,untouched:records.filter(r=>!r.status&&!r.contacts.some(Boolean)).length,
  stalled:pending.filter(r=>days(r.updated||lots.find(l=>l.id===r.lot)?.published,now)>=3).length,
  completion:records.length?Math.round(100*done.length/records.length):0,contacts:spans.map(mean),gaps:gaps.map(mean),finish:mean(finished)};
}
if(typeof module!=='undefined')module.exports={FINAL,STATUS,metrics,days};
else globalThis.CRM={FINAL,STATUS,metrics,days};

})();
