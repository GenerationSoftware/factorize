import {z} from "zod";
import {createModels,createProvider} from "@earendil-works/pi-ai/models";
import {openAICompletionsApi} from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type {Model} from "@earendil-works/pi-ai";
import {CredentialRepository} from "./postgres/credential-repository";
import type {Database} from "./postgres/database";
import type {Env} from "./types";

export const modelProviderConfiguration=z.object({
  providerUrl:z.url().max(2048).refine(value=>{const u=new URL(value);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password&&!u.search&&!u.hash;},"Use an HTTP(S) provider base URL without credentials, query or fragment."),
  apiKey:z.string().min(1).max(32768).regex(/^[^\r\n]+$/).optional().meta({writeOnly:true}),
  contextWindow:z.number().int().min(1024).max(2_000_000).default(128000),
  maxTokens:z.number().int().min(1).max(200000).default(8192),
}).strict().refine(value=>value.maxTokens<value.contextWindow,{path:["maxTokens"],message:"Output tokens must fit within the context window."});
export type ModelProviderConfiguration=z.infer<typeof modelProviderConfiguration>;
export function configuredPiProvider(payload:string) {
  try{return modelProviderConfiguration.parse(JSON.parse(payload));}catch{return null;}
}
export async function runPiProvider(database:Database,env:Env,tenantId:string,runId:string,accountId:unknown,modelId:unknown,effort?:string) {
  if(typeof accountId!=="string" || typeof modelId!=="string" || !modelId.trim())throw new Error("Select an OpenAI-compatible model integration and model in Team or Trigger settings.");
  const revoked=await database.pool.query("SELECT 1 FROM app.run_credential_revocations WHERE tenant_id=$1 AND run_id=$2 AND kind='model' AND credential_id=$3",[tenantId,runId,accountId]);
  const credential=await new CredentialRepository(database,tenantId,env.CREDENTIAL_ENCRYPTION_KEY).managedCredential(accountId,"model");
  const config=credential && configuredPiProvider(credential.payload);
  if(revoked.rowCount || !config)throw new Error("The selected model integration is unavailable or needs a provider URL. Repair it before starting a new run.");
  return piProvider(config,modelId,effort);
}
/** Only the selected OpenAI-compatible adapter is bundled; no global provider catalog. */
export function piProvider(config:ModelProviderConfiguration,modelId:string,effort?:string) {
  const baseUrl=config.providerUrl.replace(/\/$/,"");
  const model:Model<"openai-completions">={id:modelId,name:modelId,api:"openai-completions",provider:"factorize",baseUrl,reasoning:Boolean(effort),input:["text","image"],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:config.contextWindow,maxTokens:config.maxTokens};
  const models=createModels();
  models.setProvider(createProvider({id:"factorize",name:"Factorize model integration",baseUrl,models:[model],auth:{apiKey:{name:"Integration credential",resolve:async()=>({auth:config.apiKey?{apiKey:config.apiKey}:{apiKey:"unused",headers:{Authorization:null}}})}},api:openAICompletionsApi()}));
  return {models,model,config};
}
