# Fixtures

Recorded from the live ParlayAPI endpoints on 2026-08-27 with plain GET
requests (no key). Each file is the verbatim response body:

| File | Endpoint |
|---|---|
| calc_kelly.json | /v1/calc/kelly?bankroll=1000&odds=-110&win_prob=0.55 |
| calc_edge_devig.json | /v1/calc/edge?odds=-108&sharp_over_odds=-108&sharp_under_odds=-112 |
| calc_hedge.json | /v1/calc/hedge?original_stake=100&original_odds=%2B250&hedge_odds=-140 |
| calc_free_bet.json | /v1/calc/free-bet?free_bet_usd=50&bet_odds=%2B300&hedge_odds=-360 |
| sandbox_odds_nba.json | /v1/sandbox/sports/basketball_nba/odds?markets=h2h&oddsFormat=american |
| sandbox_odds_nfl_spreads.json | /v1/sandbox/sports/americanfootball_nfl/odds (sandbox serves h2h) |

All are keyless endpoints, so anyone can re-record them with curl and rerun
the tests against fresh captures. Note that the sandbox randomizes prices on
each request (teams and shape are stable, numbers are not), which is why the
tests derive expected best lines from the fixture instead of hardcoding them:
re-recorded fixtures keep passing.
