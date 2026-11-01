// Launch proofs, not token ownership: a buy/quote balance is never a launch.
import {creationEvents,validAddress,PUMP} from './engine.mjs';
import {un58,LAUNCHPAD_PROGRAM} from './solana.mjs';

export const DBC='dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';
const TOKEN=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const BPF='BPFLoaderUpgradeab1e11111111111111111111111';
const INITIALIZERS=new Map([
 [LAUNCHPAD_PROGRAM,[[175,175,109,31,13,152,155,237],[67,153,175,39,218,16,38,32],[37,190,126,222,44,154,171,17]]],
 [DBC,[[140,85,215,176,102,54,104,79],[169,118,51,78,145,110,220,155]]]
]);
export function allInstructions(tx){return [...(tx?.transaction?.message?.instructions || []),...(tx?.meta?.innerInstructions || []).flatMap(g=>g.instructions || [])];}
export function signerKeys(tx){return (tx?.transaction?.message?.accountKeys || []).filter(k=>k.signer).map(k=>k.pubkey);}
function initializer(i){try{return INITIALIZERS.get(i.programId)?.some(d=>d.every((v,j)=>un58(i.data || '')[j]===v));}catch{return false;}}
export function launchProofs(tx,signature){
 if(!tx || tx.meta?.err)return [];
 const signers=signerKeys(tx),ins=allInstructions(tx),out=[];
 const initialized=ins.filter(i=>TOKEN.has(i.programId) && /^initializeMint/.test(i.parsed?.type || '')).map(i=>i.parsed.info?.mint).filter(validAddress);
 for(const e of creationEvents(tx)){
  // CreateEvent.creator may be a different fee recipient. The signed user is
  // retained separately; neither field is silently substituted for the other.
  if(!signers.includes(e.user))continue;
  out.push({mint:e.mint,actor:e.user,creator:e.creator,role:e.creator===e.user?'creator':'launch_operator',protocol:'pump',name:e.name,symbol:e.symbol,metadata:e.uri,signature,time:tx.blockTime,slot:tx.slot,proof:'program_create_event',source:'https://solscan.io/tx/'+signature});
 }
 for(const i of ins.filter(initializer))for(const mint of initialized){
  if(out.some(e=>e.mint===mint) || !(i.accounts || []).includes(mint))continue;
  // LaunchLab's creator is account 0, payer account 1, base mint account 6.
  // DBC has different layouts: keep its signed pool operator, never the payer
  // or a metadata authority alone, and disclose the weaker attribution role.
  const actor=i.programId===LAUNCHPAD_PROGRAM?i.accounts?.[0]:i.accounts?.find(a=>signers.includes(a) && a!==mint);
  if(!actor || !signers.includes(actor) || (i.programId===LAUNCHPAD_PROGRAM && i.accounts?.[6]!==mint))continue;
  out.push({mint,actor,creator:i.programId===LAUNCHPAD_PROGRAM?actor:null,role:i.programId===LAUNCHPAD_PROGRAM?'creator':'pool_operator',protocol:i.programId===LAUNCHPAD_PROGRAM?'raydium_launchlab':'meteora_dbc',signature,time:tx.blockTime,slot:tx.slot,proof:'supported_initializer_and_initialize_mint',source:'https://solscan.io/tx/'+signature});
 }
 return out;
}
export function authorityHandoffs(tx,signature){
 if(!tx || tx.meta?.err)return [];
 const signers=signerKeys(tx);
 return allInstructions(tx).filter(i=>i.programId===BPF && i.parsed?.type==='setAuthority').map(i=>i.parsed.info).filter(i=>signers.includes(i.authority) && validAddress(i.newAuthority)).map(i=>({from:i.authority,to:i.newAuthority,account:i.account,newAuthority:i.newAuthority,signature,time:tx.blockTime,kind:'program_authority',source:'https://solscan.io/tx/'+signature}));
}
const SPONSORS=new Set(['Send9wszHjEiS3hwKcPeSLsPRu5Gb62iCrJEcG4Mq3b']);
export function contributionSigners(tx,transfers){
 if(!tx || tx.meta?.err || allInstructions(tx).some(i=>SPONSORS.has(i.programId)) || launchProofs(tx,'').length)return [];
 const signers=signerKeys(tx);
 // Fee sponsorship/close-account signatures do not imply a developer group.
 return signers.filter(a=>transfers.some(t=>!t.protocol && t.from===a && t.amount>=.01 && signers.includes(t.to)));
}
export function acquisitions(tx,mint,creator,signature,index,slot){
 if(!tx || tx.meta?.err)return [];
 const signers=signerKeys(tx),before=tx.meta.preTokenBalances || [],out=[];
 for(const b of tx.meta.postTokenBalances || []){
  if(b.mint!==mint || b.owner===creator || !signers.includes(b.owner))continue;
  const old=before.find(p=>p.accountIndex===b.accountIndex && p.mint===mint);
  let amount;try{amount=BigInt(b.uiTokenAmount.amount)-BigInt(old?.uiTokenAmount?.amount || 0);}catch{continue;}
  if(amount<=0n)continue;
  out.push({wallet:b.owner,signature,index,slot,coSigners:signers.filter(a=>a!==b.owner && a!==mint),tokenAmount:String(amount)});
 }
 return out;
}
export function nearLaunchRows(rows,coins,cutoff,limit){
 const valid=rows.filter(r=>!r.err && (!cutoff || !r.blockTime || r.blockTime<=cutoff)),selected=new Map();
 const add=r=>{if(r && selected.size<limit)selected.set(r.signature,r);};
 // Resolve advertised births first, then both ends and a spread of history.
 for(const c of coins.toSorted((a,b)=>(b.createdAt || 0)-(a.createdAt || 0))){
  if(!c.createdAt)continue;
  for(const r of valid.filter(r=>Math.abs(r.blockTime-c.createdAt/1000)<=2))add(r);
 }
 const band=Math.max(2,Math.floor(limit/4));
 valid.slice(0,band).forEach(add);valid.slice(-band).toReversed().forEach(add);
 for(let i=0;selected.size<Math.min(limit,valid.length) && i<valid.length;i++)add(valid[Math.floor(i*(valid.length-1)/Math.max(1,valid.length-1))]);
 return [...selected.values()];
}
