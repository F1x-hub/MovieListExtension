const T=[['http://127.0.0.1:3000/ok','xhr3000'],['http://localhost:3579/ok','xhr3579'],['http://127.0.0.1:9999/ok','xhr9999'],['http://localhost:9999/ok','xhrLocal9999'],['http://127.0.0.2:3000/ok','xhr127_2'],['http://[::1]:3000/ok','xhrV6'],['http://127.0.0.1:3000/redir?to=http://127.0.0.1:9999/ok','redir3000to9999']];
async function run(){const out={};
 for(const [u,k] of T){try{const r=await fetch(u);out[k]=r.status+':'+(await r.text()).slice(0,10);}catch(e){out[k]='ERR '+e.message.slice(0,40);}}
 const media=async(u)=>new Promise(res=>{const v=document.createElement('video');v.onloadedmetadata=()=>res('meta');v.onerror=()=>res('err '+(v.error&&v.error.code));v.src=u;setTimeout(()=>res('timeout'),4000);});
 out.media3000=await media('http://127.0.0.1:3000/v.webm');out.media9999=await media('http://127.0.0.1:9999/v.webm');
 out.ws9999=await new Promise(res=>{try{const w=new WebSocket('ws://127.0.0.1:9999/');w.onopen=()=>res('open');w.onerror=()=>res('err');setTimeout(()=>res('timeout'),3000);}catch(e){res('throw')}});
 out.sw=await chrome.runtime.sendMessage({t:'sw'});
 try{await chrome.offscreen.createDocument({url:'off.html',reasons:['DOM_PARSER'],justification:'t'});}catch(e){}
 out.off=await new Promise(r=>setTimeout(async()=>r(await chrome.runtime.sendMessage({t:'off'})),500));
 window.__out=out; document.title='DONE';}
run();
