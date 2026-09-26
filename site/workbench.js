'use strict';
const form=document.querySelector('#filters'),message=document.querySelector('#message'),results=document.querySelector('#results');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,n=2)=>v==null?'—':Number(v).toLocaleString('ja-JP',{minimumFractionDigits:n,maximumFractionDigits:n});
const pct=v=>v==null?'—':num(v*100,1)+'%';
const datePlus=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
let manifest,worker,requestId=0,busy=false,lastFilters,lastResult;
const fields=['role','player','team','pitch','stand','throws','count','window','start','end','beforeStart','beforeEnd','heat'];
function conditions(){return Object.fromEntries(fields.map(k=>[k,form.elements[k].value]));}
function setPlayers(value=''){const role=form.elements.role.value;form.elements.player.innerHTML='<option value="">全選手</option>'+manifest.players[role].slice().sort((a,b)=>a.name.localeCompare(b.name)).map(p=>`<option value="${p.id}">${esc(p.name)} (${p.id})</option>`).join('');form.elements.player.value=value;}
function applyConditions(f){for(const k of fields)if(k!=='player'&&Object.hasOwn(f,k))form.elements[k].value=f[k];setPlayers(f.player||'');}
function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function invalidate(){document.querySelector('#exportCsv').disabled=true;if(lastResult)message.textContent='条件が変わりました。「分析する」で結果を更新してください。';}
function table(headers,rows){return `<div class="wb-scroll" tabindex="0" role="region" aria-label="左右にスクロールできる分析表"><table><thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>'<tr>'+row.map(x=>`<td>${x}</td>`).join('')+'</tr>').join('')}</tbody></table></div>`;}
function chart(series,keys,labels,decimals=2){
  const values=series.flatMap(r=>keys.map(k=>k.split('.').reduce((v,p)=>v?.[p],r))).filter(v=>v!=null&&Number.isFinite(v));
  if(!values.length)return '<p class="note">表示できる計測値がありません。</p>';
  let low=Math.min(...values),high=Math.max(...values);if(low===high){low-=.5;high+=.5;}const pad=(high-low)*.12;low-=pad;high+=pad;
  const first=Date.parse(series[0].date),span=Math.max(86400000,Date.parse(series.at(-1).date)-first);
  const x=r=>60+(Date.parse(r.date)-first)/span*610,y=v=>190-(v-low)/(high-low)*150;
  const colors=['#075c9c','#b33b2d'];
  let lines=keys.map((key,i)=>{let path='',pen=false;for(const r of series){const v=key.split('.').reduce((a,k)=>a?.[k],r);if(v==null){pen=false;continue;}path+=`${pen?'L':'M'}${x(r).toFixed(1)},${y(v).toFixed(1)} `;pen=true;}return `<path d="${path}" stroke="${colors[i]}" stroke-width="2.5" fill="none"/>`;}).join('');
  return `<div class="wb-trend-label">${labels.map(l=>`<span>${esc(l)}</span>`).join('')}</div><svg class="wb-chart" viewBox="0 0 710 235" role="img" aria-label="${esc(labels.join('と'))}の移動平均"><line x1="60" y1="190" x2="675" y2="190" stroke="#bbc7d1"/><text x="6" y="46" font-size="12">${num(high,decimals)}</text><text x="6" y="192" font-size="12">${num(low,decimals)}</text>${lines}<text x="60" y="219" font-size="12">${esc(series[0].date)}</text><text x="600" y="219" font-size="12">${esc(series.at(-1).date)}</text></svg>`;
}
function showResult(r,f){
  const a=r.current,b=r.before,diff=(key,n=2)=>a[key]==null||b[key]==null?'—':num(a[key]-b[key],n);
  const stats=[['pitches','球数',0],['pa','完了打席数',0],['games','試合数',0],['avg','AVG',3],['slg','SLG',3],['woba','wOBA',3],['velo','球速 mph',2],['ev','打球速度 mph',2],['pfx_x','横変化 ft',3],['pfx_z','縦変化 ft',3],['release_pos_x','リリース横 ft',3],['release_pos_z','リリース高 ft',3]];
  const player=manifest.players[f.role].find(p=>String(p.id)===f.player)?.name||'全選手';
  let html=`<section class="panel"><h2>${esc(player)}：AとBの比較</h2><p>A ${f.start}〜${f.end} / B ${f.beforeStart}〜${f.beforeEnd}</p><p class="note">${esc(f.role==='pitcher'?'投手':'打者')} · 球団 ${esc(f.team||'すべて')} · 球種 ${esc(f.pitch||'すべて')} · 打者 ${esc(f.stand||'左右')} / 投手 ${esc(f.throws||'左右')} · カウント ${esc(f.count||'すべて')}</p><div class="wb-kpis">${[['球数',a.pitches],['完了打席',a.pa],['打球',a.bbe],['スイング',a.swings]].map(([label,n])=>`<article>${label}<strong>${num(n,0)}</strong></article>`).join('')}</div>`;
  if(!a.pitches||!b.pitches)html+='<p class="wb-notice">データが0件の期間があります。該当なしと取得不足を区別するため、下の取得状況も確認してください。</p>';
  if(a.pa<30||a.pitches<100)html+='<p class="wb-notice">Aのサンプルが小さいため、率の上下を長期的な実力変化と断定しないでください。</p>';
  if(f.start<=f.beforeEnd&&f.end>=f.beforeStart)html+='<p class="wb-notice">A・Bの期間が重複しています。同じ投球が両方に含まれます。</p>';
  html+=table(['指標','A','B','A − B'],[...stats.map(([k,l,n])=>[l,num(a[k],n),num(b[k],n),diff(k,n)]),['Whiff%',pct(a.whiff),pct(b.whiff),a.whiff==null||b.whiff==null?'—':num((a.whiff-b.whiff)*100,1)+'pt']])+'</section>';
  html+='<section class="panel"><h2>結果と期待値：同一対象の比較</h2><p class="note">期待値のある打席だけで実測値も集計しています。上の全対象AVG・SLG・wOBAとは分母が異なります。</p>'+table(['指標','A 実測','A 期待','A 実測−期待','A 対象打席','B 実測','B 期待','B 対象打席'],[['expectedBA','AVG / xBA'],['expectedSLG','SLG / xSLG'],['expectedWOBA','wOBA / xwOBA']].map(([key,label])=>{const x=a[key],y=b[key];return[label,num(x.actual,3),num(x.expected,3),x.actual==null||x.expected==null?'—':num(x.actual-x.expected,3),num(x.n,0),num(y.actual,3),num(y.expected,3),num(y.n,0)];}))+'</section>';
  const mode=f.heat,cells=r.heat.bins.flat(),max=Math.max(1,...cells.map(c=>c.n));
  html+=`<section class="panel"><h2>コース別 ${mode==='usage'?'投球数':mode==='whiff'?'Whiff%':'Hard-hit%'}</h2><p>捕手視点：左 ← 横位置 → 右 / 上が高め</p><div class="wb-heat">${r.heat.bins.slice().reverse().flat().map(c=>{const rate=mode==='usage'?c.n/max:c.d>=5?c.n/c.d:0;return `<div class="wb-cell" style="background:rgba(66,153,207,${.08+rate*.65})"><b>${mode==='usage'?num(c.n,0):c.d>=5?pct(c.n/c.d):'—'}</b><small>${mode==='usage'?'球':`n=${c.d}`}</small></div>`}).join('')}</div><p class="note">表示範囲：横 −1.5〜1.5ft / 正規化高さ −0.5〜1.5。範囲内・位置計測あり ${num(r.heat.located,0)} / ${num(r.heat.total,0)}球。率の分母5未満は「—」。</p></section>`;
  html+=`<section class="panel"><h2>${f.window}日移動平均</h2><p class="note">Aの期間内で計算。データがない日は点を追加しません。球種・投手が混在すると構成の変化も含まれます。</p><div class="wb-grid">`;
  for(const [key,label,n] of [['velo','球速 mph',1],['pfx_x','横変化 ft',2],['pfx_z','縦変化 ft',2],['release_pos_x','リリース横 ft',2],['release_pos_z','リリース高 ft',2]])html+=`<article><h3>${label}</h3>${chart(r.series,[key],[label],n)}</article>`;
  for(const [key,label] of [['expectedBA','AVG / xBA'],['expectedSLG','SLG / xSLG'],['expectedWOBA','wOBA / xwOBA']])html+=`<article><h3>${label}</h3>${chart(r.series,[key+'.actual',key+'.expected'],['実測（同一対象）','期待値'],3)}</article>`;
  html+='</div><details><summary>移動平均の数値を見る</summary>'+table(['日付','球数','球速 mph','横変化 ft','縦変化 ft','リリース横 ft','リリース高 ft'],r.series.map(p=>[p.date,num(p.pitches,0),num(p.velo),num(p.pfx_x),num(p.pfx_z),num(p.release_pos_x),num(p.release_pos_z)]))+'</details></section>';
  html+='<section class="panel"><h2>変化の候補</h2>';
  if(f.role!=='pitcher'||!f.player||!f.pitch)html+='<p>投手を1人・球種を1つ選ぶと、球速・変化量・リリース位置の変化候補を表示します。</p>';
  else html+=r.alerts.length?'<p class="note">最新25件。隣り合う日には同じ変化が繰り返し出ることがあります。</p>'+table(['検出日','項目','直前期間からの差','前の計測球数','後の計測球数'],r.alerts.map(x=>[x.date,x.label,num(x.delta,2)+' '+x.unit,x.before,x.after])):'<p>指定した閾値を超える変化候補はありません（各期間30計測球未満は判定対象外）。</p>';
  html+='</section><section class="panel"><h2>サンプルと欠損率</h2><p class="note">投球項目は全対象球、打球・期待値項目はインプレー打球が分母です。対象が0件の場合、欠損率は算出しません。</p>'+table(['項目','A 計測数／対象数','A 欠損率','B 計測数／対象数','B 欠損率'],Object.entries(a.quality).map(([key,q])=>[esc(key),`${num(q.n,0)} / ${num(q.total,0)}`,pct(q.missing),`${num(b.quality[key].n,0)} / ${num(b.quality[key].total,0)}`,pct(b.quality[key].missing)]))+'</section>';
  results.innerHTML=html;
}
function createWorker(){worker=new Worker('workbench-worker.js?v=20260926a');worker.onmessage=({data})=>{if(data.id!==requestId)return;if(data.progress){message.textContent=data.progress;return;}busy=false;form.querySelectorAll('input,select').forEach(el=>el.disabled=false);form.querySelector('[type=submit]').disabled=false;if(data.error){message.textContent=data.error;return;}if(data.csv){download('statcast-'+lastFilters.start+'-'+lastFilters.end+'.csv',data.csv,'text/csv;charset=utf-8');message.textContent='CSVを保存しました。';return;}lastResult=data.result;showResult(data.result,lastFilters);message.textContent='分析完了。画面とCSVは実行時の条件に対応しています。';document.querySelector('#exportCsv').disabled=false;};worker.onerror=()=>{busy=false;form.querySelectorAll('input,select').forEach(el=>el.disabled=false);form.querySelector('[type=submit]').disabled=false;message.textContent='分析を完了できませんでした。期間を短くして再実行してください。';worker.terminate();createWorker();};}
function run(event){event?.preventDefault();if(busy||!form.reportValidity())return;const f=conditions();for(const [s,e] of [['start','end'],['beforeStart','beforeEnd']])if(f[s]>f[e]){message.textContent='開始日は終了日以前にしてください。';return;}lastFilters=f;lastResult=null;document.querySelector('#exportCsv').disabled=true;results.innerHTML='';busy=true;form.querySelectorAll('input,select').forEach(el=>el.disabled=true);form.querySelector('[type=submit]').disabled=true;message.textContent='分析を開始します…';worker.postMessage({id:++requestId,type:'analyze',filters:f,manifest});}
async function health(){
  const target=document.querySelector('#health'),age=Math.floor((Date.now()-Date.parse(manifest.end+'T00:00:00Z'))/86400000);
  let content=`<h2>データ更新・取得状況</h2><p>収録 ${manifest.start}〜${manifest.end} / ${num(manifest.rows,0)}球</p><p>分析ファイル生成：${esc(new Date(manifest.generated_at).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))}（日本時間）</p>`;
  if(age>3)content+=`<p class="wb-notice">最新収録日は${age}日前です。オフシーズンや休養日もあるため、下の日程との照合結果を確認してください。</p>`;
  try{const response=await fetch('data/schedule.json',{cache:'no-cache'});if(!response.ok)throw Error();const schedule=await response.json(),seen=new Set(manifest.shards.flatMap(s=>s.games)),eligible=Object.entries(schedule.dates).flatMap(([date,games])=>games.map(g=>({...g,date:g.official_date||date}))).filter(g=>g.status==='Final'&&g.date>=manifest.start&&g.date<=new Date().toISOString().slice(0,10)&&(g.game_type==='R'));
    const missing=[...new Map(eligible.filter(g=>!seen.has(g.game_pk)).map(g=>[g.game_pk,g])).values()];
    content+=`<p>日程更新：${esc(schedule.generated_at||'不明')} / 照合対象 ${eligible.length}試合 / 未収録 ${missing.length}試合</p>`;
    if(!eligible.length)content+='<p class="wb-notice">日程データに照合可能なレギュラーシーズン試合がありません。取得漏れを判定できません。</p>';
    if(missing.length)content+='<details><summary>未収録の試合を確認</summary>'+table(['試合日','対戦','試合ID'],missing.map(g=>[esc(g.date),esc((g.away?.name||'')+' vs '+(g.home?.name||'')),g.game_pk]))+'</details>';
  }catch{content+='<p class="wb-notice">日程との照合に失敗しました。取得漏れは未確認です。</p>';}
  if(manifest.unavailable_fields.length)content+='<p class="wb-notice">原本にない項目：'+esc(manifest.unavailable_fields.join(', '))+'</p>';
  target.innerHTML=content;
}
async function initWorkbench(){
  try{const response=await fetch('data/workbench/manifest.json',{cache:'no-cache'});if(!response.ok)throw Error('分析データを取得できませんでした。時間をおいて再読み込みしてください。');manifest=await response.json();if(manifest.version!==1)throw Error('ページを再読み込みしてください。');
    for(const [name,values] of [['team',manifest.teams],['pitch',manifest.pitch_types]])form.elements[name].innerHTML='<option value="">すべて</option>'+values.map(v=>`<option>${esc(v)}</option>`).join('');
    for(let balls=0;balls<=3;balls++)for(let strikes=0;strikes<=2;strikes++)form.elements.count.add(new Option(`${balls}-${strikes}`));
    const end=manifest.end,start=datePlus(end,-29);applyConditions({role:'pitcher',start:start<manifest.start?manifest.start:start,end,beforeStart:datePlus(start,-30),beforeEnd:datePlus(start,-1)});
    for(const name of ['start','end','beforeStart','beforeEnd']){form.elements[name].min=manifest.start;form.elements[name].max=manifest.end;if(form.elements[name].value<manifest.start)form.elements[name].value=manifest.start;}
    const params=new URLSearchParams(location.search);if(params.has('start'))applyConditions(Object.fromEntries(fields.filter(k=>params.has(k)).map(k=>[k,params.get(k)])));
    document.querySelector('#coverage').textContent=`収録：${manifest.start}〜${manifest.end}（レギュラーシーズン）。必要な月の投球データを読み込みます。`;
    form.hidden=false;form.onsubmit=run;form.onchange=event=>{if(event.target.name==='role')setPlayers();invalidate();};
    document.querySelector('#previous').onclick=()=>{const f=conditions();if(!f.start||!f.end||f.start>f.end)return;const days=Math.round((Date.parse(f.end)-Date.parse(f.start))/86400000)+1;form.elements.beforeEnd.value=datePlus(f.start,-1);form.elements.beforeStart.value=datePlus(f.start,-days);invalidate();};
    document.querySelector('#save').onclick=()=>{try{localStorage.setItem('mlb-workbench-v1',JSON.stringify(conditions()));message.textContent='この端末に分析条件を保存しました。';}catch{message.textContent='端末への保存が使えません。条件JSONまたはURLをご利用ください。';}};
    document.querySelector('#load').onclick=()=>{try{const saved=localStorage.getItem('mlb-workbench-v1');if(!saved){message.textContent='保存条件がありません。';return;}applyConditions(JSON.parse(saved));invalidate();message.textContent='条件を読み込みました。「分析する」で実行します。';}catch{message.textContent='保存条件を読み込めませんでした。';}};
    document.querySelector('#shareAnalysis').onclick=async()=>{const url=new URL(location.href);url.search=new URLSearchParams(conditions()).toString();history.replaceState(null,'',url);try{await navigator.clipboard.writeText(url.href);message.textContent='分析条件のURLをコピーしました。';}catch{message.textContent='アドレス欄のURLをコピーしてください。';}};
    document.querySelector('#exportConditions').onclick=()=>download('mlb-analysis-conditions.json',JSON.stringify({version:1,filters:conditions(),source:manifest.source,data_generated_at:manifest.generated_at,shards:manifest.shards.map(s=>({file:s.file,sha256:s.sha256}))},null,2),'application/json');
    document.querySelector('#exportCsv').onclick=()=>{if(!lastResult||busy)return;worker.postMessage({id:requestId,type:'csv'});message.textContent='CSVを作成中…';};
    createWorker();await health();run();
  }catch(error){message.textContent=error.message;document.querySelector('#coverage').textContent='データを読み込めませんでした。';}
}
initWorkbench();
