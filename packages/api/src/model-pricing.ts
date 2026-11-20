import {z} from "zod";
import catalog from "./data/phoenix-prices.json";
import type {DatabaseClient} from "./postgres/database";
export const pricingRates=z.object({input:z.number().finite().min(0).max(1000000),output:z.number().finite().min(0).max(1000000),cacheRead:z.number().finite().min(0).max(1000000).optional(),cacheWrite:z.number().finite().min(0).max(1000000).optional()}).strict();
export const pricingOverrideInput=z.object({integrationId:z.uuid(),model:z.string().trim().min(1).max(256),rates:pricingRates.nullable(),expectedRevision:z.number().int().nonnegative()}).strict();
export const pricingOverrideReceipt=pricingOverrideInput.omit({expectedRevision:true}).extend({revision:z.number().int()});
export const pricingList=z.object({catalogVersion:z.string(),source:z.string(),items:z.array(pricingOverrideReceipt)});
type Counts={input:number|null;output:number|null;cacheRead:number|null;cacheWrite:number|null;reasoning:number|null};
type Rate={base_rate:number;is_prompt:boolean;token_type:string;customization?:{type:string;key:string;threshold:number;new_rate:number}};
export const pricingCatalogVersion=catalog.generated_at;
export const pricingCatalogSource="https://github.com/Arize-ai/phoenix/blob/main/src/phoenix/server/cost_tracking/manifests/v1.json";
export function estimateModelCost(model:string,counts:Counts,override?:z.infer<typeof pricingRates>|null){
 if(counts.input===null||counts.output===null)return {cost:null,snapshot:{source:"unavailable",reason:"Provider usage unavailable"}};
 const found=catalog.models.find(entry=>entry.name===model);
 if(!override&&!found)return {cost:null,snapshot:{source:"unavailable",reason:"Model has no catalog price or override"}};
 const prompt=counts.input+(counts.cacheRead??0)+(counts.cacheWrite??0);
 const prices=override?[{token_type:"input",is_prompt:true,base_rate:override.input/1000000},{token_type:"output",is_prompt:false,base_rate:override.output/1000000},...(override.cacheRead!==undefined?[{token_type:"cache_read",is_prompt:true,base_rate:override.cacheRead/1000000}]:[]),...(override.cacheWrite!==undefined?[{token_type:"cache_write",is_prompt:true,base_rate:override.cacheWrite/1000000}]:[])]:found!.token_prices as Rate[];
 const applied:Record<string,number>={};
 for(const token of ["input","output","cache_read","cache_write"]){const entry=prices.find(rate=>rate.token_type===token);if(!entry)continue;let rate=entry.base_rate;
  if("customization" in entry&&entry.customization){const custom=entry.customization;if(custom.type!=="threshold_based"||custom.key!=="llm.token_count.prompt")return {cost:null,snapshot:{source:"unavailable",reason:"Unsupported pricing tier; configure an override"}};if(prompt>custom.threshold)rate=custom.new_rate;}
  applied[token]=rate;
 }
 const quantities={input:counts.input,output:counts.output,cache_read:counts.cacheRead??0,cache_write:counts.cacheWrite??0};
 for(const [token,count] of Object.entries(quantities))if(count>0&&applied[token]===undefined)return {cost:null,snapshot:{source:"unavailable",reason:`No ${token} price; configure an override`}};
 // Reasoning is already included in Pi output. A separately priced reasoning
 // subset replaces that portion of the output charge rather than adding it.
 let cost=Object.entries(quantities).reduce((sum,[token,count])=>sum+count*(applied[token]??0),0);
 const reasoning=prices.find(rate=>rate.token_type==="reasoning"&&!rate.is_prompt);
 if(reasoning&&counts.reasoning!==null){if("customization" in reasoning&&reasoning.customization)return {cost:null,snapshot:{source:"unavailable",reason:"Unsupported reasoning tier"}};cost+=counts.reasoning*(reasoning.base_rate-(applied.output??0));applied.reasoning=reasoning.base_rate;}
 return {cost:Math.max(0,cost),snapshot:{source:override?"team override":pricingCatalogSource,version:override?null:pricingCatalogVersion,ratesPerToken:applied}};
}
export async function priceSpan(client:DatabaseClient,tenantId:string,runId:string,model:string|null,counts:Counts){
 if(!model)return {cost:null,snapshot:{source:"unavailable",reason:"No model"}};
 const row=(await client.query("SELECT p.rates,p.revision FROM app.runs r LEFT JOIN app.model_pricing_overrides p ON p.tenant_id=r.tenant_id AND p.integration_id=(r.execution_config->>'modelAccountId')::uuid AND p.model=$3 WHERE r.tenant_id=$1 AND r.id=$2",[tenantId,runId,model])).rows[0];
 const estimated=estimateModelCost(model,counts,row?.rates??null);return {...estimated,snapshot:{...estimated.snapshot,...(row?.rates?{revision:row.revision}:{})}};
}
