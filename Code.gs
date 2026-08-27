/**
 * ParlayAPI for Google Sheets
 * ---------------------------------------------------------------
 * Custom functions that pull live sports odds and betting math
 * straight into Google Sheets. No coding required: copy this one
 * file into Extensions > Apps Script, save, and start typing
 * =PARLAY_ functions in your sheet.
 *
 * Functions:
 *   =PARLAY_ODDS(sport, market)            full odds board, books across columns
 *   =PARLAY_BEST_LINE(team, [sport])       best available price for a team
 *   =PARLAY_DEVIG(oddsA, oddsB)            remove the vig, get fair odds
 *   =PARLAY_KELLY(bankroll, odds, prob)    Kelly criterion stake sizing
 *   =PARLAY_HEDGE(stake, odds, hedgeOdds)  hedge calculator
 *   =PARLAY_FREEBET(amount, odds, hedgeOdds) free bet conversion
 *   =PARLAY_STATUS()                       shows demo vs live mode
 *
 * Without an API key the odds functions use the ParlayAPI sandbox
 * (synthetic demo data, clearly labeled). The calculator functions
 * (DEVIG, KELLY, HEDGE, FREEBET) hit keyless endpoints and never
 * use a key or spend credits.
 *
 * With a free API key (parlay-api.com, 1,000 credits a month, no
 * card required) the odds functions switch to real odds from 30+
 * sportsbooks. Store the key via the ParlayAPI menu in your sheet;
 * it lives in Script Properties and never appears in a cell.
 *
 * Project: https://github.com/JacobiusMakes/parlayapi-sheets
 * Maintained by the founder of ParlayAPI (parlay-api.com).
 * License: MIT
 */

/* eslint-disable no-var */

var PARLAY_BASE_ = 'https://parlay-api.com';
var PARLAY_CACHE_SECONDS_ = 60; // do not hammer the API from a sheet full of formulas
var PARLAY_CACHE_MAX_BYTES_ = 90000; // CacheService values cap at 100 KB; skip caching above this
var PARLAY_KEY_PROP_ = 'PARLAY_API_KEY';
var PARLAY_GEN_PROP_ = 'PARLAY_CACHE_GEN';
var PARLAY_SETTINGS_SHEET_ = 'ParlaySettings';
var PARLAY_VERSION_ = '1.0.0';

// Friendly names -> live API sport keys.
var PARLAY_SPORT_ALIASES_ = {
  nba: 'basketball_nba',
  wnba: 'basketball_wnba',
  ncaab: 'basketball_ncaab',
  nfl: 'americanfootball_nfl',
  ncaaf: 'americanfootball_ncaaf',
  cfl: 'americanfootball_cfl',
  mlb: 'baseball_mlb',
  nhl: 'icehockey_nhl',
  epl: 'soccer_epl',
  laliga: 'soccer_spain_la_liga',
  bundesliga: 'soccer_germany_bundesliga',
  seriea: 'soccer_italy_serie_a',
  ligue1: 'soccer_france_ligue_one',
  mls: 'soccer_usa_mls',
  atp: 'tennis_atp',
  wta: 'tennis_wta',
  mma: 'mma',
  ufc: 'mma_mixed_martial_arts',
  boxing: 'boxing'
};

// Live sport key -> sandbox sport key, for demo mode (no API key).
// The sandbox covers a small, stable set of sports with synthetic data.
var PARLAY_SANDBOX_MAP_ = {
  basketball_nba: 'basketball_nba',
  americanfootball_nfl: 'americanfootball_nfl',
  baseball_mlb: 'baseball_mlb',
  icehockey_nhl: 'icehockey_nhl',
  soccer_epl: 'soccer_england_premier_league',
  soccer_england_premier_league: 'soccer_england_premier_league',
  tennis: 'tennis',
  tennis_atp: 'tennis',
  tennis_wta: 'tennis'
};

var PARLAY_MARKET_ALIASES_ = {
  h2h: 'h2h',
  moneyline: 'h2h',
  ml: 'h2h',
  money: 'h2h',
  spreads: 'spreads',
  spread: 'spreads',
  ats: 'spreads',
  handicap: 'spreads',
  totals: 'totals',
  total: 'totals',
  ou: 'totals',
  'o/u': 'totals',
  overunder: 'totals'
};

// Sports scanned by PARLAY_BEST_LINE when no sport is given.
// Kept short on purpose: with a key each fresh scan of one sport costs 1 credit.
var PARLAY_SCAN_SPORTS_LIVE_ = [
  'americanfootball_nfl', 'basketball_nba', 'baseball_mlb', 'icehockey_nhl'
];
var PARLAY_SCAN_SPORTS_SANDBOX_ = [
  'americanfootball_nfl', 'basketball_nba', 'baseball_mlb', 'icehockey_nhl',
  'soccer_england_premier_league', 'tennis'
];

/* ================================================================
 * Pure math helpers (unit tested under node, see test/run-tests.js)
 * ================================================================ */

/**
 * American odds -> decimal odds. Throws on values between -100 and 100
 * (exclusive), which are not valid American prices.
 */
function parlayAmericanToDecimal_(a) {
  a = Number(a);
  if (!isFinite(a) || (a > -100 && a < 100)) {
    throw new Error('ParlayAPI: "' + a + '" is not a valid American price. Use -110, +150, etc.');
  }
  return a > 0 ? 1 + a / 100 : 1 + 100 / (-a);
}

/** Decimal odds -> American odds (rounded to nearest integer). */
function parlayDecimalToAmerican_(d) {
  d = Number(d);
  if (!isFinite(d) || d <= 1) {
    throw new Error('ParlayAPI: "' + d + '" is not a valid decimal price. Must be greater than 1.');
  }
  return d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1));
}

/**
 * Accepts American (-110, "+150") or decimal (1.91) input and returns
 * decimal odds. Values with absolute value >= 100 are treated as American,
 * matching how the ParlayAPI calc endpoints parse odds.
 */
function parlayToDecimalAny_(v) {
  var n = Number(String(v).replace('+', ''));
  if (!isFinite(n)) {
    throw new Error('ParlayAPI: could not read odds "' + v + '". Use American (-110, +150) or decimal (1.91).');
  }
  if (Math.abs(n) >= 100) return parlayAmericanToDecimal_(n);
  if (n > 1) return n;
  throw new Error('ParlayAPI: could not read odds "' + v + '". Use American (-110, +150) or decimal (1.91).');
}

/** Implied win probability of a price (any format). */
function parlayImpliedProb_(v) {
  return 1 / parlayToDecimalAny_(v);
}

/** Odds value normalized to a string the API accepts. */
function parlayOddsParam_(v) {
  parlayToDecimalAny_(v); // validate early with a friendly error
  return String(v).trim();
}

function parlayRound_(x, places) {
  var f = Math.pow(10, places);
  return Math.round(x * f) / f;
}

/** Resolve a user-typed sport into an API sport key. */
function parlayResolveSport_(input, sandbox) {
  if (input === null || input === undefined || String(input).trim() === '') {
    throw new Error('ParlayAPI: sport is required. Try "nba", "nfl", "mlb", "nhl", "epl" or a full key like basketball_nba.');
  }
  var s = String(input).trim().toLowerCase().replace(/[\s.-]+/g, '');
  var key = PARLAY_SPORT_ALIASES_[s] || String(input).trim().toLowerCase();
  if (!sandbox) return key;
  var sb = PARLAY_SANDBOX_MAP_[key];
  if (!sb) {
    throw new Error('ParlayAPI: demo mode covers nba, nfl, mlb, nhl, epl and tennis only. ' +
      'Set a free API key (ParlayAPI menu) for "' + input + '" and every other sport.');
  }
  return sb;
}

/** Resolve a user-typed market into an API market key. */
function parlayResolveMarket_(input) {
  if (input === null || input === undefined || String(input).trim() === '') return 'h2h';
  var m = String(input).trim().toLowerCase().replace(/[\s_-]+/g, '');
  var key = PARLAY_MARKET_ALIASES_[m];
  if (!key) {
    throw new Error('ParlayAPI: unknown market "' + input + '". Use "moneyline", "spreads" or "totals".');
  }
  return key;
}

/** Label for one outcome row, e.g. "Over 221.5" or "Boston Celtics -3.5". */
function parlayOutcomeLabel_(outcome) {
  var label = String(outcome.name);
  if (outcome.point !== undefined && outcome.point !== null) {
    var p = Number(outcome.point);
    if (outcome.name === 'Over' || outcome.name === 'Under' || p <= 0) {
      label += ' ' + p;
    } else {
      label += ' +' + p;
    }
  }
  return label;
}

/**
 * Build the line-shopping grid from an events payload.
 * Rows: one per event outcome. Columns: Matchup, Start, Side, Best,
 * Best Book, then one column per sportsbook.
 *
 * With American odds the numeric maximum is always the bettor-best
 * price (+150 beats -110, -105 beats -120), so Best is a simple max
 * and conditional formatting can use MAX() over the book columns.
 */
function parlayOddsGrid_(events, marketKey, demo) {
  var books = []; // [{key, title}] in order of first appearance
  var seenBook = {};
  var rows = [];

  events.forEach(function (ev) {
    var matchup = (ev.away_team && ev.home_team)
      ? ev.away_team + ' @ ' + ev.home_team
      : (ev.home_team || ev.away_team || ev.id || 'event');
    var start = ev.commence_time || '';
    var outcomeOrder = [];
    var priceByOutcome = {}; // label -> {bookKey: price}

    (ev.bookmakers || []).forEach(function (bk) {
      var market = null;
      (bk.markets || []).forEach(function (mk) {
        if (mk.key === marketKey) market = mk;
      });
      if (!market) return;
      if (!seenBook[bk.key]) {
        seenBook[bk.key] = true;
        books.push({ key: bk.key, title: bk.title || bk.key });
      }
      (market.outcomes || []).forEach(function (oc) {
        if (oc.price === undefined || oc.price === null) return;
        var label = parlayOutcomeLabel_(oc);
        if (!priceByOutcome[label]) {
          priceByOutcome[label] = {};
          outcomeOrder.push(label);
        }
        priceByOutcome[label][bk.key] = Number(oc.price);
      });
    });

    outcomeOrder.forEach(function (label) {
      rows.push({ matchup: matchup, start: start, label: label, prices: priceByOutcome[label] });
    });
  });

  if (rows.length === 0) {
    if (demo && marketKey !== 'h2h') {
      throw new Error('ParlayAPI: demo (sandbox) data covers moneyline only. ' +
        'Set a free API key via the ParlayAPI menu to pull spreads and totals.');
    }
    throw new Error('ParlayAPI: no ' + marketKey + ' odds returned for that sport right now.');
  }

  var header = ['Matchup' + (demo ? ' [DEMO DATA]' : ''), 'Start (UTC)', 'Side', 'Best', 'Best Book'];
  books.forEach(function (b) { header.push(b.title); });

  var grid = [header];
  rows.forEach(function (r) {
    var best = null;
    var bestBook = '';
    books.forEach(function (b) {
      var p = r.prices[b.key];
      if (p !== undefined && (best === null || p > best)) {
        best = p;
        bestBook = b.title;
      }
    });
    var row = [r.matchup, r.start, r.label, best === null ? '' : best, bestBook];
    books.forEach(function (b) {
      var p = r.prices[b.key];
      row.push(p === undefined ? '' : p);
    });
    grid.push(row);
  });
  return grid;
}

/**
 * Find the best available price for a team (case-insensitive substring
 * match on outcome names and team names) in an events payload.
 * Returns data rows: [side, best price, book, matchup, start].
 */
function parlayBestRows_(events, team, marketKey) {
  var t = String(team).trim().toLowerCase();
  var out = [];

  events.forEach(function (ev) {
    var matchup = (ev.away_team && ev.home_team)
      ? ev.away_team + ' @ ' + ev.home_team
      : (ev.home_team || ev.away_team || ev.id || 'event');
    var start = ev.commence_time || '';
    var bestByLabel = {}; // label -> {price, book}
    var order = [];

    (ev.bookmakers || []).forEach(function (bk) {
      (bk.markets || []).forEach(function (mk) {
        if (mk.key !== marketKey) return;
        (mk.outcomes || []).forEach(function (oc) {
          if (oc.price === undefined || oc.price === null) return;
          if (String(oc.name).toLowerCase().indexOf(t) === -1) return;
          var label = parlayOutcomeLabel_(oc);
          var p = Number(oc.price);
          if (!bestByLabel[label]) {
            bestByLabel[label] = { price: p, book: bk.title || bk.key };
            order.push(label);
          } else if (p > bestByLabel[label].price) {
            bestByLabel[label] = { price: p, book: bk.title || bk.key };
          }
        });
      });
    });

    order.forEach(function (label) {
      out.push([label, bestByLabel[label].price, bestByLabel[label].book, matchup, start]);
    });
  });
  return out;
}

/* ================================================================
 * Fetch layer: quota-aware caching over UrlFetchApp
 * ================================================================ */

/** Read the stored API key, or null when running keyless. */
function parlayGetKey_() {
  try {
    var k = PropertiesService.getScriptProperties().getProperty(PARLAY_KEY_PROP_);
    return k && String(k).trim() ? String(k).trim() : null;
  } catch (e) {
    return null;
  }
}

/** Small deterministic string hash (djb2 x2) so cache keys stay under limits. */
function parlayHash_(s) {
  var h1 = 5381;
  var h2 = 52711;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return h1.toString(36) + h2.toString(36) + s.length.toString(36);
}

function parlayCacheKey_(url, keyed) {
  var gen = '0';
  try {
    gen = PropertiesService.getScriptProperties().getProperty(PARLAY_GEN_PROP_) || '0';
  } catch (e) { /* run cacheless */ }
  return 'pav1:' + gen + ':' + (keyed ? 'k' : 'a') + ':' + parlayHash_(url);
}

/**
 * GET a ParlayAPI path and return parsed JSON.
 * Responses are cached for PARLAY_CACHE_SECONDS_ so a sheet full of
 * formulas recalculating at once produces one real HTTP request per
 * distinct URL per minute instead of hundreds. This protects both your
 * ParlayAPI credit allowance and the Apps Script UrlFetch daily quota.
 *
 * withKey=true attaches the stored key (X-API-Key header) when present.
 * Calculator endpoints are always called with withKey=false: they are
 * keyless and free, and this guarantees they can never spend credits.
 */
function parlayFetchJson_(path, withKey) {
  var url = PARLAY_BASE_ + path;
  var key = withKey ? parlayGetKey_() : null;
  var cacheKey = parlayCacheKey_(url, !!key);
  var cache = null;

  try {
    cache = CacheService.getScriptCache();
    var hit = cache.get(cacheKey);
    if (hit) return JSON.parse(hit);
  } catch (e) {
    cache = null; // cache unavailable; carry on with a real fetch
  }

  var options = { muteHttpExceptions: true, headers: {} };
  if (key) options.headers['X-API-Key'] = key;

  var resp;
  try {
    resp = UrlFetchApp.fetch(url, options);
  } catch (e) {
    throw new Error('ParlayAPI: network error calling ' + path + ' (' + e.message + '). ' +
      'If this mentions a urlfetch quota, see TROUBLESHOOTING.md in the project repo.');
  }

  var code = resp.getResponseCode();
  var body = resp.getContentText();

  if (code < 200 || code >= 300) {
    var msg = 'HTTP ' + code;
    try {
      var j = JSON.parse(body);
      var e2 = j.detail || j;
      msg = (e2.error ? e2.error + ': ' : '') + (e2.message || msg);
    } catch (ignore) { /* keep generic message */ }
    if (code === 401) {
      msg += ' (open the ParlayAPI menu and use "Set API key", or clear the bad key to fall back to demo data)';
    }
    if (code === 402 || code === 429) {
      msg += ' (check your allowance at ' + PARLAY_BASE_ + '/v1/usage and the plans at ' + PARLAY_BASE_ + '/pricing)';
    }
    throw new Error('ParlayAPI: ' + msg);
  }

  if (cache && body.length <= PARLAY_CACHE_MAX_BYTES_) {
    try {
      cache.put(cacheKey, body, PARLAY_CACHE_SECONDS_);
    } catch (e) { /* value too large or cache busy; fine */ }
  }
  return JSON.parse(body);
}

/** Fetch the odds payload for a sport, live when a key is set, sandbox otherwise. */
function parlayFetchOdds_(sportInput, marketKey) {
  var keyed = !!parlayGetKey_();
  if (keyed) {
    var liveKey = parlayResolveSport_(sportInput, false);
    return {
      demo: false,
      events: parlayFetchJson_('/v1/sports/' + encodeURIComponent(liveKey) +
        '/odds?regions=us&markets=' + encodeURIComponent(marketKey) + '&oddsFormat=american', true)
    };
  }
  var sbKey = parlayResolveSport_(sportInput, true);
  return {
    demo: true,
    events: parlayFetchJson_('/v1/sandbox/sports/' + encodeURIComponent(sbKey) +
      '/odds?markets=' + encodeURIComponent(marketKey) + '&oddsFormat=american', false)
  };
}

/* ================================================================
 * Custom functions (what you type in a cell)
 * ================================================================ */

/**
 * Full odds board for a sport: one row per side of each game, books
 * across the columns, with Best price and Best Book computed for you.
 *
 * @param {string} sport Sport, e.g. "nba", "nfl", "mlb", "nhl", "epl" or a full key like basketball_nba.
 * @param {string} market Optional. "moneyline" (default), "spreads" or "totals".
 * @param {*} refresh Optional. Point this at ParlaySettings!$B$1 so the menu item "Refresh now" recalculates the board.
 * @return {Array<Array>} A table that spills down and right from the formula cell.
 * @customfunction
 */
function PARLAY_ODDS(sport, market, refresh) {
  var marketKey = parlayResolveMarket_(market);
  var res = parlayFetchOdds_(sport, marketKey);
  return parlayOddsGrid_(res.events, marketKey, res.demo);
}

/**
 * Best available price for a team across every book we carry.
 *
 * @param {string} team Team name or part of it, e.g. "Lakers".
 * @param {string} sport Optional but recommended. e.g. "nba". Without it the major US sports are scanned, which uses more credits.
 * @param {string} market Optional. "moneyline" (default), "spreads" or "totals".
 * @param {*} refresh Optional. Point this at ParlaySettings!$B$1 to make "Refresh now" recalculate.
 * @return {Array<Array>} Header row plus one row per matching side: Side, Best Price, Book, Matchup, Start.
 * @customfunction
 */
function PARLAY_BEST_LINE(team, sport, market, refresh) {
  if (team === null || team === undefined || String(team).trim() === '') {
    throw new Error('ParlayAPI: give me a team, e.g. =PARLAY_BEST_LINE("Lakers", "nba")');
  }
  var marketKey = parlayResolveMarket_(market);
  var demo = !parlayGetKey_();
  var header = [['Side' + (demo ? ' [DEMO DATA]' : ''), 'Best Price', 'Book', 'Matchup', 'Start (UTC)']];

  var sportsToScan;
  if (sport !== null && sport !== undefined && String(sport).trim() !== '') {
    sportsToScan = [String(sport)];
  } else {
    sportsToScan = demo ? PARLAY_SCAN_SPORTS_SANDBOX_ : PARLAY_SCAN_SPORTS_LIVE_;
  }

  for (var i = 0; i < sportsToScan.length; i++) {
    var res;
    try {
      res = parlayFetchOdds_(sportsToScan[i], marketKey);
    } catch (e) {
      if (sportsToScan.length === 1) throw e;
      continue; // scanning: skip sports that error and keep looking
    }
    var rows = parlayBestRows_(res.events, team, marketKey);
    if (rows.length > 0) return header.concat(rows);
  }
  throw new Error('ParlayAPI: no upcoming ' + marketKey + ' line found for "' + team + '". ' +
    'Try passing the sport, e.g. =PARLAY_BEST_LINE("' + team + '", "nba"), and check the spelling.');
}

/**
 * Remove the vig from a two-sided market and get the fair (no-vig)
 * probabilities and fair odds. Give it both sides of the same market,
 * ideally from a sharp book.
 *
 * Uses the keyless ParlayAPI calculator endpoint: free, no key, no credits.
 *
 * @param {*} oddsA Price on side A, American (-110, "+150") or decimal (1.91).
 * @param {*} oddsB Price on side B of the same market.
 * @return {Array<Array>} Table: implied prob, fair prob and fair odds for each side, plus the hold.
 * @customfunction
 */
function PARLAY_DEVIG(oddsA, oddsB) {
  var a = parlayOddsParam_(oddsA);
  var b = parlayOddsParam_(oddsB);
  var r = parlayFetchJson_('/v1/calc/edge?odds=' + encodeURIComponent(a) +
    '&sharp_over_odds=' + encodeURIComponent(a) +
    '&sharp_under_odds=' + encodeURIComponent(b), false);

  var impliedA = (r.odds_implied_prob !== undefined) ? r.odds_implied_prob : parlayRound_(parlayImpliedProb_(a), 4);
  var impliedB = parlayRound_(parlayImpliedProb_(b), 4);
  var fairA = r.fair_prob;
  var fairB = parlayRound_(1 - fairA, 4);
  var fairAmerA = r.fair_american;
  var fairAmerB = parlayDecimalToAmerican_(1 / fairB);
  var hold = parlayRound_(impliedA + impliedB - 1, 4);

  return [
    ['Side', 'Odds', 'Implied Prob', 'Fair Prob', 'Fair Odds (American)'],
    ['A', String(oddsA), impliedA, fairA, fairAmerA],
    ['B', String(oddsB), impliedB, fairB, fairAmerB],
    ['Hold (vig)', '', hold, '', '']
  ];
}

/**
 * Kelly criterion stake for a bet, given your bankroll, the price and
 * your estimated win probability. Returns the recommended stake in
 * dollars. Defaults to quarter Kelly (fraction 0.25), which is the
 * sane setting for noisy win-prob estimates.
 *
 * Uses the keyless ParlayAPI calculator endpoint: free, no key, no credits.
 *
 * @param {number} bankroll Your total bankroll in dollars, e.g. 1000.
 * @param {*} odds The price, American (-110, "+150") or decimal (1.91).
 * @param {number} prob Your estimated win probability between 0 and 1 (55% = 0.55).
 * @param {number} fraction Optional Kelly multiplier, default 0.25. Use 1 for full Kelly (high variance).
 * @param {boolean} details Optional. TRUE returns a full breakdown table instead of a single number.
 * @return {number|Array<Array>} Recommended stake in dollars, or a breakdown table when details is TRUE.
 * @customfunction
 */
function PARLAY_KELLY(bankroll, odds, prob, fraction, details) {
  var bk = Number(bankroll);
  if (!isFinite(bk) || bk <= 0) {
    throw new Error('ParlayAPI: bankroll must be a positive number of dollars, e.g. 1000.');
  }
  var p = Number(prob);
  if (!isFinite(p) || p <= 0 || p >= 1) {
    throw new Error('ParlayAPI: win probability must be between 0 and 1. For 55% enter 0.55.');
  }
  var o = parlayOddsParam_(odds);
  var f = (fraction === null || fraction === undefined || fraction === '') ? 0.25 : Number(fraction);
  if (!isFinite(f) || f <= 0 || f > 1) {
    throw new Error('ParlayAPI: fraction must be between 0 and 1 (0.25 = quarter Kelly).');
  }

  var r = parlayFetchJson_('/v1/calc/kelly?bankroll=' + encodeURIComponent(bk) +
    '&odds=' + encodeURIComponent(o) +
    '&win_prob=' + encodeURIComponent(p) +
    '&fraction=' + encodeURIComponent(f), false);

  if (!details) return r.kelly_stake_usd;

  return [
    ['Metric', 'Value'],
    ['Recommended stake (USD)', r.kelly_stake_usd],
    ['Kelly multiplier used', r.kelly_fraction_multiplier],
    ['Full Kelly (share of bankroll)', r.kelly_fraction_full],
    ['Implied prob at this price', r.implied_prob],
    ['Your edge vs implied', r.edge_vs_implied],
    ['Expected value of stake (USD)', r.expected_value_usd],
    ['Positive EV?', r.is_plus_ev ? 'Yes' : 'No']
  ];
}

/**
 * Hedge calculator: you already have a bet on, the other side is now
 * available at some price, how much do you put on it and what does
 * that lock in?
 *
 * Uses the keyless ParlayAPI calculator endpoint: free, no key, no credits.
 *
 * @param {number} originalStake Dollars already staked on the original bet.
 * @param {*} originalOdds The price you took, American or decimal.
 * @param {*} hedgeOdds The price now available on the other side.
 * @param {string} target Optional. "equal_profit" (default), "guaranteed_minimum" or "free_roll".
 * @return {Array<Array>} Breakdown table with the hedge stake and locked-in outcomes.
 * @customfunction
 */
function PARLAY_HEDGE(originalStake, originalOdds, hedgeOdds, target) {
  var stake = Number(originalStake);
  if (!isFinite(stake) || stake <= 0) {
    throw new Error('ParlayAPI: original stake must be a positive number of dollars.');
  }
  var o1 = parlayOddsParam_(originalOdds);
  var o2 = parlayOddsParam_(hedgeOdds);
  var t = (target === null || target === undefined || String(target).trim() === '')
    ? 'equal_profit' : String(target).trim().toLowerCase();

  var r = parlayFetchJson_('/v1/calc/hedge?original_stake=' + encodeURIComponent(stake) +
    '&original_odds=' + encodeURIComponent(o1) +
    '&hedge_odds=' + encodeURIComponent(o2) +
    '&target=' + encodeURIComponent(t), false);

  return [
    ['Metric', 'Value'],
    ['Hedge stake (USD)', r.hedge_stake_usd],
    ['Guaranteed profit (USD)', r.guaranteed_profit_usd],
    ['Profit if original bet wins', r.profit_if_original_wins],
    ['Profit if hedge wins', r.profit_if_hedge_wins],
    ['Total staked (USD)', r.total_stake_usd],
    ['True arbitrage?', r.is_arb ? 'Yes' : 'No']
  ];
}

/**
 * Free bet conversion: how to hedge a free bet into guaranteed cash,
 * and what share of the face value you keep.
 *
 * Uses the keyless ParlayAPI calculator endpoint: free, no key, no credits.
 *
 * @param {number} freeBetAmount Face value of the free bet in dollars.
 * @param {*} betOdds The price you would take with the free bet (higher converts better).
 * @param {*} hedgeOdds The price on the other side at a different book.
 * @return {Array<Array>} Breakdown table with the hedge stake, guaranteed cash and conversion rate.
 * @customfunction
 */
function PARLAY_FREEBET(freeBetAmount, betOdds, hedgeOdds) {
  var amt = Number(freeBetAmount);
  if (!isFinite(amt) || amt <= 0) {
    throw new Error('ParlayAPI: free bet amount must be a positive number of dollars.');
  }
  var o1 = parlayOddsParam_(betOdds);
  var o2 = parlayOddsParam_(hedgeOdds);

  var r = parlayFetchJson_('/v1/calc/free-bet?free_bet_usd=' + encodeURIComponent(amt) +
    '&bet_odds=' + encodeURIComponent(o1) +
    '&hedge_odds=' + encodeURIComponent(o2), false);

  return [
    ['Metric', 'Value'],
    ['Hedge stake (USD)', r.hedge_stake_usd],
    ['Guaranteed cash (USD)', r.guaranteed_cash_usd],
    ['Conversion of face value', r.conversion_pct / 100],
    ['Profit if free bet wins', r.profit_if_free_bet_wins],
    ['Profit if hedge wins', r.profit_if_hedge_wins]
  ];
}

/**
 * Shows whether the sheet is in demo mode or live mode.
 *
 * @return {string} A one-line status message.
 * @customfunction
 */
function PARLAY_STATUS() {
  if (parlayGetKey_()) {
    return 'LIVE mode: API key set. Odds functions pull real odds from parlay-api.com. ' +
      'Calculator functions stay keyless and free. Kit v' + PARLAY_VERSION_ + '.';
  }
  return 'DEMO mode: no API key set. Odds functions return synthetic sandbox data (clearly labeled). ' +
    'Get a free key at parlay-api.com (1,000 credits a month, no card) and add it via the ParlayAPI menu. ' +
    'Kit v' + PARLAY_VERSION_ + '.';
}

/* ================================================================
 * Menu: key setup, connection test, refresh
 * The API key lives in Script Properties, never in a cell.
 * ================================================================ */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ParlayAPI')
    .addItem('Set API key...', 'parlayMenuSetKey')
    .addItem('Test connection', 'parlayMenuTestConnection')
    .addItem('Refresh now', 'parlayMenuRefreshNow')
    .addItem('Clear API key', 'parlayMenuClearKey')
    .addItem('Help', 'parlayMenuHelp')
    .addToUi();
}

function parlayMenuSetKey() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt('ParlayAPI key',
    'Paste your API key from parlay-api.com. It is stored in this script\'s ' +
    'Script Properties, never in a cell. Free tier: 1,000 credits a month, no card required.',
    ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;
  var key = String(resp.getResponseText() || '').trim();
  if (!key) {
    ui.alert('ParlayAPI', 'No key entered. Nothing was changed.', ui.ButtonSet.OK);
    return;
  }
  PropertiesService.getScriptProperties().setProperty(PARLAY_KEY_PROP_, key);
  parlayBumpCacheGen_();
  ui.alert('ParlayAPI', 'Key saved. Odds functions now use live data. ' +
    'Run "Refresh now" or edit a formula input to recalculate existing boards.', ui.ButtonSet.OK);
}

function parlayMenuClearKey() {
  PropertiesService.getScriptProperties().deleteProperty(PARLAY_KEY_PROP_);
  parlayBumpCacheGen_();
  SpreadsheetApp.getUi().alert('ParlayAPI',
    'Key removed. Odds functions are back on demo (sandbox) data.',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function parlayMenuTestConnection() {
  var ui = SpreadsheetApp.getUi();
  var msg;
  try {
    if (parlayGetKey_()) {
      var sports = parlayFetchJson_('/v1/sports', true);
      msg = 'Key works. ' + (sports.length || 'Many') + ' sports available in live mode.';
    } else {
      parlayFetchJson_('/v1/sandbox/sports', false);
      msg = 'No key set: demo mode is reachable and working. ' +
        'Use "Set API key..." to switch odds functions to live data.';
    }
  } catch (e) {
    msg = 'Problem: ' + e.message + '\n\nSee TROUBLESHOOTING.md in the project repo.';
  }
  ui.alert('ParlayAPI connection test', msg, ui.ButtonSet.OK);
}

/**
 * Invalidates the response cache and writes a fresh timestamp into
 * ParlaySettings!B1. Any formula whose optional refresh argument points
 * at that cell recalculates immediately with fresh data.
 */
function parlayMenuRefreshNow() {
  parlayBumpCacheGen_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PARLAY_SETTINGS_SHEET_);
  if (!sheet) {
    sheet = ss.insertSheet(PARLAY_SETTINGS_SHEET_);
    sheet.getRange('A1').setValue('Last refresh (point the optional refresh argument of PARLAY_ functions at cell B1)');
  }
  sheet.getRange('B1').setValue(new Date());
  ss.toast('Cache cleared. Formulas pointing at ' + PARLAY_SETTINGS_SHEET_ + '!B1 are recalculating.', 'ParlayAPI', 5);
}

function parlayMenuHelp() {
  SpreadsheetApp.getUi().alert('ParlayAPI for Sheets v' + PARLAY_VERSION_,
    'Try these in any cell:\n\n' +
    '=PARLAY_ODDS("nba", "moneyline")\n' +
    '=PARLAY_BEST_LINE("Lakers", "nba")\n' +
    '=PARLAY_DEVIG(-108, -112)\n' +
    '=PARLAY_KELLY(1000, -110, 0.55)\n' +
    '=PARLAY_STATUS()\n\n' +
    'Docs and template: github.com/JacobiusMakes/parlayapi-sheets\n' +
    'API docs: parlay-api.com/docs',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

/** Bump the cache generation so every cached response is orphaned. */
function parlayBumpCacheGen_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var gen = Number(props.getProperty(PARLAY_GEN_PROP_) || '0');
    props.setProperty(PARLAY_GEN_PROP_, String(gen + 1));
  } catch (e) { /* cache just stays warm for up to 60 seconds */ }
}
