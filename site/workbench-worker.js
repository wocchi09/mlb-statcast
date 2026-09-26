importScripts('workbench-core.js?v=20260926a');
let manifest, selected=[], cache=new Map();
self.onmessage=async({data})=>{
  const {id,type,filters:f}=data;
  try{
    if(type==='csv'){self.postMessage({id,csv:WorkbenchCore.csv(selected,manifest.fields)});return;}
    manifest=data.manifest;
    selected=[];let baseline=[];
    const chunks=manifest.shards.filter(s=>(s.end>=f.start&&s.start<=f.end)||(s.end>=f.beforeStart&&s.start<=f.beforeEnd));
    for(let i=0;i<chunks.length;i++){
      const shard=chunks[i],key=shard.sha256;
      self.postMessage({id,progress:`投球データを読み込み中 ${i+1}/${chunks.length}`});
      let arrays=cache.get(key);
      if(!arrays){
        const response=await fetch('data/workbench/'+shard.file+'?v='+key.slice(0,12));
        if(!response.ok)throw Error('投球データを取得できませんでした。再実行してください。');
        if(typeof DecompressionStream==='undefined')throw Error('最新のChrome、Edge、Safariで開いてください。');
        const bytes=await response.arrayBuffer();
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
        if(hash!==key)throw Error('データ更新中です。ページを再読み込みしてください。');
        arrays=await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
        if(cache.size>=2)cache.delete(cache.keys().next().value);cache.set(key,arrays);
      }
      for(const a of arrays){const r=Object.fromEntries(manifest.fields.map((k,j)=>[k,a[j]]));if(!WorkbenchCore.matches(r,f))continue;if(r.game_date>=f.start&&r.game_date<=f.end)selected.push(r);if(r.game_date>=f.beforeStart&&r.game_date<=f.beforeEnd)baseline.push(r);}
    }
    selected.sort((a,b)=>a.game_date.localeCompare(b.game_date)||a.game_pk-b.game_pk||a.at_bat_number-b.at_bat_number||a.pitch_number-b.pitch_number);
    self.postMessage({id,progress:'指標・移動平均・コース別傾向を計算中'});
    self.postMessage({id,result:{current:WorkbenchCore.summary(selected),before:WorkbenchCore.summary(baseline),heat:WorkbenchCore.heatmap(selected,f.heat),series:WorkbenchCore.rolling(selected,Number(f.window)),alerts:f.role==='pitcher'&&f.player&&f.pitch?WorkbenchCore.changes(selected,Number(f.window)):[]}});
  }catch(error){self.postMessage({id,error:error.message});}
};
