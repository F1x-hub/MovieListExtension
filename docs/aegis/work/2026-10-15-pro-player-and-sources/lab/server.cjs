const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname; const stats={}; let cfg={};
http.createServer((q,r)=>{
  const u=decodeURIComponent(q.url.split('?')[0]); const f=path.join(root,u==='/'?'page.html':u);
  const set=(c,t)=>r.setHeader('Content-Type',t||'application/octet-stream');
  r.setHeader('Access-Control-Allow-Origin','*');
  if(u==='/cfg'){cfg=JSON.parse(decodeURIComponent(q.url.split('?')[1]||'{}'));r.end('ok');return;}
  if(u==='/stats'){r.end(JSON.stringify(stats));return;}
  if(u==='/reset'){for(const k in stats)delete stats[k];r.end('ok');return;}
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.statusCode=404;r.end();return;}
  const go=()=>{const d=fs.readFileSync(f); const ext=path.extname(f);
  r.setHeader('Content-Type',{'.m3u8':'application/vnd.apple.mpegurl','.html':'text/html','.js':'text/javascript','.mp4':'video/mp4','.m4s':'video/iso.segment'}[ext]||'application/octet-stream');
  const k=u.split('/')[1]; stats[k]=(stats[k]||0)+d.length;
  r.end(d);};
  if(cfg.stall&&u===cfg.stall){setTimeout(go,cfg.ms||6000);}else go();
}).listen(8099,()=>console.log('up'));
