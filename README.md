# ParlayAPI for Google Sheets

Live sports odds, line shopping, devig math and Kelly staking in plain Google Sheets formulas. No Python, no terminal, no code. You copy one file into your sheet and type things like:

```
=PARLAY_ODDS("nba", "moneyline")
=PARLAY_BEST_LINE("Lakers", "nba")
=PARLAY_DEVIG(-108, -112)
=PARLAY_KELLY(1000, -110, 0.55)
```

Powered by [ParlayAPI](https://parlay-api.com), a real-time sports odds API covering 30+ sportsbooks. Works out of the box with no account at all (demo data plus the free calculators). With a free API key (1,000 credits a month, no card required) the odds functions switch to real live odds.

**Disclosure:** this kit is built and maintained by the founder of ParlayAPI. It is free and MIT licensed; the API it talks to has a free tier and paid tiers (see [pricing](https://parlay-api.com/pricing)). Nothing here is betting advice.

---

## Install (about 2 minutes)

1. Open any Google Sheet (or make a new one at [sheets.new](https://sheets.new)).
2. In the menu bar click **Extensions > Apps Script**. A code editor opens in a new tab.
3. Delete the placeholder code in the editor (the empty `function myFunction() {}`).
4. Copy the entire contents of [`Code.gs`](Code.gs) from this repo and paste it into the editor.
5. Click the floppy-disk **Save** icon (or press Ctrl+S / Cmd+S).
6. Go back to your sheet tab and reload the page once.

That's it. Type `=PARLAY_STATUS()` in any cell. You should see a message confirming the kit is installed and running in demo mode.

The first time you use the **ParlayAPI menu** (see below), Google will ask you to authorize the script. It runs entirely inside your own Google account against your own sheet; the code is all in this repo where you can read every line.

## Try it (no account needed)

These work immediately, with no key:

| Type this | You get |
|---|---|
| `=PARLAY_STATUS()` | Confirms install, shows demo vs live mode |
| `=PARLAY_ODDS("nba")` | A full odds board (demo data until you add a key) |
| `=PARLAY_DEVIG(-108, -112)` | Fair no-vig probabilities and fair odds for a two-sided market |
| `=PARLAY_KELLY(1000, -110, 0.55)` | Recommended stake from a $1,000 bankroll at -110 with a 55% win estimate |
| `=PARLAY_HEDGE(100, "+250", -140)` | How much to hedge and what profit that locks in |
| `=PARLAY_FREEBET(50, "+300", -360)` | How to convert a $50 free bet into guaranteed cash |

The calculator functions (`DEVIG`, `KELLY`, `HEDGE`, `FREEBET`) call keyless ParlayAPI endpoints. They are free, never use your key, and never spend credits, whether or not you set one.

Without a key, the odds functions (`PARLAY_ODDS`, `PARLAY_BEST_LINE`) return **synthetic sandbox data** so you can build and test your sheet. Demo output is clearly labeled `[DEMO DATA]` in the header, and the demo covers a small set of sports (nba, nfl, mlb, nhl, epl, tennis) with moneyline only. Do not bet off demo numbers; they are fake by design.

## Go live (free key, no card)

1. Get a free API key at [parlay-api.com](https://parlay-api.com). The free tier is 1,000 credits a month and does not ask for a card.
2. In your sheet, open the **ParlayAPI** menu (appears in the menu bar after install; reload the sheet if you don't see it) and click **Set API key...**.
3. Paste the key and hit OK. Run **ParlayAPI > Test connection** to confirm.

Your key is stored in the script's Script Properties. It is never written into a cell, so it won't show up in the grid, in exports, or in printouts. One honest caveat: anyone you give **edit** access to the spreadsheet can open Extensions > Apps Script and see Script Properties. Share view-only copies, or share a separate sheet that IMPORTRANGEs your board, if the key must stay private.

## Function reference

### `=PARLAY_ODDS(sport, [market], [refresh])`

Spills a full line-shopping board: one row per side of each upcoming game, one column per sportsbook, plus computed **Best** price and **Best Book** columns.

- `sport`: `"nba"`, `"nfl"`, `"mlb"`, `"nhl"`, `"epl"`, `"ncaaf"`, `"wnba"`, `"mls"`, `"atp"`, `"wta"`, `"ufc"` and more, or any full ParlayAPI sport key like `"basketball_nba"`.
- `market` (optional): `"moneyline"` (default), `"spreads"` or `"totals"`. Spreads and totals rows are labeled with their line (for example `Over 221.5`); books are only filled in on rows whose exact line they offer.
- `refresh` (optional): point it at `ParlaySettings!$B$1` and the **ParlayAPI > Refresh now** menu item will recalculate the board on demand.

Prices are American odds. A bigger number is always the better price for you (+150 beats +120, -105 beats -120), so the Best column is a simple maximum and conditional formatting stays easy.

### `=PARLAY_BEST_LINE(team, [sport], [market], [refresh])`

Returns a small table with the best available price for a team: Side, Best Price, Book, Matchup, Start time. `team` is a case-insensitive partial match ("lakers" works).

Passing `sport` is strongly recommended. If you omit it, the kit scans NFL, NBA, MLB and NHL in order until it finds the team, and in live mode each scanned sport costs a credit when the data isn't already cached.

### `=PARLAY_DEVIG(oddsA, oddsB)`

Give it both sides of the same market (ideally from a sharp book) and it removes the vig using ParlayAPI's no-vig calculator. Returns a table with implied probability, fair probability and fair American odds for each side, plus the hold. Format the probability cells as percentages and they read naturally.

Odds can be American (`-110`, `"+150"`) or decimal (`1.91`) in every function.

### `=PARLAY_KELLY(bankroll, odds, prob, [fraction], [details])`

Kelly criterion stake sizing. Returns the recommended stake in dollars as a single number, so you can reference it in other formulas. `prob` is your estimated win probability between 0 and 1 (55% = `0.55`). `fraction` defaults to 0.25 (quarter Kelly), the sane choice for noisy estimates; use `1` for full Kelly if you enjoy variance. Pass `TRUE` as `details` for a full breakdown table instead of one number.

A classic combo: devig a sharp book's two-sided price to estimate the true probability, then Kelly-size your bet at a soft book's better price. See the template below.

### `=PARLAY_HEDGE(originalStake, originalOdds, hedgeOdds, [target])`

You have a bet on and the other side is now available somewhere: this returns the hedge stake and what each outcome pays. `target` is `"equal_profit"` (default), `"guaranteed_minimum"` or `"free_roll"`.

### `=PARLAY_FREEBET(amount, betOdds, hedgeOdds)`

Free bet conversion: hedge stake, guaranteed cash, and the share of face value you keep. Rule of thumb the table will confirm: the higher the price you take with the free bet, the better the conversion.

### `=PARLAY_STATUS()`

One line telling you whether you're on demo or live data. Useful as a header cell in shared sheets.

## The line-shopping board template

A ready-to-use layout you can build in about three minutes.

**1. Settings tab.** Run **ParlayAPI > Refresh now** once. It creates a `ParlaySettings` tab with a timestamp in `B1`. That cell is your refresh handle.

**2. Board tab.** Create a tab named `Board`. In `A1`:

```
=PARLAY_ODDS("nba", "moneyline", ParlaySettings!$B$1)
```

The formula spills: columns A to E are Matchup, Start (UTC), Side, Best, Best Book, and every sportsbook gets its own column from F onward. Rows are teams: each game contributes one row per side, exactly the "teams down rows, books across columns" board you'd otherwise build by hand from six sportsbook tabs.

**3. Highlight the best price in each row.** Select the book columns from row 2 down, for example `F2:T200`. Then **Format > Conditional formatting > Custom formula is**:

```
=AND(ISNUMBER(F2), F2=MAX($F2:$T2))
```

Pick a green fill and click Done. The best available price in every row lights up, and ties light up at every book offering them. (Adjust `F` and `T` if your book columns span a different range; with American odds the numeric maximum is always the bettor's best price, which is what makes this one-line rule correct.)

**4. Make it readable.** Freeze row 1 (**View > Freeze > 1 row**), bold it, and set column B's number format to date time. Optional: a filter on row 1 (**Data > Create a filter**) lets you collapse to one matchup.

**5. Refresh on your schedule.** Odds responses are cached for about a minute, and Sheets custom functions only recalculate when their inputs change. That's why the formula references `ParlaySettings!$B$1`: clicking **ParlayAPI > Refresh now** clears the cache and stamps a new time into that cell, and every formula pointing at it refetches. No key-burning background polling, you pull when you're actually looking.

**Bonus block: devig + Kelly edge finder.** On another tab:

| | A | B |
|---|---|---|
| 1 | Sharp side A odds | `-108` |
| 2 | Sharp side B odds | `-112` |
| 3 | Devig table | `=PARLAY_DEVIG(B1, B2)` |
| 8 | Your price at a soft book | `-102` |
| 9 | Bankroll | `1000` |
| 10 | Kelly stake | `=PARLAY_KELLY(B9, B8, E4)` |

`E4` is the Fair Prob cell for side A inside the devig spill (the table spills from B3, so its header sits on row 3 and side A on row 4; click the cell to confirm once the spill appears). If the stake comes back 0, the calculator is telling you the soft price isn't actually beating the fair line, which is worth knowing before you bet, not after.

## Credits, quotas and being honest about limits

- **What costs what.** The calculator endpoints are free and keyless. The live odds endpoint costs credits per fresh request (moneyline for one sport in one region costs 1 credit; the exact schedule is published at [`/v1/meta/credit-costs`](https://parlay-api.com/v1/meta/credit-costs)). The free tier includes 1,000 credits a month; paid tiers are listed at [parlay-api.com/pricing](https://parlay-api.com/pricing).
- **Caching does the heavy lifting.** Responses are cached for about 60 seconds, and one board is one request, however many rows it spills. A board you refresh manually a few dozen times a day lives comfortably inside the free tier. A formula per cell hammering `PARLAY_BEST_LINE` for 200 teams would not; build boards with one `PARLAY_ODDS` spill instead.
- **Google's own quotas exist too.** Apps Script caps UrlFetch calls per day and custom function runtime at 30 seconds. The cache keeps normal use nowhere near those limits, but a sheet with hundreds of independent odds formulas can hit them. Symptoms and fixes are in [TROUBLESHOOTING.md](TROUBLESHOOTING.md).
- **Data freshness.** With the 60 second cache, a board can be up to a minute behind the API. This kit is for line shopping and analysis, not for beating in-play markets from a spreadsheet.
- **Check your own usage** any time at [`/v1/usage`](https://parlay-api.com/v1/usage) (needs your key) or on your dashboard.

## Testing

The odds math, devig table construction, board building, best-line selection, caching behavior and error mapping are covered by automated tests that run the actual `Code.gs` under node with the Apps Script services mocked (fixtures were recorded from the real API; capture context sits in `test/fixtures/`):

```
node test/run-tests.js
```

Honest limitation: Google Apps Script itself cannot be executed headless, so the tests exercise the logic in plain V8 with `UrlFetchApp`, `CacheService` and `PropertiesService` mocked. The Apps Script runtime pieces (menu, prompts, authorization, real CacheService) are outside what automated tests can reach; the 2-minute install above plus `=PARLAY_STATUS()` and one `=PARLAY_ODDS("nba")` is the smoke test for those, and issues are very welcome if anything misbehaves in a real sheet.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for the greatest hits: `#NAME?`, permission prompts, `Loading...` cells, stale data, quota errors, and demo-mode questions.

## Related ParlayAPI tools

- [parlay-api-python](https://github.com/JacobiusMakes/parlay-api-python): the Python SDK, if you outgrow Sheets
- [parlayapi-line-shopper](https://github.com/JacobiusMakes/parlayapi-line-shopper): the same line-shopping idea as a CLI
- [parlayapi-arb-scanner](https://github.com/JacobiusMakes/parlayapi-arb-scanner): cross-book arbitrage scanner
- [betting-model-starter](https://github.com/JacobiusMakes/betting-model-starter): build your own model on historical closing lines

## License

MIT. See [LICENSE](LICENSE). Bet responsibly; if it stops being fun, stop.

---

Part of the [ParlayAPI](https://parlay-api.com) ecosystem: a real-time sports odds API with a free tier of 1,000 credits per month, no card required. Explore all the tools at [github.com/JacobiusMakes](https://github.com/JacobiusMakes).
