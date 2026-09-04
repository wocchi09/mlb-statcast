const fs = require('fs');
const vm = require('vm');

async function main() {
  const gamePk = process.argv[2] || '823539';
  const response = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gamePk}/feed/live`);
  if (!response.ok) throw new Error(`MLB feed HTTP ${response.status}`);
  const feed = await response.json();
  const code = fs.readFileSync('site/app.js', 'utf8').replace(/init\(\);\s*$/, '');
  const element = { addEventListener() {}, classList: { toggle() {} } };
  const context = vm.createContext({
    console,
    URLSearchParams,
    location: { search: '' },
    document: {
      querySelector() { return element; },
      querySelectorAll() { return []; },
      addEventListener() {},
      documentElement: element,
    },
    MutationObserver: class { observe() {} },
    requestAnimationFrame(fn) { return fn(); },
    localStorage: { getItem() { return null; }, setItem() {} },
    history: { replaceState() {} },
    navigator: { clipboard: { writeText() {} } },
    getComputedStyle() { return { getPropertyValue() { return '#16202a'; } }; },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(code, context);
  context.feed = feed;
  const boxResponse = await fetch(`https://statsapi.mlb.com/api/v1/game/${gamePk}/boxscore`);
  if (!boxResponse.ok) throw new Error(`MLB boxscore HTTP ${boxResponse.status}`);
  context.box = await boxResponse.json();
  const result = vm.runInContext(`(() => {
    LEAGUE = { pitchers: [], standings: [] };
    SCHEDULE = { dates: {} };
    const match = renderMatchContent(feed, box);
    const sections = ['matchScore','startingLineups','boxScore','plateByPlate','extraAnalysis'];
    if (!sections.every((id, i) => match.includes('id="' + id + '"') && (!i || match.indexOf('id="' + id + '"') > match.indexOf('id="' + sections[i-1] + '"')))) throw Error('Match section order');
    for (const side of ['away','home']) {
      const starters = startingPlayers(box.teams[side]);
      if (starters.length !== 9) throw Error('Expected nine original starters: ' + side);
    }
    const zeroOut = { players: { p: { stats: { pitching: { outs: 0, numberOfPitches: 6 } } } } };
    if (boxRows(zeroOut,'pitching').length !== 1) throw Error('Zero-out pitcher excluded');
    const data = gameAnalysisData(feed);
    const html = renderGameAnalysis(feed, {});
    const advanced = renderAdvancedGameAnalysis(feed, box);
    return {
      plays: data.plays.length,
      pitches: data.pitches.length,
      hits: data.hits.length,
      flow: data.flow.length,
      hasArsenal: html.includes('投手別・球種別の配球分析'),
      hasSprayMap: html.includes('打球方向マップ'),
      hasFatigue: html.includes('球速・疲労サイン'),
      hasBatterPlan: advanced.includes('打者攻略・球種別弱点'),
      hasCountMix: advanced.includes('カウント別配球'),
      hasStuff: advanced.includes('Stuff・リリース安定性'),
      hasEnvironment: advanced.includes('球場・環境'),
      hasReport: advanced.includes('自動試合レポート'),
    };
  })()`, context);
  console.log(JSON.stringify(result));
  if (!result.plays || !result.pitches || !result.flow || !result.hasArsenal || !result.hasSprayMap || !result.hasFatigue || !result.hasBatterPlan || !result.hasCountMix || !result.hasStuff || !result.hasEnvironment || !result.hasReport) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
