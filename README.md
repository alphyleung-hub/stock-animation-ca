# Stock Animation

This is a short film of one share's price. You choose a US or Hong Kong ticker and how many years to include. The story opens on the first close in that range and ends on the latest close. When the film finishes, you download it and share it yourself.

Yahoo Finance publishes the daily closes. This site reads them and plays them. It does not place a trade, and it does not post the video for you.

Open it at [stock-animation.keith-li.workers.dev](https://stock-animation.keith-li.workers.dev). There is no account to create and nothing to install. The page opens on NVDA. A first visit plays five years at normal speed.

[![Open the film](https://img.shields.io/badge/▶_Open_the_film-stock--animation.keith--li.workers.dev-137752?style=for-the-badge)](https://stock-animation.keith-li.workers.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/keithligh/stock-animation?style=for-the-badge)](https://github.com/keithligh/stock-animation)

![Finished NVDA film on the live site: the five-year closing path, the peak, the low, and the verdict from the first close to the latest](docs/film.png)

If the film helped you show where a share has been, or you want more people to find it, please [star the repository](https://github.com/keithligh/stock-animation). A star is how new readers discover the project, and it is the simplest way to support it.

## What the site is for

The site answers one question: what did this share's closing price do, from the first close in the range you picked to the latest close.

It plays that path for 30 seconds, on a 1920×1080 frame. You can watch it again. You can download the file and post it. The file is made on your computer, and the speed you watched at does not change it.

## What the film shows

Type a ticker such as `NVDA`, `AAPL`, or `0700.HK`, then press Play. A bare number is read as a Hong Kong code, so `700` is `0700.HK`. A US class share such as `BRK.B` is accepted. Other markets are not.

The ranges are **1Y**, **3Y**, and **5Y**. The page starts at **5Y**. Changing the range loads that history and plays it again. The speeds are **0.5×**, **1×**, **1.5×**, and **2×**. The page starts at **1×**. Speed only changes how fast you watch: at 2× the story is over in 15 seconds on screen, and the downloaded film is still 30 seconds. Play starts the ticker in the field. While that film is running, Play pauses it and continues from the same frame. Replay starts the film already loaded, and does not ask Yahoo again. Download MP4 appears when the film finishes. The encoding runs in the browser. A current Chrome, Edge, or Safari saves an MP4. A browser without H.264 saves a WebM file instead. The range and the speed stay until you close the tab.

The frame names the share, in the currency Yahoo reports. The line is the daily closes. It marks the start, the peak, and the low, with the price and the date of each. Three cards keep the high and the low for the range, the deepest drop from a peak to a trough, and the compound annual growth, labelled CAGR, from the first close to the latest. A drop of 20% or more can be named as the line passes it. So can the recovery, the largest up day, and the largest down day in the range. The line slows on the sharpest of those moments. The last three seconds state the path in one line: the first close, the latest close, the yearly growth, and the deepest drop. The corner of the frame reads "Data: Yahoo Finance".

## Open source

The code for this film is open source under the [MIT License](LICENSE). Clone it, run it, change it, and fork it. If you fork or reuse the work, please keep the copyright notice and credit [Stock Animation](https://github.com/keithligh/stock-animation) and [Keith Li](https://github.com/keithligh).

You need Node.js 22.

```bash
git clone https://github.com/keithligh/stock-animation.git
cd stock-animation
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

| Command | What it does |
| --- | --- |
| `npm run dev` | The page on port 5173, and the Yahoo relay on port 8787 |
| `npm test` | Vitest |
| `npm run typecheck` | TypeScript |
| `npm run build` | Typecheck, then the production build |

The page and the relay are written in TypeScript. Vite builds the page. The public site runs as a Cloudflare Worker, which serves the page and the relay the page uses to read Yahoo.

## How the site stays light

Everyone who opens the public site reads from a shared copy of each chart, held on Cloudflare. A copy is one Yahoo symbol, one session date, and one range. 1Y, 3Y, and 5Y are separate copies. `700.HK` and `0700.HK` share one fetch from Yahoo. While a copy is still current, the next visitor is served from it, and Yahoo is not called.

A fresh request goes to Yahoo only when that copy is missing. A chart Yahoo returned is kept until 16:30 at the next weekday close for that share: Hong Kong time for a Hong Kong share, New York time for a US share. The session date is part of the copy, so the next completed session is a new copy. When Yahoo says it has no such symbol, that answer is kept for a day.

Misses are limited, and a hit on the copy does not count. The limit is 60 misses a minute from one address, and 60 misses a minute shared by everyone, counted in each Cloudflare location. Many people can watch the same share at once, and the site does not add a request to Yahoo for every visit.

## Where the numbers come from

Each row is one figure on the film and the place it is read from. This table covers only what the film uses.

| On the film | Source |
| --- | --- |
| Daily closes for 1Y, 3Y, or 5Y | [Yahoo Finance](https://finance.yahoo.com/) chart, one bar per session. The close is Yahoo's split-adjusted quote close. |
| The price path | Those closes. Dividend cash is not added back, so the path is not a total return. The labelled prices are the closes, rounded to the cent. The line between them is drawn a little smoother than the raw bars, and the peak and the low stay on the real closes. |
| The day the film ends | The last completed weekday session, using 16:00 in Hong Kong for an HK share and 16:00 in New York for a US share. Weekends roll back to Friday. The site does not keep an exchange-holiday calendar. A bar after that date is left out. |
| The share's name and currency | Yahoo's short name, with suffixes such as Inc., Ltd., and Holdings left off, and the currency Yahoo reports. If the currency is missing, a US share is shown in USD and a Hong Kong share in HKD. |
| High, low, deepest drop, and yearly growth | Calculated from those closes. The high and the low are the extreme closes in the range, with the dates they happened. The yearly figure is the compound growth from the first close to the latest close. |
| Splits, mergers, spin-offs, and ticker changes | Only what Yahoo has already placed in that series. The site does not rebuild them. |

## Author

[Keith Li](https://www.linkedin.com/in/keithlihk) made Stock Animation. It is possible because Yahoo Finance publishes the daily closes the film reads.

If you have used the film, please [star the repository](https://github.com/keithligh/stock-animation). That star is how the next reader finds it.

Keith is on [LinkedIn](https://www.linkedin.com/in/keithlihk) and [GitHub](https://github.com/keithligh).
