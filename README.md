# Stock Animation by Keith Li

Pick a stock and get a 30-second film of its price, ready to post.

Stock Animation turns one share's daily closing prices into a short animated chart. The line draws itself from the first close in your range to the latest one, stops on the moments that mattered, and ends with a single sentence that sums up the whole run. You can watch it in the browser, then download it as an MP4 and share it on social media.

**[Make a film now](https://stock-animation.keith-li.workers.dev)**. It's free, there's no sign-up, and the page plays NVDA while you decide.

![The finished NVDA film: five years of closes with the start, peak and low marked, three summary cards, and the closing verdict](docs/film.png)

## Making a film

1. Type a ticker in the box at the top and press Enter. US tickers work as they are (`NVDA`, `AAPL`, `BRK.B`). Hong Kong stocks take the `.HK` code (`0700.HK`), and a bare number such as `700` is read as Hong Kong too.
2. Choose how far back to go: **1Y**, **3Y** or **5Y**. Five years is the default.
3. Watch it. Play and Pause sit under the film, along with Replay and the speed buttons (**0.5x**, **1x**, **1.5x**, **2x**).
4. When the film ends, press **Download MP4** and post it wherever you like.

The speed only changes how you watch. The downloaded file is always the full 30 seconds at 1920×1080, whatever speed you picked.

## What's in the film

The film opens on the first closing price in your range and starts drawing straight away. As the line moves, it labels the start, the highest close and the lowest close, each with its price and date. When the price passes a big moment, such as a fall of 20% or more, the recovery after it, or the biggest single up or down day, the film names it and slows down on the sharpest one so you can see it happen.

Three cards stay on screen the whole time: the high and low for the range, the deepest drop from a peak to the bottom that followed, and the yearly growth rate (CAGR) from the first close to the latest. For the last three seconds, a single line sums up the story: where it started, where it is now, how fast it grew each year, and the worst drop along the way.

## Good to know

- **Where the prices come from.** Every number comes from [Yahoo Finance](https://finance.yahoo.com/) daily closes, adjusted for splits, and the film credits Yahoo in the corner. Dividends aren't added back, so the film shows the price itself rather than total return.
- **How recent it is.** The film ends on the last trading day that has finished, in that market's own time zone (Hong Kong or New York).
- **Which markets work.** US and Hong Kong stocks only for now.
- **The download.** Your browser makes the video on your own computer, so nothing is uploaded. Current Chrome, Edge and Safari save an MP4. A browser that can't make MP4 saves a WebM instead.
- **It's quick for everyone.** Prices for each stock are kept on a shared cache, so the second person to ask for a ticker gets it instantly and Yahoo is only asked again after the next market close.
- **It isn't advice.** The film shows what a price did in the past. It doesn't recommend buying or selling anything.

## Running it yourself

Stock Animation is open source under the [MIT License](LICENSE). To run your own copy you need Node.js 22:

```bash
git clone https://github.com/keithligh/stock-animation.git
cd stock-animation
npm install
npm run dev
```

Then open [localhost:5173](http://localhost:5173). If you build on it, please keep the copyright notice and credit the original.

## Made by

Stock Animation is made by Keith Li. You can find him on [LinkedIn](https://www.linkedin.com/in/keithlihk) and [GitHub](https://github.com/keithligh).
