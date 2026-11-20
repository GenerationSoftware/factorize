import {readFile,writeFile} from 'node:fs/promises';
// Optional local input supports deterministic validation without any network.
const input=process.argv[2];
const raw=input?await readFile(input,'utf8'):await (async()=>{const response=await fetch('https://raw.githubusercontent.com/Arize-ai/phoenix/main/src/phoenix/server/cost_tracking/manifests/v1.json');if(!response.ok)throw new Error('Pricing catalog download failed');return response.text();})();
const catalog=JSON.parse(raw);
if(catalog.schema_version!==1||!Number.isFinite(Date.parse(catalog.generated_at))||!Array.isArray(catalog.models)||catalog.models.length>10000)throw new Error('Invalid pricing manifest');
for(const model of catalog.models){if(typeof model.name!=='string'||!Array.isArray(model.token_prices))throw new Error('Invalid model pricing');for(const price of model.token_prices)if(!Number.isFinite(price.base_rate)||price.base_rate<0)throw new Error('Invalid token rate');}
await writeFile(new URL('../packages/api/src/data/phoenix-prices.json',import.meta.url),JSON.stringify(catalog,null,2)+'\n');
console.log(`Updated Phoenix pricing snapshot: ${catalog.generated_at} (${catalog.models.length} models).`);
