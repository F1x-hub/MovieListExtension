const { chromium } = require('/home/user/MovieListExtension/node_modules/playwright');
(async()=>{
  const [,, mode, ctrl, dur, extra] = process.argv;
  const b = await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--mute-audio']});
  const p = await b.newPage(); p.on('pageerror',e=>console.log('pageerror',e.message));
  await fetch('http://localhost:8099/reset'); await fetch('http://localhost:8099/cfg?'+encodeURIComponent(process.env.CFG||'{}'));
  await p.goto(`http://localhost:8099/?mode=${mode}&ctrl=${ctrl||0}&dur=${dur||25}${extra||''}`);
  await p.waitForFunction(()=>window.__R&&window.__R.done,null,{timeout:120000});
  const R = await p.evaluate(()=>window.__R);
  const lag=R.lagSamples; const st=a=>a.length?{n:a.length,min:Math.min(...a),max:Math.max(...a),mean:+(a.reduce((x,y)=>x+y,0)/a.length).toFixed(1)}:null;
  const dr=R.drift; 
  console.log(JSON.stringify({mode:R.mode,ctrl:R.ctrl,lagMs:st(lag),mediaDriftSec:dr.length?{first:dr[0],mid:dr[dr.length>>1],last:dr[dr.length-1],max:Math.max(...dr.map(Math.abs))}:null,counts:R.counts,rms:R.rms,audioel:R.audioel,alt:R.alt,err:[...new Set(R.err)],events:R.events.slice(0,8),marks:R.marks,timeline:(R.lagT||[]).map(x=>x[1]).join(','),traffic:await (await fetch('http://localhost:8099/stats')).json()}));
  await b.close();
})();
