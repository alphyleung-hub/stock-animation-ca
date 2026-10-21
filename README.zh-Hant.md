# Stock Animation by Keith Li

[English](README.md) · 繁體中文

選一隻股票，就能得到一段 30 秒的股價短片，即刻可以分享。

Stock Animation 把一隻股票的每日收市價變成一段動畫走勢圖。線條由你所選時段的第一個收市價開始，一路畫到最新收市價，在關鍵時刻放慢，最後用一句話總結整段走勢。你可以先在瀏覽器觀看，再下載成 MP4，分享到社交媒體。

[![立即製作短片](https://img.shields.io/badge/▶_立即製作短片-stock--animation.keith--li.workers.dev-137752?style=for-the-badge)](https://stock-animation.keith-li.workers.dev)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/keithligh/stock-animation?style=for-the-badge)](https://github.com/keithligh/stock-animation/stargazers)

**[立即製作短片](https://stock-animation.keith-li.workers.dev)**。免費，毋須註冊，打開網頁時會先播放 NVDA，讓你先看看效果。

![NVDA 完整短片：五年收市價走勢，標示起點、最高位及最低位，三張摘要卡片，以及結尾總結](docs/film.png)

⭐ **如果 Stock Animation 幫你講好一隻股票的故事，[請在 GitHub 給它一顆星](https://github.com/keithligh/stock-animation)。** 星星能讓更多人發現這個項目，也是支持 Keith 繼續開發的動力。

## 製作短片

1. 在頂部輸入股票代號，按 Enter。美股直接輸入代號（`NVDA`、`AAPL`、`BRK.B`）。港股輸入 `.HK` 代號（`0700.HK`），只輸入數字如 `700` 亦會當作港股處理。
2. 選擇時段：**1Y**、**3Y** 或 **5Y**，預設為五年。
3. 觀看短片。播放及暫停按鈕在短片下方，旁邊是重播及速度選項（**0.5x**、**1x**、**1.5x**、**2x**）。
4. 播放完畢後，按 **Download MP4** 下載，隨意分享。

播放速度只影響觀看，下載的檔案永遠是完整 30 秒、1920×1080，不論你選擇哪個速度。

## 短片內容

短片由時段內第一個收市價開始，線條即時開始畫。線條推進時，會標示起點、最高收市價及最低收市價，各附價格及日期。當股價經過重要時刻，例如下跌 20% 或以上、其後的回升，或者單日最大升幅及跌幅，短片會標示出來，並在最急劇的一刻放慢，讓你看清楚。

三張卡片全程顯示：時段內的最高及最低價、由高位到其後低位的最大跌幅，以及由第一個收市價到最新收市價的年均增長率（CAGR）。卡片下方另有一句話，全程隨走勢更新，總結整個故事：由哪裏開始、現在在哪裏、每年增長多快，以及期間最大的跌幅。

## 須知

- **股價來源。** 所有數字來自 [Yahoo Finance](https://finance.yahoo.com/) 的每日收市價，已按拆股調整，短片角落亦註明資料來自 Yahoo。股息沒有計算在內，所以短片顯示的是股價本身，並非總回報。
- **數據有多新。** 短片以該市場時區（香港或紐約）最近一個已完成的交易日作結。
- **支援市場。** 暫時只支援美股及港股。
- **下載。** 影片由你的瀏覽器在你自己的電腦上製作，不會上傳任何東西。新版 Chrome、Edge 及 Safari 會儲存為 MP4，不支援 MP4 的瀏覽器則會儲存為 WebM。
- **人人都快。** 每隻股票的價格會存放在各個 Cloudflare 數據中心的共用快取，同一數據中心的下一個人查同一隻股票時即時就有，下次收市後才會再向 Yahoo 取數。
- **並非投資建議。** 短片只顯示股價過去的表現，並不建議買入或賣出任何股票。

## 緣起

Stock Animation 的靈感來自 ke11 的 [longbridge-remotion-charts](https://github.com/ke11/longbridge-remotion-charts)，是 Keith 在 Threads 上看到的項目。它把港股及美股的股價變成投資組合及比較走勢的動畫圖表，是個很好的點子。它在你自己的電腦上以 Node.js 運行，透過你的長橋（Longbridge）證券帳戶及其命令列工具讀取股價，再以 Remotion 製作影片，而 Remotion 以 FFmpeg 進行編碼。Keith 選擇不使用這些工具，改為製作一個任何人都能在瀏覽器中免費使用的版本。

因此，Stock Animation 是從零開始完全重寫的項目，與該項目沒有任何共用程式碼，並已逐個檔案核對。它改用 Yahoo Finance 免費的每日收市價，而非證券商的數據；在瀏覽器中以 WebCodecs 製作影片，完全不用 Remotion 及 FFmpeg；並免費運行於 Cloudflare，無需安裝任何東西，也無需開設帳戶：打開網站，輸入股票代號，下載 MP4 即可。本項目以 Grok Bot 及 Grok Build 打造。

Keith 與任何證券商或交易公司均無關連，Stock Animation 亦不推廣任何一家。正因如此，本項目刻意不使用任何商業證券商的 API 或命令列工具。使用本項目毋須任何交易帳戶，這裏的內容亦無意鼓勵任何人開設交易帳戶。

這正是開源的可貴之處：大家公開交流想法，並在彼此的成果上繼續發展。

## 自行運行

Stock Animation 以 [MIT 授權](LICENSE)開源。要運行自己的版本，需要 Node.js 22：

```bash
git clone https://github.com/keithligh/stock-animation.git
cd stock-animation
npm install
npm run dev
```

然後打開 [localhost:5173](http://localhost:5173)。如果你在此基礎上開發，請保留版權聲明並註明原作。

## 作者

Stock Animation 由 Keith Li 製作。歡迎在 [LinkedIn](https://www.linkedin.com/in/keithlihk) 及 [GitHub](https://github.com/keithligh) 找到他。

製作了喜歡的短片？⭐ [為這個項目加星](https://github.com/keithligh/stock-animation)，讓下一個人也能找到它。
