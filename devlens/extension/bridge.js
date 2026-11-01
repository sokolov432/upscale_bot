(() => {
  const origin=location.origin;let port,heartbeat;
  const stopHeartbeat=()=>{clearInterval(heartbeat);heartbeat=null;};
  const connect=()=>{if(port)return port;port=chrome.runtime.connect({name:'devlens'});port.onMessage.addListener(message=>{if(['result','error','profile'].includes(message.type))stopHeartbeat();window.postMessage({source:'devlens-extension',...message},origin);});port.onDisconnect.addListener(()=>{stopHeartbeat();port=null;window.postMessage({source:'devlens-extension',type:'disconnected'},origin);});return port;};
  window.addEventListener('message',event=>{
    if(event.source!==window || event.origin!==origin || event.data?.source!=='devlens-site')return;
    const m=event.data;
    if(m.type==='ping'){window.postMessage({source:'devlens-extension',type:'ready',version:chrome.runtime.getManifest().version},origin);return;}
    if(!['analyze','quick','ai-summary','cancel','open-settings'].includes(m.type))return;
    if(typeof m.id!=='string' || m.id.length>100)return;
    connect().postMessage({type:m.type,id:m.id,ca:String(m.ca || '').slice(0,180),comparison:String(m.comparison || '').slice(0,180),deep:!!m.deep,...(m.type==='ai-summary'?{profile:m.profile,matches:m.matches}:{})});
    // Sending port messages (not merely opening a port) keeps MV3 available
    // during a provider's long Retry-After pause. No extra API requests.
    if(m.type==='analyze' || m.type==='quick'){stopHeartbeat();heartbeat=setInterval(()=>{try{port?.postMessage({type:'keepalive'});}catch{stopHeartbeat();}},15000);}
  });
})();
