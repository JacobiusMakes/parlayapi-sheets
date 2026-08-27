# Troubleshooting

Every error the kit raises starts with `ParlayAPI:` and tries to tell you the fix in the message itself. Hover a cell showing `#ERROR!` to read it. This file covers those messages plus the Google-side problems the kit can't put a message on.

## Install problems

### `#NAME?` in the cell

Sheets doesn't know the function. Usually one of:

- The script wasn't saved. Go back to Extensions > Apps Script and check for the save icon being active; press Cmd+S / Ctrl+S.
- The paste was partial. Re-copy the entire `Code.gs` from the repo, select-all in the editor, paste over everything, save.
- A typo in the formula. It's `=PARLAY_ODDS(...)`, `=PARLAY_BEST_LINE(...)`, `=PARLAY_DEVIG(...)`, `=PARLAY_KELLY(...)`.

### The ParlayAPI menu doesn't appear

The menu is added when the spreadsheet opens. Reload the browser tab. If it still doesn't appear, open Extensions > Apps Script, pick `onOpen` in the function dropdown, press Run once, and grant the authorization it asks for.

### Google asks for scary-sounding permissions

The script needs "connect to an external service" (to call parlay-api.com) and spreadsheet access (to add the menu and the ParlaySettings tab). The entire source is in this repo; there is nothing else in it. Authorization is per-script and stays inside your Google account. If your Google Workspace admin blocks Apps Script authorization, you'll need to ask them or use a personal account.

### `Loading...` that never resolves, or "Internal error executing the custom function"

Almost always too many custom function calls at once. Two hundred separate `PARLAY_BEST_LINE` cells is two hundred executions. Fix the layout: one `PARLAY_ODDS` spill builds the whole board with a single execution and a single API request, then reference the spilled cells with normal formulas (`VLOOKUP`, `FILTER`, `INDEX/MATCH`). If a sheet got itself wedged, delete the stuck formulas, wait a minute, and re-enter one spill formula.

## Data questions

### The header says `[DEMO DATA]`

No API key is set, so odds functions serve the synthetic sandbox. Numbers are fake by design. `=PARLAY_STATUS()` says the same thing. Get a free key at parlay-api.com (no card) and add it via ParlayAPI > Set API key. The `[DEMO DATA]` tag disappears once live data flows.

### `demo (sandbox) data covers moneyline only` or `demo mode covers nba, nfl, mlb, nhl, epl and tennis only`

Sandbox limitations, on purpose: it's a stable playground, not a mirror of the whole API. Spreads, totals, and the full sport list need a key (the free tier covers them).

### Odds look stale

Three timers stack: the API caches responses for up to 60 seconds inside the kit, and Sheets only recalculates a custom function when its arguments change. Use ParlayAPI > Refresh now (and point the optional `refresh` argument of your formulas at `ParlaySettings!$B$1`, as the README template does). If you never pass the refresh argument, a formula can sit on old numbers indefinitely; that's Google's recalculation model, not a bug in the kit.

### A book column is blank on some rows

That book isn't offering that exact line. For spreads and totals, rows are keyed by the precise number (`Over 221.5` and `Over 222` are different rows), so books on a different number appear on their own row. For moneylines a blank means the book doesn't list that game (or delisted it).

### `no upcoming ... odds returned for that sport right now`

Off-season, or a quiet day. Try another sport key, or check what's live at https://parlay-api.com/live/api/sports (open it in a browser; it's keyless).

### PARLAY_BEST_LINE can't find my team

- Pass the sport explicitly: `=PARLAY_BEST_LINE("Lakers", "nba")`. Without it only NFL, NBA, MLB and NHL are scanned.
- Matching is a case-insensitive substring of the listed outcome name. Books list "Los Angeles Lakers", so "lakers" works but "LA L" may not. When in doubt run `=PARLAY_ODDS(...)` and read the Side column for the exact names.

## Key and quota errors

### `MISSING_KEY` or `INVALID_KEY`

The stored key is absent, mistyped, or revoked. ParlayAPI > Set API key to re-paste it (watch for stray spaces), or ParlayAPI > Clear API key to intentionally fall back to demo mode. Verify with ParlayAPI > Test connection.

### `HTTP 402` / `HTTP 429` / "allowance" messages

You've used this month's credits or hit a rate limit. Check consumption at https://parlay-api.com/v1/usage (with your key) and the plan options at https://parlay-api.com/pricing. Cheap wins first: build boards as one `PARLAY_ODDS` spill, refresh manually instead of reflexively, and pass the sport to `PARLAY_BEST_LINE` so it doesn't scan four sports.

### `Service invoked too many times for one day: urlfetch`

That one is Google's daily UrlFetch quota for your Google account, not ParlayAPI's. The kit's 60 second cache makes normal boards use a handful of fetches per refresh, so hitting this almost always means many independent custom function cells. Consolidate into spills, and it resets at Google's daily rollover.

### Setting the key without using the menu

If the prompt won't open (some embedded or admin-restricted contexts), set it by hand: Extensions > Apps Script > Project Settings (the gear icon) > Script Properties > Add script property. Property name `PARLAY_API_KEY`, value: your key. Same storage the menu uses.

### Who can see my key?

Not spreadsheet viewers: the key is in Script Properties, never in cells. But anyone with **edit** access to the spreadsheet can open its Apps Script project and read Script Properties. Treat edit access as key access: share view-only, or IMPORTRANGE the board into a separate shared sheet.

## Calculator functions

### `win probability must be between 0 and 1`

Enter 55% as `0.55`, not `55`. Percent-formatted cells are fine (Sheets passes 0.55 under the hood).

### `... is not a valid American price` on something like -50

American prices don't exist between -99 and +99. If you meant decimal odds, `1.5` style values are accepted as-is; the kit reads any value with absolute size 100 or more as American and values between 1 and 100 as decimal, the same rule the API uses.

### PARLAY_KELLY returns 0

Working as intended: at your inputs the bet has no edge, so Kelly says pass. Ask for the breakdown with `=PARLAY_KELLY(bankroll, odds, prob, 0.25, TRUE)` and look at "Your edge vs implied".

## Still stuck?

Open an issue: https://github.com/JacobiusMakes/parlayapi-sheets/issues. Include the exact formula, the exact error text (hover the `#ERROR!` cell), and whether `=PARLAY_STATUS()` says demo or live. API-side docs live at https://parlay-api.com/docs.
