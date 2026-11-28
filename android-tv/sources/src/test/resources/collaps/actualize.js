!function(){
var conf=window['__actualize.js'];
if(conf)return;window['__actualize.js']=conf={};
var actual = "https://api.corevia.ws"
	,re=/^(?:https?:)?\/\/(?:mm|app?i\w*)\.((?:embedstorage|embf|multikland)\.net|(?:buildplayer|mir-dikogo-zapada|synchroncode)\.com|delivembed\.cc|placehere\.link|ameytools\.club|(?:tobaco|topdbltj|delivembd|hostemb|loadbox|getcodes|strvid|ebder|framprox|embprox|bedemp2|embr|lessornot|linktodo|insertunit|marts|ninsel|embess|luxembd|domem|atomics|namy|variyt|zenithjs|ortified|nextembed|datavex)\.ws)/
	,delay=200,max=1000*60*60*24
	,dry=[]
	,ua=navigator.userAgent
	,ios=~ua.indexOf('iPhone')
	,ral
	,m = ua.match(/Chrome\/(\d+)\./),v = m && +m[1] || 1
	,IM = ' !important;',css=document.createElement('style');
css.innerHTML= '.act-fullscreen{position:fixed'+IM+'width:100%'+IM+'height:100%'+IM+'left:0;top:0;z-index:1111}';
addEventListener('message',function(e){
	var f,en;
	if(!e.data||!(f=findFrame(function (f){return f.contentWindow==e.source})))return;
	if(e.data.event=='externalFullScreen?'){
		if(!css.parentNode)document.head.appendChild(css);
		e.source.postMessage({event:'externalFullScreen!'});
	}else if(e.data.event=='toggleFullScreen'){
		en=f.c
