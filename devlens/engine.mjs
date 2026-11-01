// Identical read-only analysis engine in the extension, Node and tests.
import {PUBLIC_RPC_ENDPOINTS,SourceError,SOLANA_MAINNET_GENESIS} from './rpc-config.js';
import {b58,un58,curveAddress,metadataAddress,decodeCurve,decodeMetadata,launchpadAddress,decodeLaunchpad,LAUNCHPAD_PROGRAM,verifiesLaunch} from './solana.mjs';
export const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const SYSTEM = '11111111111111111111111111111111';
const STABLE = {'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC', 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 'USDT'};
const DEX = new Set([PUMP,LAUNCHPAD_PROGRAM,'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN', 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA', 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', 'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo', 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc']);
export function validAddress(s) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s || '')) return false;
  let n=0n; const a='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  for (const c of s) n=n*58n+BigInt(a.indexOf(c));
  let size=0; while(n){n>>=8n;size++;}
  return size+(s.match(/^1*/)?.[0].length || 0)===32;
}
export function addressFromInput(value) {
  let s=String(value || '').trim();
  if (s.startsWith('https://')) {const u=new URL(s); if (!['pump.fun','www.pump.fun','solscan.io','dexscreener.com'].includes(u.hostname)) throw Error('Вставьте CA или ссылку Pump.fun / Solscan.'); s=u.pathname.split('/').filter(Boolean).at(-1);}
  if (!validAddress(s)) throw Error('Нужен корректный Solana CA: 32 байта в Base58.');
  return s;
}
function creationPayload(bytes) {
  const disc=[27,114,169,77,222,235,99,118]; if (!disc.every((v,i)=>bytes[i]===v)) return null;
  let offset=8; const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const str=()=>{const n=view.getUint32(offset,true);offset+=4;if(n>4096 || offset+n>bytes.length)throw Error('Borsh');const s=new TextDecoder().decode(bytes.slice(offset,offset+n));offset+=n;return s;};
  const key=()=>{if(offset+32>bytes.length)throw Error('Borsh');const s=b58(bytes.slice(offset,offset+32));offset+=32;return s;};
  const name=str(),symbol=str(),uri=str(),mint=key(),curve=key(),user=key(),creator=key();
  return {name,symbol,uri,mint,curve,user,creator};
}
export function creationEvents(t) {
  if (!t || t.meta?.err) return [];
  const out=[],stack=[];
  for(const line of t.meta.logMessages || []) {
    if(line.startsWith('Program ') && line.includes(' invoke ['))stack.push(line.split(' ')[1]);
    else if(line.startsWith('Program data: ') && stack.at(-1)===PUMP) {try{const e=creationPayload(Uint8Array.from(atob(line.slice(14)),c=>c.charCodeAt(0)));if(e)out.push(e);}catch{}}
    else if(line.startsWith('Program ') && (line.endsWith(' success') || line.includes(' failed:'))) {if(stack.at(-1)===line.split(' ')[1])stack.pop();}
  }
  // Anchor event CPI survives Solana's truncated text-log limit.
  for(const i of instructions(t)) if(i.programId===PUMP && i.data) {try{const b=un58(i.data);if([228,69,165,46,81,203,154,29].every((v,j)=>b[j]===v)){const e=creationPayload(b.slice(8));if(e && !out.some(x=>x.mint===e.mint))out.push(e);}}catch{}}
  return out;
}
function instructions(t){return [...(t.transaction?.message?.instructions || []),...(t.meta?.innerInstructions || []).flatMap(g=>g.instructions)];}
export function parseTransaction(t, signature) {
  if(!t || t.meta?.err)return {transfers:[],signers:[],creations:[]};
  const keys=t.transaction.message.accountKeys.map(k=>typeof k==='string'?{pubkey:k}:k), ins=instructions(t), accounts=new Map();
  for(const r of [...(t.meta.preTokenBalances || []),...(t.meta.postTokenBalances || [])]) accounts.set(keys[r.accountIndex].pubkey,{owner:r.owner,mint:r.mint,decimals:r.uiTokenAmount.decimals});
  for(const i of ins){const p=i.parsed;if(p?.type?.startsWith('initializeAccount'))accounts.set(p.info.account,{owner:p.info.owner,mint:p.info.mint});}
  const swap=ins.some(i=>DEX.has(i.programId)), transfers=[];
  for(const i of ins) {
    const p=i.parsed, v=p?.info;if(!v)continue;
    if(i.programId===SYSTEM && p.type==='transfer' && Number.isSafeInteger(v.lamports)) transfers.push({from:v.source,to:v.destination,raw:String(v.lamports),amount:v.lamports/1e9,asset:'SOL',signature,time:t.blockTime,protocol:swap});
    else if(['transfer','transferChecked','transferCheckedWithFee'].includes(p.type)) {
      const from=accounts.get(v.source),to=accounts.get(v.destination),mint=v.mint || from?.mint || to?.mint;
      if(!STABLE[mint] || !from?.owner || !to?.owner || from.owner===to.owner)continue;
      const raw=v.tokenAmount?.amount || v.amount,decimals=v.tokenAmount?.decimals ?? from.decimals ?? 6;
      if(!/^\d+$/.test(String(raw)))continue;
      transfers.push({from:from.owner,to:to.owner,raw:String(raw),amount:Number(raw)/10**decimals,asset:STABLE[mint],signature,time:t.blockTime,protocol:swap});
    }
  }
  return {transfers,signers:keys.filter(k=>k.signer).map(k=>k.pubkey),creations:creationEvents(t),feePayer:keys[0]?.pubkey};
}
export function chooseTransactions(rows, launch, limit=24) {
  const ok=rows.filter(r=>!r.err), chosen=new Map();
  const add=r=>{if(r && chosen.size<limit)chosen.set(r.signature,r);};
  // Launch-near funding first; then initial funding and recent cash-outs.
  const before=ok.filter(r=>!launch || r.blockTime<=launch/1000+2).sort((a,b)=>b.slot-a.slot);
  before.slice(0,Math.ceil(limit*.5)).forEach(add);
  [...ok].reverse().slice(0,Math.ceil(limit*.25)).forEach(add);
  ok.slice(0,Math.ceil(limit*.25)).forEach(add);
  return [...chosen.values()];
}
export function rankFunders(transfers,wallet,launch,minimum=.001) {
  const grouped=new Map();
  const rows=transfers.filter(t=>!t.protocol && t.to===wallet && t.from!==wallet && t.amount>=(t.asset==='SOL'?minimum:1) && (!launch || !t.time || t.time*1000<=launch));
  for(const r of rows){const k=r.from;const g=grouped.get(k) || {address:k,transfers:[],totalSOL:0,assets:new Set()};g.transfers.push(r);g.assets.add(r.asset);if(r.asset==='SOL')g.totalSOL+=r.amount;grouped.set(k,g);}
  const mass=rows.filter(r=>rows.filter(x=>x.asset===r.asset && x.raw===r.raw && Math.abs(x.time-r.time)<=10).length>=6);
  return [...grouped.values()].map(g=>{const suspicious=g.transfers.every(t=>mass.includes(t));return {...g,assets:[...g.assets],massDistribution:suspicious,score:(suspicious?-1000:0)+g.transfers.length*20+Math.min(g.totalSOL,5)+Math.max(...g.transfers.map(t=>t.time || 0))/1e10};}).sort((a,b)=>b.score-a.score);
}
export function prioritizeTokens(rows,target){
  const normalize=s=>String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu,''),targetName=normalize(target.name),targetSymbol=normalize(target.symbol);
  const tokens=rows.map(t=>{const matchSignals=[];if(t.mint!==target.mint && targetName && normalize(t.name)===targetName)matchSignals.push('same_name');if(t.mint!==target.mint && targetSymbol.length>=4 && normalize(t.symbol)===targetSymbol)matchSignals.push('same_symbol');return {...t,matchSignals};});
  const rank=t=>t.mint===target.mint?1000:t.relation==='same_creator'?500:t.relation.startsWith('comparison')?-100:t.matchSignals.length*40-Math.min(t.path?.length || 0,20);
  return tokens.sort((a,b)=>rank(b)-rank(a)||(b.createdAt || 0)-(a.createdAt || 0));
}
export class Analyzer {
  constructor({request=fetch,progress=()=>{},signal,limits={},labels={},cachedRead,rpcEndpoints=PUBLIC_RPC_ENDPOINTS}={}) {
    this.request=request;this.progress=progress;this.signal=signal;this.labels=labels;this.cachedRead=cachedRead;this.cachedResponses=0;
    this.limits={depth:2,wallets:10,transactions:32,rootTransactions:64,peerWallets:6,transactionBudget:240,signaturePages:2,creatorPages:5,minimumSOL:.001,...limits};
    this.limits.depth=Math.min(10,Math.max(1,this.limits.depth));this.limits.wallets=Math.min(24,Math.max(2,this.limits.wallets));this.limits.transactions=Math.min(96,Math.max(8,this.limits.transactions));this.limits.rootTransactions=Math.min(160,Math.max(this.limits.transactions,this.limits.rootTransactions));this.limits.peerWallets=Math.min(12,Math.max(0,this.limits.peerWallets));this.txUsed=0;this.peerScreened=0;
    this.cache=new Map();this.next=0;this.calls=0;this.warnings=[];this.wallets=new Map();this.edges=new Map();this.tokens=new Map();this.focusTokens=new Map();this.analysedAt=new Date().toISOString();this.rpcEndpoints=rpcEndpoints;this.rpcIndex=0;this.rpcDisabled=new Set();this.rpcStates=rpcEndpoints.map(e=>({id:e.id,name:e.name,state:'untested',successfulRequests:0}));this.registryState={state:'untested',name:'Pump.fun registry'};
  }
  emit(phase,message,extra={}){this.progress({phase,message,calls:this.calls,...extra});}
  async get(url,body,{attempts=5}={}) {
    this.signal?.throwIfAborted();const key=url+JSON.stringify(body || null);if(this.cache.has(key))return this.cache.get(key);
    if(this.cachedRead){const value=await this.cachedRead(url,body);if(value!==undefined){this.calls++;this.cachedResponses++;this.cache.set(key,value);return value;}}
    let exhaustedKind='unavailable';
    for(let attempt=0;attempt<attempts;attempt++){
      const wait=Math.max(0,this.next-Date.now());if(wait)await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(id);reject(new DOMException('Cancelled','AbortError'));};const id=setTimeout(()=>{this.signal?.removeEventListener('abort',abort);resolve();},wait);this.signal?.addEventListener('abort',abort,{once:true});});
      this.signal?.throwIfAborted();this.next=Date.now()+1150;this.calls++;
      const timeout=AbortSignal.timeout(25000),signal=this.signal?AbortSignal.any([this.signal,timeout]):timeout;
      let res;try{res=await this.request(url,{signal,credentials:'omit',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});}catch(e){if(this.signal?.aborted)throw e;if(attempt===attempts-1)throw new SourceError('Источник недоступен: '+new URL(url).hostname);this.next=Date.now()+2000*2**attempt;continue;}
      if([429,500,502,503,504].includes(res.status)){exhaustedKind=res.status===429?'rate_limited':'unavailable';const header=res.headers?.get('Retry-After'),seconds=Number(header),delay=header?(Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(header)-Date.now())):0;this.next=Date.now()+Math.max(Number.isFinite(delay)?delay:0,2000*2**attempt);this.emit('waiting','Источник просит паузу. Соблюдаю лимит запросов.');continue;}
      if(!res.ok)throw new SourceError(`${new URL(url).hostname}: HTTP ${res.status}`,{kind:[401,403].includes(res.status)?'blocked':'unavailable',status:res.status});
      const value=await res.json();if(value?.error){if(value.error.code===429){exhaustedKind='rate_limited';this.next=Date.now()+10000;continue;}throw new SourceError('RPC: '+value.error.message,{kind:[-32601,-32011,35].includes(value.error.code)?'unsupported':'rpc_error'});}
      if(res.headers?.get('X-Degraded'))throw Error('Источник сообщил о неполном ответе. Повторите позже.');
      this.cache.set(key,value);return value;
    }
    throw new SourceError(exhaustedKind==='rate_limited'?'Источник ограничил запросы. Повторите анализ позже.':'Источник временно недоступен.',{kind:exhaustedKind});
  }
  async rpc(method,params){
    const order=[this.rpcIndex,...this.rpcEndpoints.map((_,i)=>i).filter(i=>i!==this.rpcIndex)];let empty,errors=[];
    for(const index of order){if(this.rpcDisabled.has(index))continue;const endpoint=this.rpcEndpoints[index],state=this.rpcStates[index];
      try{if(endpoint.id==='custom' && !state.mainnetVerified && method!=='getGenesisHash'){const check=await this.get(endpoint.url,{jsonrpc:'2.0',id:1,method:'getGenesisHash',params:[]},{attempts:2});if(check.result!==SOLANA_MAINNET_GENESIS)throw new SourceError('Выбран не Solana mainnet.',{kind:'unsupported'});state.mainnetVerified=true;}const d=await this.get(endpoint.url,{jsonrpc:'2.0',id:1,method,params},{attempts:2});if(!Object.hasOwn(d,'result'))throw new SourceError('RPC не вернул result.');state.state='healthy';state.successfulRequests++;delete state.error;
        if((d.result===null || (method==='getSignaturesForAddress' && Array.isArray(d.result) && !d.result.length)) && order.some(i=>i!==index && !this.rpcDisabled.has(i))){empty=d.result;continue;}
        this.rpcIndex=index;return d.result;
      }catch(e){if(this.signal?.aborted)throw e;const message=endpoint.id==='custom'?`Свой RPC недоступен${e.status?' (HTTP '+e.status+')':''}.`:e.message;state.state=e.kind==='rate_limited'?'rate_limited':e.kind==='blocked'?'blocked':'unavailable';state.error=message;errors.push(`${endpoint.name}: ${message}`);
        if(e.kind==='rate_limited')throw e;this.rpcDisabled.add(index);this.emit('rpc-switch',`${endpoint.name} недоступен. Проверяю другой публичный источник.`);
      }
    }
    if(empty!==undefined)return empty;
    throw new SourceError('Нет доступной истории RPC. Поиск связей не выполнен. '+(errors.join(' · ') || 'Источники заблокированы в этой проверке.'),{kind:'rpc_unavailable'});
  }
  registryFailed(e){this.registryState={name:'Pump.fun registry',state:e.kind==='blocked'?'blocked':'unavailable',error:e.status?'HTTP '+e.status:'Данные недоступны'};}
  async coin(mint){
    if(!['blocked','unavailable'].includes(this.registryState.state))try{const c=await this.get('https://frontend-api-v3.pump.fun/coins-v2/'+mint);if(!validAddress(c.creator) || c.creator===SYSTEM || c.mint!==mint)throw Error('Реестр не вернул проверяемого creator.');this.registryState.state='healthy';return normalizeCoin(c);}catch(e){if(this.signal?.aborted || e.kind==='rate_limited')throw e;this.registryFailed(e);}
    this.emit('on-chain','Реестр Pump.fun недоступен. Проверяю аккаунт программы через Solana RPC.');
    let curve=await curveAddress(mint),response=await this.rpc('getAccountInfo',[curve,{encoding:'base64',commitment:'confirmed'}]),state=decodeCurve(response?.value),program=PUMP;
    if(!state){curve=await launchpadAddress(mint);response=await this.rpc('getAccountInfo',[curve,{encoding:'base64',commitment:'confirmed'}]);state=decodeLaunchpad(response?.value,mint);program=LAUNCHPAD_PROGRAM;}
    if(!state || !validAddress(state.creator) || state.creator===SYSTEM)throw new SourceError('Pump.fun недоступен, а проверяемый аккаунт BondingCurve с creator не найден. Поиск не выполнен. Проверьте RPC в настройках расширения.',{kind:'creator_unavailable'});
    let metadata=null;
    try{const mintInfo=await this.rpc('getAccountInfo',[mint,{encoding:'jsonParsed',commitment:'confirmed'}]);const ext=mintInfo?.value?.data?.parsed?.info?.extensions?.find(x=>x.extension==='tokenMetadata')?.state;if(ext)metadata={name:ext.name,symbol:ext.symbol,metadata:ext.uri};else{const address=await metadataAddress(mint),info=await this.rpc('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);metadata=decodeMetadata(info?.value,mint);}}catch(e){if(this.signal?.aborted || e.kind==='rate_limited')throw e;}
    return {mint,creator:state.creator,name:metadata?.name || 'Токен '+mint.slice(0,7),symbol:metadata?.symbol || '',metadata:metadata?.metadata || null,createdAt:null,migrated:null,curveComplete:state.complete,source:program===PUMP?'Pump.fun on-chain account':'Raydium LaunchLab on-chain account',creatorProof:{account:curve,program},onChain:true};
  }
  async createdBy(wallet){if(['blocked','unavailable'].includes(this.registryState.state))throw new SourceError('Реестр недоступен; создания ищутся в прочитанных on-chain событиях.',{kind:'registry_unavailable'});let out=[],truncated=false;try{for(let page=0;page<this.limits.creatorPages;page++){const d=await this.get(`https://frontend-api-v3.pump.fun/coins-v2/user-created-coins/${wallet}?limit=50&offset=${page*50}&includeNsfw=true`);const rows=Array.isArray(d)?d:d.coins;if(!Array.isArray(rows))throw Error('Неизвестный формат списка токенов.');out.push(...rows.filter(c=>c.creator===wallet && validAddress(c.mint)).map(normalizeCoin));if(rows.length<50)return {coins:out,truncated:false};truncated=true;}return {coins:out,truncated};}catch(e){if(!this.signal?.aborted && e.kind!=='rate_limited')this.registryFailed(e);throw e;}}
  addCreatorCoin(w,c,path,origin,role){const relation=role==='developer'?'same_creator':role==='comparison'?'comparison_creator':origin===this.target.creator?'funding_path':'comparison_funding';if(!w.coins.some(t=>t.mint===c.mint))w.coins.push(c);if(!this.tokens.has(c.mint))this.tokens.set(c.mint,{...c,path,origin,relation,evidence:c.onChain?'Pump program creation event / account':'Pump.fun registry',wallet:w.address});}
  async history(wallet){let rows=[],before,complete=false;for(let page=0;page<this.limits.signaturePages;page++){const rs=await this.rpc('getSignaturesForAddress',[wallet,{limit:1000,...(before?{before}:{})}]);if(!Array.isArray(rs))throw Error('RPC не вернул историю.');rows.push(...rs);if(rs.length<1000){complete=true;break;}before=rs.at(-1).signature;}return {rows,complete};}
  addEdge(t,kind='funding'){const key=[t.signature,t.from,t.to,t.asset,t.raw].join(':');if(!this.edges.has(key))this.edges.set(key,{...t,kind,proof:`https://solscan.io/tx/${t.signature}`});}
  async inspect(address,depth,path,launch,role='funding',origin=this.target.creator) {
    if(this.wallets.has(address))return this.wallets.get(address);
    const w={address,depth,path,role,origin,coins:[],status:'partial',historyStatus:'pending',funders:[],destinations:[],warnings:[],transactionsDecoded:0,label:this.labels[address] || null};this.wallets.set(address,w);
    this.emit('wallet',`Кошелёк ${this.wallets.size}/${this.limits.wallets}: ${address.slice(0,5)}…${address.slice(-5)}`);
    try{const d=await this.createdBy(address);w.coins=d.coins;w.creatorListTruncated=d.truncated;for(const c of d.coins)this.addCreatorCoin(w,c,path,origin,role);}catch(e){if(this.signal?.aborted || e.kind==='rate_limited')throw e;w.creatorListTruncated=true;w.warnings.push('Список созданий неполный: '+e.message);}
    const focus=this.focusTokens.get(address);if(focus)this.addCreatorCoin(w,focus,path,origin,role);
    try{
      const h=await this.history(address);w.historyStatus='available';w.historyComplete=h.complete;w.signatureCount=h.rows.length;w.observedOldestTime=h.rows.at(-1)?.blockTime || null;
      const newest=h.rows[0]?.blockTime,oldest=h.rows[Math.min(999,h.rows.length-1)]?.blockTime;
      w.hub=!!w.label?.exchange || (h.rows.length>=1000 && newest-oldest<86400);
      if(w.hub && depth>0){w.warnings.push('Биржа или активный общий узел: цепочка здесь остановлена. Его клиенты не объединяются.');w.status='hub';return w;}
      const budget=Math.max(0,Math.min(this.limits.transactionBudget,this.txPhaseLimit ?? Infinity)-this.txUsed),limit=Math.min(depth===0?this.limits.rootTransactions:this.limits.transactions,budget);
      const chosen=chooseTransactions(h.rows,launch,limit),all=[];w.transactionsRequested=chosen.length;w.transactionsDecoded=0;w.nullTransactions=0;w.creationProof=null;w.creationProofs=[];w.transactionsUnexamined=Math.max(0,h.rows.filter(r=>!r.err).length-chosen.length);
      for(const r of chosen){this.emit('transactions',`Проверка транзакций ${w.transactionsDecoded}/${chosen.length}: ${address.slice(0,5)}…`);try{
        this.txUsed++;
        const t=await this.rpc('getTransaction',[r.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1,commitment:'confirmed'}]);if(!t){w.nullTransactions++;continue;}
        const parsed=parseTransaction(t,r.signature);w.transactionsDecoded++;
        if(focus && verifiesLaunch(t,focus.mint,address)){if(!focus.createdAt)focus.createdAt=t.blockTime*1000;Object.assign(this.tokens.get(focus.mint),focus);w.creationProof={mint:focus.mint,creator:address,signature:r.signature,symbol:focus.symbol,registryMatches:true,source:'initializeMint'};}
        for(const e of parsed.creations){
          if(e.creator===address){const event={mint:e.mint,creator:e.creator,name:e.name,symbol:e.symbol,metadata:e.uri,createdAt:t.blockTime?t.blockTime*1000:null,migrated:null,onChain:true,source:'Pump.fun CreateEvent',creationSignature:r.signature};this.addCreatorCoin(w,event,path,origin,role);if(focus?.mint===e.mint && focus.onChain){if(!focus.createdAt)focus.createdAt=event.createdAt;if(!focus.symbol){focus.symbol=e.symbol;focus.name=e.name;}Object.assign(this.tokens.get(e.mint),focus);}}
          if(e.creator===address || e.user===address){const known=w.coins.find(c=>c.mint===e.mint) || focus;const proof={...e,signature:r.signature,registryMatches:known?.mint===e.mint?e.creator===known.creator:null};w.creationProofs.push(proof);if(e.mint===focus?.mint)w.creationProof=proof;}
        }
        all.push(...parsed.transfers);
        // Only joint signatures in non-swap transactions; mint keypairs and
        // launch providers are not treated as the developer's other wallets.
        if(!parsed.creations.length && !parsed.transfers.some(t=>t.protocol) && parsed.signers.includes(address))for(const other of parsed.signers)if(other!==address && validAddress(other))this.addEdge({from:other,to:address,signature:r.signature,time:t.blockTime,amount:null,asset:'signature',raw:'0'},'co_signature');
      }catch(e){if(this.signal?.aborted || e.kind==='rate_limited')throw e;w.warnings.push(`Транзакция ${r.signature.slice(0,8)} недоступна: ${e.message}`);}}
      if(!launch && focus?.onChain){launch=focus.createdAt;if(!launch)w.warnings.push('Время запуска не установлено в выборке; пополнения до запуска не определены.');}
      w.funders=focus?.onChain && !launch?[]:rankFunders(all,address,launch,this.limits.minimumSOL);
      for(const g of w.funders)for(const t of g.transfers)this.addEdge({...t,massDistribution:g.massDistribution},'funding');
      w.destinations=all.filter(t=>!t.protocol && t.from===address && t.amount>=(t.asset==='SOL'?this.limits.minimumSOL:1));
      for(const t of w.destinations)this.addEdge(t,'cashout');
      w.status=!chosen.length && h.rows.length?'budget_exhausted':w.warnings.length || w.nullTransactions || !h.complete || w.transactionsUnexamined?'partial':'checked';
    }catch(e){if(this.signal?.aborted || e.kind==='rate_limited')throw e;w.warnings.push(e.message);w.status='unavailable';w.historyStatus='unavailable';}
    return w;
  }
  async walk(root,budget,origin) {
    const enqueue=(w,depth,path)=>w.funders.map(f=>{const transfer=[...f.transfers].sort((a,b)=>b.time-a.time)[0];return {address:f.address,depth,path:[...path,transfer],launch:transfer.time*1000};});
    const queue=enqueue(root,1,[]),visited=new Set([root.address]);
    while(queue.length && visited.size<200){const q=queue.shift();if(visited.has(q.address))continue;
      if(!this.wallets.has(q.address) && this.wallets.size>=budget){queue.unshift(q);break;}
      visited.add(q.address);const w=await this.inspect(q.address,q.depth,q.path,q.launch,'funding',origin);
      if(!w.hub && q.depth<this.limits.depth)queue.unshift(...enqueue(w,q.depth+1,q.path).slice(0,4));
    }
    return queue.length;
  }
  ancestorPaths(root) {
    const paths=new Map([[root,[]]]),queue=[root];
    while(queue.length){const address=queue.shift(),path=paths.get(address);if(path.length>=this.limits.depth)continue;
      for(const e of this.edges.values())if(e.kind==='funding' && e.to===address && !paths.has(e.from)){paths.set(e.from,[e,...path]);queue.push(e.from);}
    }
    paths.delete(root);return paths;
  }
  async scanRelatedCreators(){
    const candidates=new Map(),knownMints=new Set(this.tokens.keys());
    const add=(address,origin,edge,role,rank,from)=>{if(!validAddress(address) || this.wallets.has(address) || knownMints.has(address) || [SYSTEM,PUMP].includes(address))return;const old=candidates.get(address);if(!old || old.rank<rank)candidates.set(address,{address,origin,edge,role,rank,from});};
    for(const w of this.wallets.values()){
      if(w.hub || w.role==='candidate')continue;
      for(const e of this.edges.values())if(e.kind==='co_signature' && e.to===w.address)add(e.from,w.origin,e,'co_signature',100-w.depth,w);
      const recipients=new Set(w.destinations.map(e=>e.to));if(recipients.size>40)continue;
      for(const e of w.destinations)if(!e.time || e.time*1000<=this.target.createdAt)add(e.to,w.origin,e,w.depth===0?'cashout_candidate':'shared_funder',(w.depth===0?80:40)+Math.min(e.amount || 0,10)-w.depth,w);
    }
    const selected=[...candidates.values()].sort((a,b)=>b.rank-a.rank).slice(0,this.limits.peerWallets);
    if(['blocked','unavailable'].includes(this.registryState.state)){if(candidates.size)this.warnings.push('Списки созданий соседних контрагентов недоступны: реестр Pump.fun не отвечает. Использованы только прочитанные on-chain события.');return candidates.size;}
    for(const c of selected){this.emit('candidates',`Проверяю предыдущие создания связанного адреса ${this.peerScreened+1}/${selected.length}.`);this.peerScreened++;
      try{const d=await this.createdBy(c.address),coins=d.coins.filter(t=>t.createdAt && t.createdAt<this.target.createdAt);if(!coins.length)continue;
        const path=[c.edge,...(c.from.path || [])],comparison=c.origin!==this.target.creator;
        this.wallets.set(c.address,{address:c.address,depth:c.from.depth+1,path,role:'candidate',origin:c.origin,coins,status:'registry_only',historyStatus:'not_requested',funders:[],destinations:[],warnings:['Кандидат найден по переводу / совместной подписи. История этого адреса отдельно не прочитана, общий владелец не установлен.'],transactionsDecoded:0,creatorListTruncated:d.truncated,relatedBy:c.role});
        this.addEdge(c.edge,c.role);
        for(const coin of coins)if(!this.tokens.has(coin.mint))this.tokens.set(coin.mint,{...coin,path,origin:c.origin,relation:comparison?'comparison_related':c.role,wallet:c.address,evidence:'Earlier creation of an on-chain counterparty; shared owner is NOT established'});
      }catch(e){if(this.signal?.aborted || e.kind==='rate_limited')throw e;this.warnings.push('Не удалось проверить создания одного из адресов-кандидатов.');}
    }
    return Math.max(0,candidates.size-selected.length);
  }
  async run(input,{comparison}={}) {
    const ca=addressFromInput(input);this.emit('token','Определяю токен и дев-адрес.');this.target=await this.coin(ca);this.focusTokens.set(this.target.creator,this.target);this.tokens.set(ca,{...this.target,path:[],origin:this.target.creator,relation:'same_creator',wallet:this.target.creator,evidence:this.target.source});
    this.txPhaseLimit=comparison?Math.floor(this.limits.transactionBudget/2):this.limits.transactionBudget;
    const root=await this.inspect(this.target.creator,0,[],this.target.createdAt,'developer');
    if(root.historyStatus==='unavailable' || (root.signatureCount>0 && !root.transactionsDecoded))throw new SourceError('История дева не прочитана: поиск связей не выполнен. '+root.warnings.join(' · '),{kind:'search_unavailable'});
    if(!root.signatureCount)throw new SourceError('RPC вернул пустую историю creator. Поиск связей не выполнен; запись о токене в реестре не заменяет чтение транзакций.',{kind:'empty_history'});
    let pending=await this.walk(root,comparison?Math.max(2,Math.floor(this.limits.wallets/2)):this.limits.wallets,this.target.creator);
    this.txPhaseLimit=this.limits.transactionBudget;
    // Comparison discovers overlapping addresses even if the bounded upstream
    // search did not reach the other dev. It never presupposes their identity.
    let compare=null;
    if(comparison){const c=await this.coin(addressFromInput(comparison));this.focusTokens.set(c.creator,c);const w=await this.inspect(c.creator,0,[],c.createdAt,'comparison',c.creator);w.creationProof=w.creationProofs?.find(p=>p.mint===c.mint) || w.creationProof;pending+=await this.walk(w,this.limits.wallets,c.creator);const first=this.ancestorPaths(root.address),second=this.ancestorPaths(c.creator);compare={token:c,wallet:w.address,sameCreator:c.creator===this.target.creator,sharedFunders:root.funders.filter(a=>w.funders.some(b=>b.address===a.address)).map(a=>a.address),sharedDestinations:root.destinations.filter(a=>w.destinations.some(b=>a.to===b.to)).map(a=>a.to),directPath:first.has(c.creator),sharedAncestors:[...first.keys()].filter(a=>second.has(a)).map(address=>({address,firstPath:first.get(address),secondPath:second.get(address),service:!!this.wallets.get(address)?.hub,identityEstablished:false}))};}
    const unexaminedPeers=await this.scanRelatedCreators();
    const rootDest=new Set(root.destinations.map(t=>t.to));
    const commonDestinations=[...this.wallets.values()].filter(w=>w.address!==root.address).flatMap(w=>w.destinations.filter(t=>rootDest.has(t.to)).map(t=>({wallet:w.address,destination:t.to,signature:t.signature,confidence:'hypothesis',explanation:'Общий получатель вывода; может быть биржей или сервисом, не доказывает владельца.'})));
    const tokens=prioritizeTokens([...this.tokens.values()],this.target);
    const checked=[...this.wallets.values()].filter(w=>w.transactionsDecoded>0);
    const result={schemaVersion:3,analysedAt:this.analysedAt,target:this.target,comparison:compare,wallets:[...this.wallets.values()],edges:[...this.edges.values()],tokens,commonDestinations,registryDiagnostics:this.registryState,rpcDiagnostics:this.rpcStates,coverage:{wallets:this.wallets.size,checkedWallets:checked.length,transactionsDecoded:checked.reduce((n,w)=>n+w.transactionsDecoded,0),actualDepth:Math.max(0,...[...this.wallets.values()].filter(w=>w.role!=='candidate').map(w=>Math.min(w.path?.length || 0,this.limits.depth))),peersScreened:this.peerScreened,unexaminedPeers,transactionsUnexamined:[...this.wallets.values()].reduce((n,w)=>n+(w.transactionsUnexamined || 0),0),tokens:tokens.length,requests:this.calls,limits:this.limits,queueNotExplored:pending,truncatedCreatorLists:[...this.wallets.values()].filter(w=>w.creatorListTruncated).length,incompleteHistories:[...this.wallets.values()].filter(w=>w.historyComplete===false).length,unavailableTransactions:[...this.wallets.values()].reduce((n,w)=>n+(w.nullTransactions || 0),0)},warnings:['Найденные переводы доказывают движение средств, а не одного владельца кошельков.','Внутренние переводы между клиентами CEX не видны в блокчейне. Один горячий кошелёк биржи не связывает девов.','Поиск ограничен видимой историей Pump.fun, глубиной и бюджетом транзакций; отсутствие связи не доказывает её отсутствие.',...this.warnings]};
    this.emit('done','Проверка завершена.',{wallets:result.wallets.length,tokens:result.tokens.length});return result;
  }
}
function normalizeCoin(c){return {mint:c.mint,name:c.name || 'Без названия',symbol:c.symbol || '',creator:c.creator,createdAt:c.created_timestamp || null,migrated:!!c.complete,marketCapUSD:c.market_cap_usd ?? c.usd_market_cap ?? null,image:c.image_uri || null,metadata:c.metadata_uri || null,twitter:c.twitter || null,website:c.website || null,source:'Pump.fun registry'};}
