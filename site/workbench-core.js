/* Pure analysis functions shared by the worker and regression tests. */
(function(root){
  'use strict';
  const finite=v=>v!==null&&v!==undefined&&Number.isFinite(Number(v));
  const mean=a=>a.length?a.reduce((s,x)=>s+Number(x),0)/a.length:null;
  const divide=(a,b)=>b?a/b:null;
  const hits={single:1,double:2,triple:3,home_run:4};
  const nonAB=new Set(['walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','catcher_interf','sac_fly_double_play','sac_bunt_double_play']);
  const whiffs=new Set(['swinging_strike','swinging_strike_blocked','missed_bunt']);
  const swings=new Set([...whiffs,'foul','foul_tip','hit_into_play','foul_bunt']);
  const validAB=r=>Boolean(r.events)&&!nonAB.has(r.events);
  function matches(r,f){
    if(f.player&&String(r[f.role])!==String(f.player))return false;
    if(f.pitch&&r.pitch_type!==f.pitch)return false;
    if(f.stand&&r.stand!==f.stand)return false;
    if(f.throws&&r.p_throws!==f.throws)return false;
    if(f.count&&`${r.balls}-${r.strikes}`!==f.count)return false;
    const bat=r.inning_topbot==='Top'?r.away_team:r.home_team;
    const pit=r.inning_topbot==='Top'?r.home_team:r.away_team;
    return !f.team||(f.role==='batter'?bat:pit)===f.team;
  }
  function summary(rows){
    const pa=rows.filter(r=>r.events),ab=pa.filter(validAB),bbe=rows.filter(r=>r.description==='hit_into_play');
    const values=k=>rows.filter(r=>finite(r[k])).map(r=>Number(r[k]));
    const pair=(field,actual,denom)=>{const selected=pa.filter(r=>denom(r)&&finite(r[field]));return {actual:mean(selected.map(actual)),expected:mean(selected.map(r=>r[field])),n:selected.length}};
    const expectedBA=pair('estimated_ba_using_speedangle',r=>hits[r.events]?1:0,validAB);
    const expectedSLG=pair('estimated_slg_using_speedangle',r=>hits[r.events]||0,validAB);
    const wRows=pa.filter(r=>finite(r.woba_value)&&finite(r.woba_denom)&&r.woba_denom>0);
    const matchedW=wRows.filter(r=>finite(r.estimated_woba_using_speedangle));
    const wDen=matchedW.reduce((s,r)=>s+r.woba_denom,0);
    const expectedWOBA={actual:divide(matchedW.reduce((s,r)=>s+r.woba_value,0),wDen),expected:divide(matchedW.reduce((s,r)=>s+r.estimated_woba_using_speedangle*r.woba_denom,0),wDen),n:matchedW.length};
    const sw=rows.filter(r=>swings.has(r.description)).length,wh=rows.filter(r=>whiffs.has(r.description)).length;
    const missing=(key,pool)=>({n:pool.filter(r=>finite(r[key])).length,total:pool.length,missing:divide(pool.filter(r=>!finite(r[key])).length,pool.length)});
    return {pitches:rows.length,pa:pa.length,ab:ab.length,bbe:bbe.length,games:new Set(rows.map(r=>r.game_pk)).size,
      avg:divide(ab.filter(r=>hits[r.events]).length,ab.length),slg:divide(ab.reduce((s,r)=>s+(hits[r.events]||0),0),ab.length),
      woba:divide(wRows.reduce((s,r)=>s+r.woba_value,0),wRows.reduce((s,r)=>s+r.woba_denom,0)),
      velo:mean(values('release_speed')),pfx_x:mean(values('pfx_x')),pfx_z:mean(values('pfx_z')),release_pos_x:mean(values('release_pos_x')),release_pos_z:mean(values('release_pos_z')),
      whiff:divide(wh,sw),swings:sw,ev:mean(bbe.filter(r=>finite(r.launch_speed)).map(r=>r.launch_speed)),
      expectedBA,expectedSLG,expectedWOBA,
      quality:{release_speed:missing('release_speed',rows),plate_x:missing('plate_x',rows),plate_z:missing('plate_z',rows),pfx_x:missing('pfx_x',rows),pfx_z:missing('pfx_z',rows),release_pos_x:missing('release_pos_x',rows),release_pos_z:missing('release_pos_z',rows),launch_speed:missing('launch_speed',bbe),estimated_ba_using_speedangle:missing('estimated_ba_using_speedangle',bbe),estimated_slg_using_speedangle:missing('estimated_slg_using_speedangle',bbe),estimated_woba_using_speedangle:missing('estimated_woba_using_speedangle',bbe)}};
  }
  function heatmap(rows,mode){
    const bins=Array.from({length:5},()=>Array.from({length:5},()=>({n:0,d:0})));let located=0;
    for(const r of rows){if(![r.plate_x,r.plate_z,r.sz_bot,r.sz_top].every(finite)||r.sz_top<=r.sz_bot)continue;
      const x=Number(r.plate_x),z=(r.plate_z-r.sz_bot)/(r.sz_top-r.sz_bot);
      if(x< -1.5||x>1.5||z<-.5||z>1.5)continue;located++;
      const cell=bins[Math.min(4,Math.floor((z+.5)/.4))][Math.min(4,Math.floor((x+1.5)/.6))];
      if(mode==='whiff'){if(swings.has(r.description))cell.d++;if(whiffs.has(r.description))cell.n++;}
      else if(mode==='hard'){if(r.description==='hit_into_play'&&finite(r.launch_speed)){cell.d++;if(r.launch_speed>=95)cell.n++;}}
      else {cell.n++;cell.d++;}
    }return {bins,located,total:rows.length};
  }
  function rolling(rows,windowDays=7){
    const days=[...new Set(rows.map(r=>r.game_date))].sort();
    const buckets=new Map(days.map(d=>[d,[]]));rows.forEach(r=>buckets.get(r.game_date).push(r));
    return days.map(date=>{const low=new Date(Date.parse(date+'T00:00:00Z')-(windowDays-1)*86400000).toISOString().slice(0,10);const pool=days.filter(d=>d>=low&&d<=date).flatMap(d=>buckets.get(d));const s=summary(pool);return {date,...Object.fromEntries(['pitches','velo','pfx_x','pfx_z','release_pos_x','release_pos_z','avg','slg','woba','expectedBA','expectedSLG','expectedWOBA'].map(k=>[k,s[k]]))}});
  }
  function changes(rows,windowDays=7){
    const timeline=rolling(rows,windowDays),alerts=[];
    const specs=[['release_speed','球速',1,'mph'],['pfx_x','横変化',.15,'ft'],['pfx_z','縦変化',.15,'ft'],['release_pos_x','リリース横',.15,'ft'],['release_pos_z','リリース高',.15,'ft']];
    for(const point of timeline){const end=Date.parse(point.date+'T00:00:00Z'),split=new Date(end-(windowDays-1)*86400000).toISOString().slice(0,10),start=new Date(end-(2*windowDays-1)*86400000).toISOString().slice(0,10);
      const before=rows.filter(r=>r.game_date>=start&&r.game_date<split),after=rows.filter(r=>r.game_date>=split&&r.game_date<=point.date);
      for(const [key,label,threshold,unit] of specs){const a=before.filter(r=>finite(r[key])).map(r=>Number(r[key])),b=after.filter(r=>finite(r[key])).map(r=>Number(r[key]));if(a.length<30||b.length<30)continue;const delta=mean(b)-mean(a);if(Math.abs(delta)>=threshold)alerts.push({date:point.date,label,delta,unit,before:a.length,after:b.length});}
    }return alerts.slice(-25).reverse();
  }
  function csv(rows,fields){const quote=v=>'"'+String(v??'').replace(/^[=+@\t\r]/,"'").replaceAll('"','""')+'"';return '\uFEFF'+[fields.map(quote).join(','),...rows.map(r=>fields.map(k=>quote(r[k])).join(','))].join('\r\n');}
  const api={finite,matches,summary,heatmap,rolling,changes,csv};root.WorkbenchCore=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
