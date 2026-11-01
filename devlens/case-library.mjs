import {normalizeCase,publicURL} from './knowledge.mjs';
import {validAddress} from './engine.mjs';
export const ANSWER_TTL_MS=180000;
export function observation(ca,raw={}){
  const socials=Array.isArray(raw.socials)?raw.socials.slice(0,3):[];
  return normalizeCase({mint:ca,name:raw.name,observedAt:Date.now(),twitter:raw.twitter,website:raw.website,socials,charts:raw.chart?[raw.chart]:[],coverage:{social:socials.length>0,notes:'Наблюдение страницы; недоступные поля не восстановлены.'}});
}
export function splitMemoryReply(text,ca){
  let profile=null;const block=String(text).match(/```devlens-memory\s*([\s\S]*?)```/);
  if(block && block[1].length<=24000)try{
    const raw=JSON.parse(block[1]);if(raw.mint===ca){
      profile=normalizeCase({mint:ca,name:raw.name,symbol:raw.symbol,creator:raw.creator,createdAt:raw.createdAt,twitter:raw.twitter,website:raw.website,image:raw.image,funding:raw.funding,sourceWallets:raw.sourceWallets,socials:Array.isArray(raw.socials)?raw.socials.slice(0,10).map(s=>({url:s.url,bio:s.bio,displayName:s.displayName,followers:s.followers,followersText:s.followersText,avatar:s.avatar,banner:s.banner,source:s.source,capturedAt:s.capturedAt,method:'conversation'})):[],observedAt:Date.now(),notes:'Из ответа чата; источники и выводы требуют проверки. '+String(raw.notes || '').slice(0,3000),coverage:{funding:Array.isArray(raw.funding) && raw.funding.length>0,social:Array.isArray(raw.socials) && raw.socials.length>0,notes:'Поля из ответа ИИ; совпадения — гипотезы, не установление владельца.'}});
    }
  }catch{}
  return {text:block && profile?text.replace(block[0],'').trim():String(text),profile};
}
export async function enrichMetadata(ca,request=fetch){
  if(!validAddress(ca))throw Error('Invalid CA');
  try{const r=await request('https://frontend-api-v3.pump.fun/coins-v2/'+ca,{credentials:'omit',signal:AbortSignal.timeout(1400)});if(!r.ok)return null;const d=await r.json();if(d.mint!==ca)return null;return normalizeCase({mint:ca,name:d.name,symbol:d.symbol,creator:d.creator,createdAt:d.created_timestamp,website:d.website,twitter:d.twitter,image:d.image_uri,metadata:d.metadata_uri,observedAt:Date.now(),sources:['https://pump.fun/coin/'+ca]});}catch{return null;}
}
export function memoryMatches(library,c){return library.search(c).filter(m=>!c.createdAt || !m.createdAt || m.createdAt<=c.createdAt).slice(0,5).map(m=>({mint:m.mint,name:m.name,observedAt:m.observedAt,level:m.level,evidence:m.evidence.map(e=>({family:e.family,label:e.label,sources:e.sources || [],wallets:e.wallets || []})),identityEstablished:false}));}
export function promptMemory(library,c,matches){
  const compact=p=>({mint:p.mint,name:p.name,creator:p.creator,observedAt:p.observedAt,twitter:p.twitter,website:p.website,funding:p.funding.slice(0,5),sourceWallets:p.sourceWallets.slice(0,3),socials:p.socials.slice(-1).map(s=>({url:s.url,bio:s.bio.slice(0,300),followers:s.followers,followersText:s.followersText,capturedAt:s.capturedAt,avatar:s.avatar})),charts:p.charts.slice(-2).map(s=>({hash:s.hash,timeframe:s.timeframe,capturedAt:s.capturedAt,source:s.source})),coverage:p.coverage});
  return JSON.stringify({untrustedObservations:true,notProofOfOwnership:true,current:compact(c),matches:matches.slice(0,3).map(m=>({profile:compact(library.index.cases.get(m.mint)),reasons:m.evidence.map(e=>e.label)}))}).slice(0,4200);
}
export function socialObservation(raw){
  const url=publicURL(raw?.url);if(!url || !/^https:\/\/(?:www\.)?(?:x|twitter)\.com\/[a-zA-Z0-9_]{1,15}\/?$/.test(url))return null;
  return {url,displayName:String(raw.displayName || '').slice(0,160),bio:String(raw.bio || '').slice(0,2000),followers:Number.isSafeInteger(raw.followers) && raw.followers>=0?raw.followers:null,followersText:String(raw.followersText || '').slice(0,80),avatar:publicURL(raw.avatar),banner:publicURL(raw.banner),capturedAt:Date.now(),source:url,method:'browser'};
}
