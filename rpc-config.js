export const VERSION='1.3.0';
export const SOLANA_MAINNET_GENESIS='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
// Independent public providers. We never switch providers to evade a 429.
export const PUBLIC_RPC_ENDPOINTS=[
  {url:'https://solana-rpc.publicnode.com/',name:'PublicNode',id:'publicnode'},
  {url:'https://api.mainnet-beta.solana.com/',name:'Solana public RPC',id:'solana'}
];
export const READ_RPC_METHODS=new Set(['getSignaturesForAddress','getTransaction','getGenesisHash','getAccountInfo','getBlock']);
export function normalizeRpcURL(value){
  const s=String(value || '').trim();if(!s)return null;
  let u;try{u=new URL(s);}catch{throw Error('Нужна полная HTTPS-ссылка RPC.');}
  if(u.protocol!=='https:' || u.username || u.password || u.hash)throw Error('RPC должен использовать HTTPS, без логина, пароля и фрагмента URL.');
  return u.href;
}
export function rpcEndpoints(custom){const rows=custom?[{url:normalizeRpcURL(custom),name:'Свой RPC',id:'custom'},...PUBLIC_RPC_ENDPOINTS]:PUBLIC_RPC_ENDPOINTS;return rows.filter((r,i)=>rows.findIndex(e=>e.url===r.url)===i);}
export class SourceError extends Error {
  constructor(message,{kind='unavailable',status,source}={}){super(message);this.name='SourceError';this.kind=kind;this.status=status;this.source=source;}
}
