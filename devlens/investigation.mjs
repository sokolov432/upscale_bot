import {QuickProfiler} from './quick.mjs';
import {addressFromInput,validAddress,parseTransaction} from './engine.mjs';
import {KnowledgeIndex,normalizeCase,publicURL} from './knowledge.mjs';
import {launchProofs,authorityHandoffs,contributionSigners,acquisitions,nearLaunchRows,allInstructions,signerKeys} from './launch-evidence.mjs';

export const INVESTIGATION_DEFAULTS=Object.freeze({wallets:18,depth:4,rootTransactions:160,walletTransactions:32,transactionBudget:280,networkBudget:430,signaturePages:2,creatorPages:2,earlyBlocks:2,earlyTransactions:32,earlyWallets:6,cohortWallets:3,cohortTransactions:8,minimumSOL:.01,timeMs:150000,candidateThreshold:20,strongThreshold:60,cohortMinimum:3});
const unique=a=>[...new Set(a)],SOL='So11111111111111111111111111111111111111112';
export const QUOTE_ASSETS=new Set([SOL,'11111111111111111111111111111111','EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v','Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB','TTWofwAge91oFhZs7kpQdyrVRkmevgM88xijGvQFbKo','4kjruqGHDsSqkMdFfCjV7Vb62HPFhtXyWc2t6JpQzDnz','CASHx9KJUStyftLFWGvEVf59SGeG9sh5FfcnZMVPCASH']);
// No accepted previous-token pairs are encoded here. These are settlement /
// reference assets only; callers can extend this set with their own exclusions.
const edgeID=e=>[e.kind,e.signature,e.from,e.to,e.asset,e.raw].join('|');
const source=s=>'https://solscan.io/tx/'+s;
const safeReason=e=>e?.kind==='rate_limited'?'rate_limited':e?.kind==='blocked'?'blocked':e?.kind==='preview_budget'?'network_budget':e?.name==='AbortError' || e?.name==='TimeoutError'?'time_limit':'source_unavailable';

export function fundingPath(edges,from,to,maxDepth=5,services=new Set()){
 const queue=[{wallet:from,path:[]}],seen=new Set([from]);
 while(queue.length){const cur=queue.shift();if(cur.wallet===to)return cur.path;if(cur.path.length>=maxDepth || services.has(cur.wallet))continue;
  for(const e of edges){if(!['funding','program_authority'].includes(e.kind) || e.excluded)continue;const next=e.from===cur.wallet?e.to:e.to===cur.wallet?e.from:null;if(!next || seen.has(next) || services.has(next))continue;seen.add(next);queue.push({wallet:next,path:[...cur.path,e]});}
 }return null;
}
export function cohortEvidence(a=[],b=[]){
 const shared=unique(a.filter(x=>b.some(y=>y.wallet===x.wallet)).map(x=>x.wallet));
 const ordered=shared.filter(w=>a.find(x=>x.wallet===w)?.order===b.find(x=>x.wallet===w)?.order);
 const pairs=unique(shared.flatMap(w=>{const x=a.find(x=>x.wallet===w),y=b.find(x=>x.wallet===w);return (x.coSigners || []).filter(p=>shared.includes(p) && y.coSigners?.includes(p)).map(p=>[w,p].sort().join('|'));}));
 return {shared,ordered,pairs,sources:unique([...a,...b].filter(e=>shared.includes(e.wallet)).map(e=>source(e.signature)))};
}
export function assessPrevious({target,candidate,edges=[],coSignatures=[],currentEarly=[],previousEarly=[],services=new Set(),excluded=new Set(),config=INVESTIGATION_DEFAULTS}){
 const reject=reason=>({mint:candidate.mint,level:'excluded',reason,score:0,evidence:[],identityEstablished:false});
 if(candidate.mint===target.mint)return reject('current_token');
 if(excluded.has(candidate.mint) || QUOTE_ASSETS.has(candidate.mint))return reject('reference_or_quote_asset');
 if(!candidate.launch)return {...reject('launch_not_verified'),level:'unverified'};
 if(!target.launch)return {...reject('current_launch_not_verified'),level:'unverified'};
 if(!candidate.launch.time || !target.launch.time || candidate.launch.time>=target.launch.time)return reject('not_earlier_than_current_launch');
 const evidence=[];let score=0;const add=(family,weight,label,sources=[],details={})=>{score+=weight;evidence.push({id:'e'+(evidence.length+1),family,label,sources:unique(sources),...details});};
 const actor=target.launch.actor,prior=candidate.launch.actor,privateEdges=edges.filter(e=>!e.time || e.time<=target.launch.time);
 if(actor===prior && !services.has(actor))add('signed_launch',100,'Один адрес подписал два подтверждённых запуска',[target.launch.source,candidate.launch.source],{wallets:[actor]});
 const path=fundingPath(privateEdges,actor,prior,config.depth+1,services);
 if(path?.length){add('private_funding',20,'Цепочка переводов между операторами запусков; сама по себе не доказывает владельца',path.map(e=>e.source || source(e.signature)),{path});
  const ancestors=new Set(path.flatMap(e=>[e.from,e.to]));
  const handoffs=privateEdges.filter(e=>e.kind==='program_authority' && ancestors.has(e.from) && ancestors.has(e.to));if(handoffs.length)add('program_authority',25,'В цепочке передавались полномочия управления программой',handoffs.map(e=>e.source),{accounts:handoffs.map(e=>e.account)});
  const synchronized=privateEdges.filter(e=>e.kind==='funding' && ancestors.has(e.to) && !services.has(e.from)).filter(e=>privateEdges.filter(x=>x.kind==='funding' && x.to===e.to && Math.abs(x.time-e.time)<=2).map(x=>x.from).filter((v,i,a)=>a.indexOf(v)===i).length>=3);
  if(synchronized.some(e=>e.from===prior))add('synchronized_consolidation',20,'Оператор участвовал в синхронном сборе средств с трёх и более адресов',synchronized.map(e=>e.source || source(e.signature)),{wallets:unique(synchronized.map(e=>e.from))});
  const joint=coSignatures.filter(c=>c.wallets.includes(prior) && c.wallets.some(w=>ancestors.has(w)) && c.time<=target.launch.time);
  if(joint.length)add('joint_contribution',20,'Совместные подписи и собственные переводы в одной операции',joint.map(e=>e.source),{wallets:unique(joint.flatMap(e=>e.wallets))});
 }
 const cohort=cohortEvidence(currentEarly,previousEarly);
 if(cohort.shared.length>=config.cohortMinimum && cohort.ordered.length>=config.cohortMinimum && cohort.pairs.length>=2)add('early_cohort',75,'Повторились ранние покупатели, порядок и совместные подписи',cohort.sources,{wallets:cohort.shared,ordered:cohort.ordered.length,jointPairs:cohort.pairs.length});
 else if(cohort.shared.length>=config.cohortMinimum)add('early_cohort',20,'Несколько общих ранних покупателей; возможны общие торговые боты',cohort.sources,{wallets:cohort.shared});
 const level=score>=config.strongThreshold?'strong_candidate':score>=config.candidateThreshold?'candidate':'weak';
 return {mint:candidate.mint,name:candidate.name || '',symbol:candidate.symbol || '',actor:prior,creator:candidate.launch.creator,protocol:candidate.launch.protocol,createdAt:candidate.launch.time*1000,level,score,evidence,launch:candidate.launch,identityEstablished:false};
}

export class LaunchInvestigator extends QuickProfiler{
 constructor({memory={cases:[],links:[]},excludedMints=[],config={},planner, ...options}={}){
  super(options);this.config={...INVESTIGATION_DEFAULTS,...config};
  for(const [k,min,max] of [['wallets',1,48],['depth',1,7],['rootTransactions',4,250],['walletTransactions',4,100],['transactionBudget',1,1000],['networkBudget',1,1600],['timeMs',1000,900000],['signaturePages',1,8],['creatorPages',1,4],['earlyBlocks',1,3],['earlyTransactions',4,100],['cohortMinimum',3,6]]){
   if(!Number.isFinite(this.config[k]))throw Error('Некорректный лимит '+k);this.config[k]=Math.min(max,Math.max(min,Math.floor(this.config[k])));
  }
  if(!Number.isFinite(this.config.minimumSOL) || this.config.minimumSOL<=0 || !Number.isFinite(this.config.candidateThreshold) || this.config.candidateThreshold<1 || !Number.isFinite(this.config.strongThreshold) || this.config.strongThreshold<this.config.candidateThreshold)throw Error('Некорректные пороги доказательств.');
  this.networkBudget=this.config.networkBudget;this.memory=memory;this.index=new KnowledgeIndex(memory.cases || [],[]);this.excluded=new Set([...QUOTE_ASSETS,...excludedMints.map(addressFromInput)]);this.planner=planner;
  this.nodes=new Map();this.candidates=new Map();this.graph=new Map();this.joints=[];this.transactions=new Map();this.historyCache=new Map();this.earlyCache=new Map();this.pending=[];this.scheduled=new Set();this.journal=[];this.limitations=[];this.stopped=null;this.started=performance.now();this.completed=0;this.aiRounds=0;
 }
 async get(url,body){if(this.cachedRead){const key=url+JSON.stringify(body || null);if(this.cache.has(key))return this.cache.get(key);const d=await this.cachedRead(url,body);if(d!==undefined){this.cachedResponses++;this.cache.set(key,d);return d;}}return super.get(url,body);}
 record(action,parameters,result){const row={step:this.journal.length+1,action,parameters,result};this.journal.push(row);this.emit('investigation',action,{step:row.step,...parameters});return row;}
 schedule(type,parameters,priority,reason){const key=type+':'+JSON.stringify(parameters);if(this.scheduled.has(key))return;this.scheduled.add(key);this.pending.push({id:'a'+this.scheduled.size,type,parameters,priority,reason});}
 async bounded(work,fallback){if(this.stopped)return fallback;try{return await work();}catch(e){const reason=safeReason(e);this.limitations.push(reason);if(['rate_limited','network_budget','time_limit'].includes(reason) || this.signal?.aborted)this.stopped=reason;return fallback;}}
 async signatures(address){
  if(this.historyCache.has(address))return this.historyCache.get(address);
  const rows=[],cursors=new Set();let before,complete=false;
  for(let p=0;p<this.config.signaturePages;p++){
   if(this.stopped)break;const part=await this.bounded(()=>this.rpc('getSignaturesForAddress',[address,{limit:1000,...(before?{before}:{})}]),null);
   if(!Array.isArray(part))break;rows.push(...part);if(part.length<1000){complete=true;break;}
   before=part.at(-1)?.signature;if(!before || cursors.has(before))break;cursors.add(before);
   // One page is enough to identify a mass service; do not walk its clients.
   if(rows.length>=1000 && rows[0]?.blockTime-rows.at(-1)?.blockTime<86400)break;
  }
  const value={rows:[...new Map(rows.map(r=>[r.signature,r])).values()],complete};this.historyCache.set(address,value);return value;
 }
 async transaction(row){
  if(this.transactions.has(row.signature))return this.transactions.get(row.signature);
  if(this.transactions.size>=this.config.transactionBudget){this.stopped='transaction_budget';return null;}
  // Reserve before starting concurrent requests, so nulls also cost budget.
  this.transactions.set(row.signature,null);
  const t=await this.bounded(()=>this.rpc('getTransaction',[row.signature,{encoding:'jsonParsed',maxSupportedTransactionVersion:1}]),null);
  this.transactions.set(row.signature,t);return t;
 }
 addCandidate(coin,discovery){
  if(!validAddress(coin.mint) || coin.mint===this.target.mint || this.excluded.has(coin.mint))return null;
  const old=this.candidates.get(coin.mint) || {mint:coin.mint,discoveries:[]};Object.assign(old,Object.fromEntries(Object.entries(coin).filter(([,v])=>v!==undefined && v!==null)));old.discoveries.push(discovery);this.candidates.set(coin.mint,old);return old;
 }
 acceptTransaction(tx,row,node){
  if(!tx || tx.meta?.err)return;
  for(const p of launchProofs(tx,row.signature)){
   const coin={mint:p.mint,creator:p.creator,name:p.name,symbol:p.symbol,metadata:p.metadata,createdAt:p.time*1000,launch:{...p,slot:row.slot ?? p.slot}};
   if(p.mint===this.target.mint){if(this.target.creator && ![p.actor,p.creator].includes(this.target.creator))this.limitations.push('supplied_creator_conflicts_with_launch');Object.assign(this.target,coin);if(p.actor!==node.address)this.schedule('inspect_wallet',{address:p.actor,depth:0},100,'Проверить подписавшего запуск оператора отдельно от получателя комиссий');}
   else if(p.actor===node.address && p.time<this.target.createdAt/1000){this.addCandidate(coin,{kind:'signed_launch',wallet:node.address,signature:row.signature});}
  }
  const parsed=parseTransaction(tx,row.signature),cutoff=this.target.createdAt/1000;
  const keys=tx.transaction.message.accountKeys,tokenAccounts=new Set([...(tx.meta.preTokenBalances || []),...(tx.meta.postTokenBalances || [])].map(b=>keys[b.accountIndex]?.pubkey));
  for(const t of parsed.transfers){
   if(t.protocol || tokenAccounts.has(t.from) || tokenAccounts.has(t.to) || !parsed.signers.includes(t.from) || t.from===t.to || !t.time || t.time>cutoff || (t.asset==='SOL'?t.amount<this.config.minimumSOL:t.amount<10))continue;
   // A reference balance, rent refund or read-only occurrence cannot add an edge.
   if(![t.from,t.to].includes(node.address))continue;const e={...t,kind:'funding',source:source(row.signature)};this.graph.set(edgeID(e),e);
  }
  for(const e of authorityHandoffs(tx,row.signature))if([e.from,e.to].includes(node.address) && e.time<=cutoff)this.graph.set(edgeID(e),e);
  const contributors=contributionSigners(tx,parsed.transfers);
  if(contributors.length && parsed.signers.length>=2)this.joints.push({wallets:unique([...contributors,...parsed.transfers.filter(t=>contributors.includes(t.from)).map(t=>t.to)]),signature:row.signature,time:tx.blockTime,source:source(row.signature)});
 }
 async registry(address){
  const coins=[];let complete=false,count=null,available=false;
  for(let p=0;p<this.config.creatorPages;p++){
   const d=await this.bounded(()=>this.get(`https://frontend-api-v3.pump.fun/coins-v2/user-created-coins/${address}?limit=50&offset=${p*50}&includeNsfw=true`),null);
   if(!d)break;const a=Array.isArray(d)?d:d.coins;if(!Array.isArray(a))break;available=true;count=Number.isInteger(d.count)?d.count:count;
   for(const c of a)if(c.creator===address && validAddress(c.mint))coins.push({mint:c.mint,name:c.name,symbol:c.symbol,creator:c.creator,createdAt:c.created_timestamp,metadata:c.metadata_uri,website:c.website,twitter:c.twitter});
   if(a.length<50 || count!==null && (p+1)*50>=count){complete=true;break;}if(count>100)break;
  }return {coins,complete,count,available};
 }
 async inspectWallet({address,depth=0}){
  if(this.nodes.has(address) || this.nodes.size>=this.config.wallets){if(!this.nodes.has(address))this.limitations.push('wallet_budget');return;}
  const node={address,depth,service:false,historyComplete:false,registryComplete:false,decoded:0};this.nodes.set(address,node);
  const [h,r]=await Promise.all([this.signatures(address),this.registry(address)]);node.signatureCount=h.rows.length;node.historyComplete=h.complete;node.registryComplete=r.complete;node.registryCount=r.count;
  const mass=h.rows.length>=1000 && h.rows[0]?.blockTime-h.rows.at(-1)?.blockTime<86400;
  node.service=!!this.labels[address]?.exchange || mass || r.count>100;
  if(node.service && depth>0){node.status='service_boundary';this.record('inspect_wallet',{address,depth},{status:node.status,signatureCount:h.rows.length,registryCount:r.count});return;}
  for(const c of r.coins)if(c.createdAt && c.createdAt<this.target.createdAt){this.addCandidate(c,{kind:'registry_hint',wallet:address});this.schedule('verify_token',{mint:c.mint,actor:address},85,'Проверить реальный запуск из реестра');}
  const focus=address===this.target.creator || address===this.target.launch?.actor?[this.target,...r.coins]:r.coins;
  const allowance=depth===0?this.config.rootTransactions:this.config.walletTransactions;
  const rows=nearLaunchRows(h.rows,focus,this.target.createdAt?this.target.createdAt/1000+2:null,allowance);
  // Four concurrent workers; request starts are separately rate limited.
  for(let i=0;i<rows.length && !this.stopped;i+=4)await Promise.all(rows.slice(i,i+4).map(async row=>{const tx=await this.transaction(row);if(tx){node.decoded++;this.acceptTransaction(tx,row,node);}}));
  node.transactionsUnexamined=Math.max(0,h.rows.filter(r=>!r.err && r.blockTime<=this.target.createdAt/1000+2).length-node.decoded);node.status=h.complete && !node.transactionsUnexamined?'checked':'partial';
  this.record('inspect_wallet',{address,depth},{status:node.status,decoded:node.decoded,historyComplete:h.complete,unexamined:node.transactionsUnexamined});
  if(this.target.launch && !this.earlyCache.has(this.target.mint))this.schedule('early_buyers',{mint:this.target.mint},95,'Проверить реальные ранние приобретения');
  if(depth<this.config.depth && !node.service){
   const edges=[...this.graph.values()].filter(e=>[e.from,e.to].includes(address));
   const peers=new Map();for(const e of edges){const peer=e.from===address?e.to:e.from;if(this.excluded.has(peer) || this.nodes.has(peer) || !validAddress(peer))continue;const rank=e.kind==='program_authority'?95:e.to===address?70:45;const old=peers.get(peer);peers.set(peer,{address:peer,rank:Math.max(rank,old?.rank || 0),count:(old?.count || 0)+1});}
   for(const p of [...peers.values()].sort((a,b)=>b.rank+b.count-a.rank-a.count).slice(0,depth===0?6:4))this.schedule('inspect_wallet',{address:p.address,depth:depth+1},p.rank-depth*5,'Проверить финансового контрагента; связь не равна авторству');
  }
 }
 async verifyToken({mint,actor}){
  const candidate=mint===this.target.mint?this.target:this.candidates.get(mint);if(!candidate || this.excluded.has(mint))return;
  if(!candidate.name || !candidate.createdAt){const meta=await this.bounded(()=>this.coin(mint),null);if(meta)Object.assign(candidate,meta);}
  if(candidate.createdAt && candidate.createdAt>=this.target.createdAt && mint!==this.target.mint)return;
  if(!candidate.launch){
   const address=actor || candidate.creator;if(!validAddress(address))return;const h=await this.signatures(address),near=nearLaunchRows(h.rows,[candidate],candidate.createdAt?candidate.createdAt/1000+2:null,8);
   for(const row of near){const tx=await this.transaction(row);if(!tx)continue;const proof=launchProofs(tx,row.signature).find(e=>e.mint===mint);if(proof){candidate.launch={...proof,slot:row.slot ?? proof.slot};candidate.createdAt=proof.time*1000;candidate.name ||= proof.name;candidate.symbol ||= proof.symbol;break;}}
  }
  this.record('verify_token',{mint},{verified:!!candidate.launch,protocol:candidate.launch?.protocol,actor:candidate.launch?.actor});
  if(candidate.launch)this.schedule('early_buyers',{mint},mint===this.target.mint?95:55,'Сравнить фактические ранние покупки');
 }
 async earlyBuyers({mint}){
  const token=mint===this.target.mint?this.target:this.candidates.get(mint);if(!token?.launch || this.earlyCache.has(mint))return;
  const start=token.launch.slot;if(!Number.isSafeInteger(start)){this.limitations.push('launch_slot_unavailable');return;}
  const found=[];let complete=true,positions=0;
  for(let slot=start;slot<start+this.config.earlyBlocks && positions<this.config.earlyWallets;slot++){
   // Inspect the entire birth block, not just four unrelated neighbours. The
   // signatures-only fallback uses the same bounded window and discloses gaps.
   const block=await this.bounded(()=>this.rpc('getBlock',[slot,{encoding:'jsonParsed',transactionDetails:'full',rewards:false,maxSupportedTransactionVersion:1}]),null);
   if(!block){complete=false;continue;}
   let txs=block.transactions?.map((t,index)=>({tx:{...t,slot,blockTime:block.blockTime},signature:t.transaction?.signatures?.[0],index}));
   if(!txs && block.signatures){let index=slot===start?block.signatures.indexOf(token.launch.signature)+1:0;if(index===0 && slot===start){complete=false;continue;}
    const slice=block.signatures.slice(index,index+this.config.earlyTransactions);txs=[];
    for(let i=0;i<slice.length && !this.stopped;i+=4)txs.push(...await Promise.all(slice.slice(i,i+4).map(async(signature,j)=>({signature,index:index+i+j,tx:await this.transaction({signature})}))));
    if(index+slice.length<block.signatures.length)complete=false;
   }
   if(!txs){complete=false;continue;}
   const creationIndex=slot===start?txs.find(t=>t.signature===token.launch.signature)?.index ?? (block.signatures?.indexOf(token.launch.signature) ?? -1):-1;
   if(slot===start && !block.signatures && creationIndex<0){complete=false;continue;}
   for(const t of txs){if(slot===start && t.index<=creationIndex || !t.tx || t.tx.meta?.err)continue;
    const a=acquisitions(t.tx,mint,token.launch.actor,t.signature,t.index,slot).filter(e=>!found.some(x=>x.wallet===e.wallet));
    if(a.length){positions++;for(const row of a)found.push({...row,order:positions});}if(positions>=this.config.earlyWallets)break;
   }
  }
  this.earlyCache.set(mint,found);this.record('early_buyers',{mint},{wallets:found.length,windowComplete:complete,birthSlot:start,blocks:this.config.earlyBlocks});
  if(mint===this.target.mint){
   const profile=normalizeCase({...this.target,early:found,coverage:{early:complete},observedAt:Date.now()});
   // Do not feed the target's saved answer or reviewed pair labels to discovery.
   const matches=new KnowledgeIndex((this.memory.cases || []).filter(c=>c.mint!==mint),[]).search(profile);
   for(const m of matches.filter(m=>m.createdAt && m.createdAt<this.target.createdAt)){
    const original=this.index.cases.get(m.mint);if(!original || !m.evidence.some(e=>e.family==='early' && e.specificCount>=this.config.cohortMinimum))continue;
    this.addCandidate(original,{kind:'memory_cohort',wallets:m.evidence.filter(e=>e.family==='early').flatMap(e=>e.wallets || [])});this.schedule('verify_token',{mint:m.mint,actor:original.creator},90,'Проверить кандидат по совпадению ранней группы');
   }
   if(found.length>=this.config.cohortMinimum && !matches.some(m=>m.level==='strong_candidate'))this.schedule('discover_cohort',{},30,'Поиск пересечений старых сделок группы, без объявления торгуемых токенов запусками');
  }
 }
 async discoverCohort(){
  const buyers=(this.earlyCache.get(this.target.mint) || []).slice(0,this.config.cohortWallets),mints=new Map();
  for(const b of buyers){if(this.stopped)break;const h=await this.signatures(b.wallet);const rows=h.rows.filter(r=>!r.err && r.blockTime<this.target.launch.time).slice(0,this.config.cohortTransactions);
   for(const row of rows){const tx=await this.transaction(row);if(!tx || !signerKeys(tx).includes(b.wallet))continue;
    for(const balance of tx.meta?.postTokenBalances || []){if(balance.owner!==b.wallet || this.excluded.has(balance.mint))continue;
     const old=(tx.meta.preTokenBalances || []).find(x=>x.accountIndex===balance.accountIndex && x.mint===balance.mint);if(BigInt(balance.uiTokenAmount.amount)<=BigInt(old?.uiTokenAmount.amount || 0))continue;
     if(!mints.has(balance.mint))mints.set(balance.mint,new Set());mints.get(balance.mint).add(b.wallet);
    }
   }
  }
  for(const [mint,holders] of [...mints].filter(([,h])=>h.size>=this.config.cohortMinimum).sort((a,b)=>b[1].size-a[1].size).slice(0,4)){
   const meta=await this.bounded(()=>this.coin(mint),null);if(!meta || !meta.createdAt || meta.createdAt>=this.target.createdAt)continue;
   this.addCandidate(meta,{kind:'cohort_trade_intersection',wallets:[...holders]});this.schedule('verify_token',{mint,actor:meta.creator},65,'Пересечение сделок — только кандидат для отдельной проверки запуска');
  }
  this.record('discover_cohort',{}, {buyers:buyers.length,intersections:[...mints].filter(([,h])=>h.size>=this.config.cohortMinimum).length});
 }
 async plan(){
  if(!this.planner || this.aiRounds>=3 || this.pending.length<2)return;this.aiRounds++;
  const packet={target:{mint:this.target.mint,creator:this.target.creator,launchVerified:!!this.target.launch},wallets:[...this.nodes.values()],candidates:[...this.candidates.values()].slice(0,15).map(c=>({mint:c.mint,verified:!!c.launch,discoveries:c.discoveries})),actions:this.pending.slice(0,20).map(a=>({id:a.id,type:a.type,parameters:a.parameters,reason:a.reason})),facts:this.journal.slice(-16).map(r=>({id:'step'+r.step,action:r.action,result:r.result}))};
  const p=await this.bounded(()=>this.planner(packet),null);if(!p){this.record('ai_plan',{}, {state:'unavailable'});return;}
  const allowed=new Set(packet.actions.map(a=>a.id));if(!Array.isArray(p.actionIds) || p.actionIds.some(id=>!allowed.has(id))){this.record('ai_plan',{}, {state:'rejected_unobserved_action'});return;}
  for(const [i,id] of unique(p.actionIds).entries()){const action=this.pending.find(a=>a.id===id);if(action)action.priority=120-i;}
  this.record('ai_plan',{}, {state:'applied',actionIds:p.actionIds,reason:String(p.reason || '').slice(0,1000)});
 }
 async run(input,{creator}={}){
  const mint=addressFromInput(input);if(creator)addressFromInput(creator);
  const inherited=this.signal;this.signal=AbortSignal.any([...(inherited?[inherited]:[]),AbortSignal.timeout(this.config.timeMs)]);
  const coin=await this.bounded(()=>this.coin(mint),null);this.target={mint,...(coin || {}),creator:creator || coin?.creator || null,launch:null};
  for(const link of this.memory.links || [])if(link.decision==='rejected' && [link.a,link.b].includes(mint))this.excluded.add(link.a===mint?link.b:link.a);
  if(creator && coin?.creator && creator!==coin.creator)this.limitations.push('supplied_creator_differs_from_registry');
  // A missing date is not replaced with now: funder chronology needs a birth.
  this.target.createdAt ||= null;
  if(!this.target.createdAt || !this.target.creator){const birth=await this.bounded(()=>this.findMintBirth(mint),null);if(birth){this.target.createdAt=birth.target.createdAt;const row=birth.launch.row,proof=launchProofs(birth.launch.tx,row.signature).find(e=>e.mint===mint);if(proof){this.target.launch={...proof,slot:row.slot};this.target.creator ||= proof.actor;}}}
  if(!this.target.creator){this.limitations.push('creator_unavailable');return this.report();}
  if(!this.target.createdAt){this.limitations.push('launch_time_unavailable');return this.report();}
  this.schedule('inspect_wallet',{address:this.target.creator,depth:0},100,'Установить запуск и пополнения дев-кошелька');
  while(this.pending.length && !this.stopped){
   if(performance.now()-this.started>this.config.timeMs){this.stopped='time_limit';break;}
   if(this.completed && this.completed%6===0)await this.plan();
   this.pending.sort((a,b)=>b.priority-a.priority);const action=this.pending.shift();this.completed++;
   await this.bounded(()=>({inspect_wallet:p=>this.inspectWallet(p),verify_token:p=>this.verifyToken(p),early_buyers:p=>this.earlyBuyers(p),discover_cohort:()=>this.discoverCohort()})[action.type](action.parameters),null);
  }
  return this.report();
 }
 report(){
  const services=new Set([...this.nodes.values()].filter(n=>n.service).map(n=>n.address)),edges=[...this.graph.values()];
  const all=[...this.candidates.values()].map(candidate=>assessPrevious({target:this.target,candidate,edges,coSignatures:this.joints,currentEarly:this.earlyCache.get(this.target.mint),previousEarly:this.earlyCache.get(candidate.mint),services,excluded:this.excluded,config:this.config}));
  const candidates=all.filter(c=>['candidate','strong_candidate'].includes(c.level)).sort((a,b)=>b.score-a.score || b.createdAt-a.createdAt);
  const coverage={wallets:this.nodes.size,transactionRequests:this.transactions.size,transactionsDecoded:[...this.transactions.values()].filter(Boolean).length,networkRequests:this.calls,unexaminedWalletTransactions:[...this.nodes.values()].reduce((n,w)=>n+(w.transactionsUnexamined || 0),0),incompleteHistories:[...this.nodes.values()].filter(w=>!w.historyComplete).length,pendingActions:this.pending.length,stopped:this.stopped};
  return {version:1,analysedAt:new Date().toISOString(),target:this.target,outcome:!this.target.launch?'current_launch_unverified':candidates.length?'candidates_found':'no_supported_candidate_in_checked_scope',candidates,unverified:all.filter(c=>c.level==='unverified'),weak:all.filter(c=>c.level==='weak'),excluded:all.filter(c=>c.level==='excluded'),wallets:[...this.nodes.values()],edges,coSignatures:this.joints,early:[...this.earlyCache].map(([mint,rows])=>({mint,rows})),coverage,limitations:unique([...this.limitations,...(this.stopped?[this.stopped]:[]),'Candidate scores order evidence; they are not probabilities or proof of a common human owner.','No result applies only to the checked scope; unobserved launches may exist.']),ai:{state:this.planner?(this.journal.some(s=>s.action==='ai_plan' && s.result.state==='applied')?'used':'not_used'):'unconfigured',rounds:this.aiRounds},recipe:{version:1,input:{mint:this.target.mint,creator:this.target.creator},config:this.config,excludedMints:[...this.excluded],steps:this.journal.map(({step,action,parameters,result})=>({step,action,parameters,result}))},elapsedMs:Math.round(performance.now()-this.started)};
 }
}
