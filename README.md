# Stock Animation

Stock Animation turns a US or Hong Kong share's price history into a short film you can download as an MP4 and share on social media. You choose the ticker and how many years to include. The story opens on the first close in that range and ends on the latest close.

**Live:** https://stock-animation.keith-li.workers.dev

## How to use

1. Enter a ticker such as `NVDA`, `AAPL`, or `0700.HK`, then press Play.
2. Watch the film.
3. Pick a range (**1Y**, **3Y**, or **5Y**) and a speed (**0.5×**, **1×**, **1.5×**, or **2×**). The page starts at **5Y** and **1×**. Those choices stay until you close the tab.
4. Press Replay to watch it again.
5. When the film finishes, press Download MP4 and share it on social media. The video is created on your computer.

The speed control only changes how fast you watch. The downloaded film stays about 30 seconds.

## What you see

The film is the share-price story for the range you picked. You see the peak and the low, the dates they happened, and a short verdict of the move from the first close to the latest. Daily prices come from Yahoo Finance.

## Credit

Created by [Keith Li](https://www.linkedin.com/in/keithlihk). Source: [github.com/keithligh/stock-animation](https://github.com/keithligh/stock-animation).

## License

[MIT](LICENSE)

## For developers

```bash
npm install && npm test && npm run dev
```

The site runs at <http://localhost:5173>.
