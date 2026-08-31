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
  const result = vm.runInContext(`(() => {
    LEAGUE = { pitchers: [] };
    const data = gameAnalysisData(feed);
    const html = renderGameAnalysis(feed, {});
    return {
      plays: data.plays.length,
      pitches: data.pitches.length,
      hits: data.hits.length,
      flow: data.flow.length,
      hasArsenal: html.includes('投手別・球種別の配球分析'),
      hasSprayMap: html.includes('打球方向マップ'),
      hasFatigue: html.includes('球速・疲労サイン'),
    };
  })()`, context);
  console.log(JSON.stringify(result));
  if (!result.plays || !result.pitches || !result.flow || !result.hasArsenal || !result.hasSprayMap || !result.hasFatigue) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
