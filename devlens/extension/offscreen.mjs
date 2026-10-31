const worker=new Worker('analysis-worker.mjs',{type:'module'});
worker.onmessage=async e=>{
  const m=e.data;
  if(m.type==='fetch' || m.type==='fetch-cancel'){
    try{const reply=await chrome.runtime.sendMessage({target:'devlens-network',...m});if(m.type==='fetch')worker.postMessage({type:'fetch-result',requestId:m.requestId,reply});}
    catch(error){if(m.type==='fetch')worker.postMessage({type:'fetch-result',requestId:m.requestId,reply:{error:String(error)}});}
  }else chrome.runtime.sendMessage({target:'devlens-background',...m}).catch(()=>{});
};
chrome.runtime.onMessage.addListener((message,sender)=>{
  if(sender.id!==chrome.runtime.id || message.target!=='devlens-offscreen')return;
  worker.postMessage(message);
});
