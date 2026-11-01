(() => {
  if(globalThis.__devlensSocialPage)return;globalThis.__devlensSocialPage=true;
  let previous='',timer;
  async function observe(){
    if(!/^\/[a-zA-Z0-9_]{1,15}\/?$/.test(location.pathname) || /^\/(?:home|explore|notifications|messages|settings|search)\/?$/.test(location.pathname))return;
    const root=document.querySelector('[data-testid="primaryColumn"]');if(!root)return;
    const name=root.querySelector('[data-testid="UserName"]'),bio=root.querySelector('[data-testid="UserDescription"]');if(!name)return;
    const followers=root.querySelector('a[href$="/verified_followers"], a[href$="/followers"]'),count=followers?.querySelector('[title]')?.getAttribute('title') || followers?.textContent?.replace(/Followers|подписчик[а-я]*/gi,'').trim() || '';
    // Abbreviated 1.2K / 1,2 млн is not stored as an exact follower count.
    const exact=/^\d+$/.test(count) || /^\d{1,3}(?:[, .\u00a0]\d{3})+$/.test(count)?Number(count.replace(/[, .\u00a0]/g,'')):null;
    const avatar=root.querySelector('[data-testid^="UserAvatar-Container"] img'),banner=root.querySelector('a[href$="/header_photo"] img');
    const raw={url:location.origin+location.pathname,displayName:name.textContent,bio:bio?.innerText || '',followers:exact,followersText:count,avatar:avatar?.src,banner:banner?.src},key=JSON.stringify(raw);if(key===previous)return;
    try{const r=await chrome.runtime.sendMessage({target:'devlens-chat-relay',type:'social-observation',profile:raw});if(r.updated>0)previous=key;}catch{}
  }
  new MutationObserver(()=>{clearTimeout(timer);timer=setTimeout(observe,1200);}).observe(document.documentElement,{childList:true,subtree:true});
  setInterval(observe,5000);observe();
})();
