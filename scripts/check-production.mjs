import fs from 'node:fs';
const c=JSON.parse(fs.readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
if(c.d1_databases[0].database_id==='00000000-0000-0000-0000-000000000000')throw Error('Configure o database_id real do D1.');
if(!c.vars.APP_ORIGIN.startsWith('https://')||c.vars.APP_ORIGIN.endsWith('/'))throw Error('Configure APP_ORIGIN com a URL HTTPS definitiva, sem barra final.');
