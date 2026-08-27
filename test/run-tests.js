#!/usr/bin/env node
/**
 * Tests for the calculation and parsing logic in Code.gs, run under node.
 *
 * How this works, and what it does and does not prove:
 *
 * Google Apps Script cannot be executed headless, so these tests load
 * Code.gs into a plain V8 context (node's vm module) with the Apps Script
 * services it touches (UrlFetchApp, CacheService, PropertiesService)
 * replaced by small mocks. The URL-fetch layer is mocked with fixture
 * files recorded from the real ParlayAPI endpoints (see
 * test/fixtures/README.md for what was captured and when).
 *
 * That means the pure logic (odds conversion, devig math consistency,
 * grid building, best-line selection, caching, error mapping) is genuinely
 * executed and asserted here. What is NOT covered: the Apps Script runtime
 * itself (custom function authorization, real CacheService semantics, the
 * menu UI). Smoke-test those by installing Code.gs in a real sheet and
 * running =PARLAY_STATUS() and =PARLAY_ODDS("nba").
 *
 * Run: node test/run-tests.js
 */

'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const fixturesDir = path.join(__dirname, 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(fixturesDir, name), 'utf8');

/* ------------------------------------------------------------------ */
/* Mock Apps Script services                                          */
/* ------------------------------------------------------------------ */

let fetchLog = [];       // {url, headers}
let routes = [];         // {match: substring, code, body}

function route(match, code, body) {
  routes.push({ match, code, body });
}

const mockUrlFetchApp = {
  fetch(url, options) {
    fetchLog.push({ url, headers: (options && options.headers) || {} });
    const r = routes.find((x) => url.includes(x.match));
    if (!r) throw new Error('mock: no route for ' + url);
    return {
      getResponseCode: () => r.code,
      getContentText: () => r.body,
    };
  },
};

function makeCache() {
  const store = new Map();
  return {
    get: (k) => (store.has(k) ? store.get(k) : null),
    put: (k, v, _ttl) => { store.set(k, v); },
    _store: store,
  };
}

function makeProps() {
  const store = new Map();
  return {
    getProperty: (k) => (store.has(k) ? store.get(k) : null),
    setProperty: (k, v) => { store.set(k, String(v)); },
    deleteProperty: (k) => { store.delete(k); },
  };
}

let scriptCache = makeCache();
let scriptProps = makeProps();

const context = {
  UrlFetchApp: mockUrlFetchApp,
  CacheService: { getScriptCache: () => scriptCache },
  PropertiesService: { getScriptProperties: () => scriptProps },
  // SpreadsheetApp is only used by menu functions, which are not under test.
  SpreadsheetApp: null,
  console,
};

vm.createContext(context);
const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
vm.runInContext(code, context, { filename: 'Code.gs' });

function resetWorld() {
  fetchLog = [];
  routes = [];
  scriptCache = makeCache();
  scriptProps = makeProps();
}

/* ------------------------------------------------------------------ */
/* Tiny test runner                                                   */
/* ------------------------------------------------------------------ */

let passed = 0;
let failed = 0;
function test(name, fn) {
  resetWorld();
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL ' + name);
    console.error('       ' + e.message);
  }
}

function assertThrowsMessage(fn, substr) {
  let threw = false;
  try { fn(); } catch (e) {
    threw = true;
    assert.ok(e.message.includes(substr),
      `expected error containing "${substr}", got "${e.message}"`);
  }
  assert.ok(threw, 'expected an error containing "' + substr + '" but nothing was thrown');
}

// Arrays built inside the vm context have a different Array prototype than
// the host realm, which trips assert.deepStrictEqual. Compare by value.
function assertSameJson(actual, expected) {
  assert.strictEqual(JSON.stringify(actual), JSON.stringify(expected));
}

/**
 * Independent re-implementation of "best h2h price for a team", used to
 * cross-check the grid code against whatever the recorded fixture holds.
 * (Sandbox prices are randomized per capture, so tests derive expectations
 * from the fixture instead of hardcoding prices.)
 */
function fixtureBest(events, teamSubstr) {
  let best = null;
  for (const ev of events) {
    for (const bk of ev.bookmakers || []) {
      for (const mk of bk.markets || []) {
        if (mk.key !== 'h2h') continue;
        for (const oc of mk.outcomes || []) {
          if (!String(oc.name).toLowerCase().includes(teamSubstr)) continue;
          if (!best || oc.price > best.price) {
            best = { price: oc.price, book: bk.title, name: oc.name };
          }
        }
      }
    }
  }
  return best;
}

/** Price a given book lists for a team in the fixture, or undefined. */
function fixturePrice(events, teamSubstr, bookKey) {
  for (const ev of events) {
    for (const bk of ev.bookmakers || []) {
      if (bk.key !== bookKey) continue;
      for (const mk of bk.markets || []) {
        if (mk.key !== 'h2h') continue;
        for (const oc of mk.outcomes || []) {
          if (String(oc.name).toLowerCase().includes(teamSubstr)) return oc.price;
        }
      }
    }
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/* 1. Pure odds math                                                  */
/* ------------------------------------------------------------------ */

console.log('odds math');

test('american to decimal: -110 -> 1.9091', () => {
  assert.ok(Math.abs(context.parlayAmericanToDecimal_(-110) - 1.90909) < 1e-4);
});

test('american to decimal: +150 -> 2.5', () => {
  assert.strictEqual(context.parlayAmericanToDecimal_(150), 2.5);
});

test('american to decimal: +100 -> 2.0 and -100 -> 2.0', () => {
  assert.strictEqual(context.parlayAmericanToDecimal_(100), 2);
  assert.strictEqual(context.parlayAmericanToDecimal_(-100), 2);
});

test('american to decimal rejects -50', () => {
  assertThrowsMessage(() => context.parlayAmericanToDecimal_(-50), 'not a valid American price');
});

test('decimal to american: 2.5 -> 150, 1.9091 -> -110', () => {
  assert.strictEqual(context.parlayDecimalToAmerican_(2.5), 150);
  assert.strictEqual(context.parlayDecimalToAmerican_(1.9091), -110);
});

test('round trip american -> decimal -> american for common prices', () => {
  [-500, -250, -110, -105, 100, 105, 120, 250, 900].forEach((a) => {
    const back = context.parlayDecimalToAmerican_(context.parlayAmericanToDecimal_(a));
    assert.strictEqual(back, a === -100 ? 100 : a, 'failed for ' + a);
  });
});

test('parlayToDecimalAny_ handles "+150", -110, 1.91', () => {
  assert.strictEqual(context.parlayToDecimalAny_('+150'), 2.5);
  assert.ok(Math.abs(context.parlayToDecimalAny_(-110) - 1.90909) < 1e-4);
  assert.strictEqual(context.parlayToDecimalAny_(1.91), 1.91);
});

test('parlayToDecimalAny_ rejects garbage and sub-1 decimals', () => {
  assertThrowsMessage(() => context.parlayToDecimalAny_('abc'), 'could not read odds');
  assertThrowsMessage(() => context.parlayToDecimalAny_(0.5), 'could not read odds');
});

/* ------------------------------------------------------------------ */
/* 2. Sport and market resolution                                     */
/* ------------------------------------------------------------------ */

console.log('aliases');

test('sport aliases resolve for live mode', () => {
  assert.strictEqual(context.parlayResolveSport_('nba', false), 'basketball_nba');
  assert.strictEqual(context.parlayResolveSport_('NFL', false), 'americanfootball_nfl');
  assert.strictEqual(context.parlayResolveSport_('epl', false), 'soccer_epl');
  assert.strictEqual(context.parlayResolveSport_('basketball_nba', false), 'basketball_nba');
});

test('sport aliases resolve for sandbox mode, epl maps to sandbox key', () => {
  assert.strictEqual(context.parlayResolveSport_('epl', true), 'soccer_england_premier_league');
  assert.strictEqual(context.parlayResolveSport_('nhl', true), 'icehockey_nhl');
});

test('sandbox mode rejects sports the sandbox does not carry, with key hint', () => {
  assertThrowsMessage(() => context.parlayResolveSport_('ncaaf', true), 'free API key');
});

test('market aliases: moneyline/ml -> h2h, spread -> spreads, ou -> totals', () => {
  assert.strictEqual(context.parlayResolveMarket_('moneyline'), 'h2h');
  assert.strictEqual(context.parlayResolveMarket_('ML'), 'h2h');
  assert.strictEqual(context.parlayResolveMarket_(''), 'h2h');
  assert.strictEqual(context.parlayResolveMarket_(undefined), 'h2h');
  assert.strictEqual(context.parlayResolveMarket_('spread'), 'spreads');
  assert.strictEqual(context.parlayResolveMarket_('o/u'), 'totals');
});

test('unknown market throws a friendly error', () => {
  assertThrowsMessage(() => context.parlayResolveMarket_('props'), 'unknown market');
});

/* ------------------------------------------------------------------ */
/* 3. Grid building from a recorded sandbox payload                   */
/* ------------------------------------------------------------------ */

console.log('odds grid');

const nbaEvents = JSON.parse(fixture('sandbox_odds_nba.json'));

test('grid has header with fixed columns then books, rows for every side', () => {
  const grid = context.parlayOddsGrid_(nbaEvents, 'h2h', true);
  assertSameJson(grid[0].slice(0, 5),
    ['Matchup [DEMO DATA]', 'Start (UTC)', 'Side', 'Best', 'Best Book']);
  assert.ok(grid[0].includes('Draftkings'));
  assert.ok(grid[0].includes('Pinnacle'));
  // 3 events x 2 sides = 6 data rows
  assert.strictEqual(grid.length, 1 + nbaEvents.length * 2);
});

test('best price and best book match an independent scan of the fixture', () => {
  const grid = context.parlayOddsGrid_(nbaEvents, 'h2h', true);
  const expected = fixtureBest(nbaEvents, 'lakers');
  const lakersRow = grid.find((r) => r[2] === expected.name);
  assert.ok(lakersRow, 'no Lakers row');
  assert.strictEqual(lakersRow[3], expected.price);
  assert.strictEqual(lakersRow[4], expected.book);
});

test('book columns carry each book\'s own price from the fixture', () => {
  const grid = context.parlayOddsGrid_(nbaEvents, 'h2h', true);
  const header = grid[0];
  const lakersRow = grid.find((r) => r[2] === 'Los Angeles Lakers');
  ['draftkings', 'fanduel', 'kalshi'].forEach((bookKey) => {
    const title = bookKey.charAt(0).toUpperCase() + bookKey.slice(1);
    const expected = fixturePrice(nbaEvents, 'lakers', bookKey);
    assert.ok(expected !== undefined, 'fixture lost book ' + bookKey);
    assert.strictEqual(lakersRow[header.indexOf(title)], expected, 'column ' + title);
  });
});

test('live mode header carries no DEMO tag', () => {
  const grid = context.parlayOddsGrid_(nbaEvents, 'h2h', false);
  assert.strictEqual(grid[0][0], 'Matchup');
});

test('empty market in demo mode explains the sandbox limitation', () => {
  assertThrowsMessage(() => context.parlayOddsGrid_(nbaEvents, 'spreads', true),
    'demo (sandbox) data covers moneyline only');
});

test('outcome labels include points when present', () => {
  const withPoints = [{
    home_team: 'A', away_team: 'B', commence_time: 't',
    bookmakers: [{
      key: 'dk', title: 'DK',
      markets: [{
        key: 'totals',
        outcomes: [
          { name: 'Over', price: -110, point: 221.5 },
          { name: 'Under', price: -110, point: 221.5 },
        ],
      }],
    }],
  }];
  const grid = context.parlayOddsGrid_(withPoints, 'totals', false);
  assert.strictEqual(grid[1][2], 'Over 221.5');
  assert.strictEqual(grid[2][2], 'Under 221.5');
});

/* ------------------------------------------------------------------ */
/* 4. Best line selection                                             */
/* ------------------------------------------------------------------ */

console.log('best line');

test('parlayBestRows_ finds the best Lakers price across books', () => {
  const rows = context.parlayBestRows_(nbaEvents, 'lakers', 'h2h');
  assert.strictEqual(rows.length, 1);
  const expected = fixtureBest(nbaEvents, 'lakers');
  const [side, price, book, matchup] = rows[0];
  assert.strictEqual(side, expected.name);
  assert.strictEqual(price, expected.price);
  assert.strictEqual(book, expected.book);
  assert.ok(matchup.includes('Boston Celtics @ Los Angeles Lakers'));
});

test('parlayBestRows_ match is case-insensitive substring', () => {
  const rows = context.parlayBestRows_(nbaEvents, 'CELTICS', 'h2h');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0][0], 'Boston Celtics');
});

test('parlayBestRows_ returns empty for unknown team', () => {
  assertSameJson(context.parlayBestRows_(nbaEvents, 'zzz', 'h2h'), []);
});

/* ------------------------------------------------------------------ */
/* 5. End-to-end custom functions with the fetch layer mocked         */
/* ------------------------------------------------------------------ */

console.log('custom functions over mocked fetch');

test('PARLAY_KELLY returns the API stake as a plain number', () => {
  route('/v1/calc/kelly', 200, fixture('calc_kelly.json'));
  const stake = context.PARLAY_KELLY(1000, -110, 0.55);
  assert.strictEqual(stake, 13.75);
  const call = fetchLog[0];
  assert.ok(call.url.includes('bankroll=1000'));
  assert.ok(call.url.includes('win_prob=0.55'));
  assert.ok(call.url.includes('fraction=0.25'), 'quarter Kelly default');
  assert.strictEqual(call.headers['X-API-Key'], undefined, 'calc endpoints never send a key');
});

test('PARLAY_KELLY details=TRUE returns a breakdown grid', () => {
  route('/v1/calc/kelly', 200, fixture('calc_kelly.json'));
  const grid = context.PARLAY_KELLY(1000, -110, 0.55, 0.25, true);
  assertSameJson(grid[0], ['Metric', 'Value']);
  assertSameJson(grid[1], ['Recommended stake (USD)', 13.75]);
  const flat = grid.map((r) => r.join('=')).join('|');
  assert.ok(flat.includes('Positive EV?=Yes'));
});

test('PARLAY_KELLY validates probability and bankroll before any fetch', () => {
  assertThrowsMessage(() => context.PARLAY_KELLY(1000, -110, 55), 'between 0 and 1');
  assertThrowsMessage(() => context.PARLAY_KELLY(-5, -110, 0.55), 'bankroll');
  assert.strictEqual(fetchLog.length, 0, 'no HTTP call should have happened');
});

test('PARLAY_DEVIG builds a consistent no-vig table from the recorded response', () => {
  route('/v1/calc/edge', 200, fixture('calc_edge_devig.json'));
  const grid = context.PARLAY_DEVIG(-108, -112);
  assertSameJson(grid[0], ['Side', 'Odds', 'Implied Prob', 'Fair Prob', 'Fair Odds (American)']);
  const [, , impliedA, fairA, fairAmerA] = grid[1];
  const [, , impliedB, fairB, fairAmerB] = grid[2];
  assert.strictEqual(fairA, 0.4957);       // from the recorded API response
  assert.strictEqual(fairAmerA, 102);      // from the recorded API response
  assert.strictEqual(fairB, 0.5043);       // 1 - fairA, proportional devig
  assert.ok(Math.abs(fairA + fairB - 1) < 1e-9, 'fair probs sum to 1');
  assert.ok(impliedA + impliedB > 1, 'implied probs overround (that is the vig)');
  assert.ok(fairAmerB < 0 && fairAmerB > -120, 'side B fair odds plausible: ' + fairAmerB);
  const hold = grid[3][2];
  assert.ok(Math.abs(hold - (impliedA + impliedB - 1)) < 1e-9, 'hold = overround - 1');
});

test('PARLAY_HEDGE returns the recorded breakdown', () => {
  route('/v1/calc/hedge', 200, fixture('calc_hedge.json'));
  const grid = context.PARLAY_HEDGE(100, '+250', -140);
  const flat = Object.fromEntries(grid.slice(1));
  assert.strictEqual(flat['Hedge stake (USD)'], 204.17);
  assert.strictEqual(flat['Guaranteed profit (USD)'], 45.83);
  assert.strictEqual(flat['True arbitrage?'], 'Yes');
});

test('PARLAY_FREEBET returns the recorded breakdown with conversion as a fraction', () => {
  route('/v1/calc/free-bet', 200, fixture('calc_free_bet.json'));
  const grid = context.PARLAY_FREEBET(50, '+300', -360);
  const flat = Object.fromEntries(grid.slice(1));
  assert.strictEqual(flat['Hedge stake (USD)'], 117.39);
  assert.strictEqual(flat['Guaranteed cash (USD)'], 32.61);
  assert.ok(Math.abs(flat['Conversion of face value'] - 0.6522) < 1e-9);
});

test('PARLAY_ODDS keyless goes to the sandbox and tags the header', () => {
  route('/v1/sandbox/sports/basketball_nba/odds', 200, fixture('sandbox_odds_nba.json'));
  const grid = context.PARLAY_ODDS('nba', 'moneyline');
  assert.strictEqual(grid[0][0], 'Matchup [DEMO DATA]');
  assert.ok(fetchLog[0].url.includes('/v1/sandbox/sports/basketball_nba/odds'));
  assert.strictEqual(fetchLog[0].headers['X-API-Key'], undefined);
});

test('PARLAY_ODDS with a stored key hits the live endpoint with the key header', () => {
  scriptProps.setProperty('PARLAY_API_KEY', 'test-key-123');
  route('/v1/sports/basketball_nba/odds', 200, fixture('sandbox_odds_nba.json'));
  const grid = context.PARLAY_ODDS('nba', 'moneyline');
  assert.strictEqual(grid[0][0], 'Matchup', 'no DEMO tag in live mode');
  assert.ok(fetchLog[0].url.includes('/v1/sports/basketball_nba/odds'));
  assert.ok(fetchLog[0].url.includes('regions=us'));
  assert.ok(fetchLog[0].url.includes('oddsFormat=american'));
  assert.strictEqual(fetchLog[0].headers['X-API-Key'], 'test-key-123');
});

test('PARLAY_BEST_LINE with explicit sport returns header plus match row', () => {
  route('/v1/sandbox/sports/basketball_nba/odds', 200, fixture('sandbox_odds_nba.json'));
  const grid = context.PARLAY_BEST_LINE('Lakers', 'nba');
  assertSameJson(grid[0],
    ['Side [DEMO DATA]', 'Best Price', 'Book', 'Matchup', 'Start (UTC)']);
  const expected = fixtureBest(nbaEvents, 'lakers');
  assert.strictEqual(grid[1][0], expected.name);
  assert.strictEqual(grid[1][1], expected.price);
  assert.strictEqual(grid[1][2], expected.book);
});

test('PARLAY_BEST_LINE without sport scans until it finds the team', () => {
  route('/v1/sandbox/sports/americanfootball_nfl/odds', 200, fixture('sandbox_odds_nfl_spreads.json'));
  route('/v1/sandbox/sports/basketball_nba/odds', 200, fixture('sandbox_odds_nba.json'));
  route('/v1/sandbox/sports/', 200, '[]'); // any other scanned sport: no events
  const grid = context.PARLAY_BEST_LINE('Warriors');
  assert.strictEqual(grid[1][0], 'Golden State Warriors');
});

test('PARLAY_BEST_LINE unknown team suggests passing the sport', () => {
  route('/v1/sandbox/sports/', 200, '[]');
  assertThrowsMessage(() => context.PARLAY_BEST_LINE('Springfield Isotopes', 'nba'),
    'Try passing the sport');
});

test('PARLAY_STATUS reports demo vs live', () => {
  assert.ok(context.PARLAY_STATUS().includes('DEMO mode'));
  scriptProps.setProperty('PARLAY_API_KEY', 'k');
  assert.ok(context.PARLAY_STATUS().includes('LIVE mode'));
});

/* ------------------------------------------------------------------ */
/* 6. Caching and error mapping                                       */
/* ------------------------------------------------------------------ */

console.log('caching and errors');

test('second identical call is served from cache: exactly one HTTP fetch', () => {
  route('/v1/calc/kelly', 200, fixture('calc_kelly.json'));
  context.PARLAY_KELLY(1000, -110, 0.55);
  context.PARLAY_KELLY(1000, -110, 0.55);
  context.PARLAY_KELLY(1000, -110, 0.55);
  assert.strictEqual(fetchLog.length, 1, 'expected 1 fetch, saw ' + fetchLog.length);
});

test('different arguments produce different cache entries', () => {
  route('/v1/calc/kelly', 200, fixture('calc_kelly.json'));
  context.PARLAY_KELLY(1000, -110, 0.55);
  context.PARLAY_KELLY(2000, -110, 0.55);
  assert.strictEqual(fetchLog.length, 2);
});

test('bumping the cache generation invalidates cached responses', () => {
  route('/v1/calc/kelly', 200, fixture('calc_kelly.json'));
  context.PARLAY_KELLY(1000, -110, 0.55);
  context.parlayBumpCacheGen_();
  context.PARLAY_KELLY(1000, -110, 0.55);
  assert.strictEqual(fetchLog.length, 2, 'generation bump should force a refetch');
});

test('oversized responses are not cached (100 KB CacheService limit)', () => {
  const bigEvents = JSON.stringify([{
    home_team: 'A', away_team: 'B', commence_time: 't',
    bookmakers: [{
      key: 'dk', title: 'x'.repeat(95000),
      markets: [{ key: 'h2h', outcomes: [{ name: 'A', price: -110 }, { name: 'B', price: 100 }] }],
    }],
  }]);
  route('/v1/sandbox/sports/basketball_nba/odds', 200, bigEvents);
  context.PARLAY_ODDS('nba');
  context.PARLAY_ODDS('nba');
  assert.strictEqual(fetchLog.length, 2, 'oversized body must bypass the cache');
  assert.strictEqual(scriptCache._store.size, 0);
});

test('401 responses surface the API message and mention the menu', () => {
  scriptProps.setProperty('PARLAY_API_KEY', 'bad-key');
  route('/v1/sports/basketball_nba/odds', 401,
    '{"detail":{"error":"INVALID_KEY","message":"API key not recognized","status":401}}');
  assertThrowsMessage(() => context.PARLAY_ODDS('nba'), 'INVALID_KEY: API key not recognized');
  assertThrowsMessage(() => context.PARLAY_ODDS('nba'), 'ParlayAPI menu');
});

test('429 responses point at usage and pricing pages', () => {
  scriptProps.setProperty('PARLAY_API_KEY', 'k');
  route('/v1/sports/basketball_nba/odds', 429,
    '{"error":"RATE_LIMITED","message":"Credit allowance exhausted"}');
  assertThrowsMessage(() => context.PARLAY_ODDS('nba'), 'Credit allowance exhausted');
  assertThrowsMessage(() => context.PARLAY_ODDS('nba'), '/pricing');
});

test('non-JSON error bodies fall back to the HTTP status', () => {
  route('/v1/calc/kelly', 500, '<html>oops</html>');
  assertThrowsMessage(() => context.PARLAY_KELLY(1000, -110, 0.55), 'HTTP 500');
});

/* ------------------------------------------------------------------ */

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);
