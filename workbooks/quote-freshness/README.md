# How old is this quote?

East’s price reached your spreadsheet at 17:59:59 UTC. You review it one second later. Is it one second old? The source last updated the price at 17:58:35. At review, the quote is **85 seconds old** and spent **84 seconds in transit**.

[Download the editable Excel workbook](https://github.com/JacobiusMakes/parlayapi-sheets/releases/download/quote-freshness-v1.0/quote-freshness.xlsx) · [Browse the workbook in this repository](quote-freshness.xlsx)

Open the file in Excel or LibreOffice Calc. All six quotes are synthetic and refer to the same home-team moneyline in a fictional game. The calculations run offline using ordinary spreadsheet formulas. You can complete the exercise without an account, an API key or a macro.

## Try a 90-second window

1. Open the **Quote freshness** sheet. With the review time in **B5** and a 60-second limit in **D5**, **B7** counts two quotes. North is 20 seconds old. Central is exactly 60 seconds old and qualifies at the boundary.
2. Change **D5** to **90**. **B7** becomes **3** as East moves inside the window. West still arrived after the review. South has no source update time and Coastal has no price.
3. In the empty row **17**, enter a source name, decimal price above 1, source update time and receipt time in columns **A–D**. Use the full UTC date and time, down to the second. Columns **E–G** recalculate. To navigate by keyboard, use the name box to jump to **A17**, then press Tab between inputs.

The workbook compares each record with the fixed review time, so reopening it tomorrow gives the same result. A negative transit time means receipt precedes the recorded source update. When you use your own records, check that the feed documents which clock represents a source update and convert both clocks to UTC before entering them. A missing update time leaves age unknown.

To use these checks in a feed evaluation, [open ParlayAPI’s evaluation lab](https://parlay-api.com/tools/evaluation-lab?utm_source=github&utm_medium=workshop&utm_campaign=quote_freshness_workbook). For the live spreadsheet integration, follow the [Google Sheets installation guide](../../README.md#install-about-2-minutes).
