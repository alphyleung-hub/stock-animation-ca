import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist/latin-600.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-mono/latin-500.css';
import { parseYahooChart } from '../shared/parse';
import { lastCompletedSession } from '../shared/session';
import { canonicalizeTicker, mapRelaySymbol } from '../shared/symbols';
import { chartApiPath, isLookbackRange, LOOKBACK_RANGES, type LookbackRange } from '../shared/yahoo';
import { exportAnimation } from './export';
import { lookbackFromKey, readStoredLookback, writeStoredLookback } from './lookback';
import {
  PLAYBACK_RATES,
  anchorClock,
  frameAt,
  isPlaybackRate,
  parsePlaybackRate,
  type PlaybackRate,
} from './playback';
import { buildAnimation, drawFrame, drawLoading, FRAME_COUNT, type Animation } from './render';

const PLAYING_HINT = 'When it finishes, download the MP4 and share it.';
const FINISHED_HINT = 'Film finished. Download the MP4 and share it on social media.';

const form = document.querySelector<HTMLFormElement>('#form');
const tickerInput = document.querySelector<HTMLInputElement>('#ticker');
const playButton = document.querySelector<HTMLButtonElement>('#play');
const replayButton = document.querySelector<HTMLButtonElement>('#replay');
const downloadButton = document.querySelector<HTMLButtonElement>('#download');
const lookbackGroup = document.querySelector<HTMLDivElement>('[data-lookback]');
const lookbackButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-lookback] [data-span]')];
const speedGroup = document.querySelector<HTMLDivElement>('[data-speed]');
const speedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-speed] [data-rate]')];
const statusLine = document.querySelector<HTMLParagraphElement>('#status');
const canvas = document.querySelector<HTMLCanvasElement>('#stage');

if (
  !form ||
  !tickerInput ||
  !playButton ||
  !replayButton ||
  !downloadButton ||
  !lookbackGroup ||
  lookbackButtons.length !== LOOKBACK_RANGES.length ||
  !speedGroup ||
  speedButtons.length !== PLAYBACK_RATES.length ||
  !statusLine ||
  !canvas
) {
  throw new Error('Page is missing its controls');
}

const ctx = canvas.getContext('2d', { alpha: false });
if (!ctx) throw new Error('Canvas is unavailable');

const context: CanvasRenderingContext2D = ctx;
const ticker: HTMLInputElement = tickerInput;
const saveButton: HTMLButtonElement = downloadButton;
const replay: HTMLButtonElement = replayButton;
const status: HTMLParagraphElement = statusLine;

const SPEED_STORAGE_KEY = 'sa-playback-rate';

let animation: Animation | null = null;
let playing = false;
let clockStart = 0;
let shownFrame = 0;
let playbackRate: PlaybackRate = readStoredRate();
let lookback: LookbackRange = readLookback();
let generation = 0;
let exportAbort: AbortController | null = null;
let loadAbort: AbortController | null = null;

syncLookback(false);
syncSpeed(false);
lookbackGroup.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-span]') : null;
  if (!button) return;
  const range = button.dataset.span ?? '';
  if (!isLookbackRange(range)) return;
  setLookback(range);
});
lookbackGroup.addEventListener('keydown', (event) => {
  const next = lookbackFromKey(lookback, event.key);
  if (next === null) return;
  event.preventDefault();
  setLookback(next, true);
});
speedGroup.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('[data-rate]') : null;
  if (!button) return;
  const rate = Number(button.dataset.rate);
  if (!isPlaybackRate(rate)) return;
  setPlaybackRate(rate);
});
speedGroup.addEventListener('keydown', (event) => {
  const next = rateFromKey(event.key);
  if (next === null) return;
  event.preventDefault();
  setPlaybackRate(next, true);
});

saveButton.hidden = true;
replay.hidden = true;

void document.fonts.ready.then(() => {
  if (document.body.dataset.state === 'loading') {
    const display = canonicalizeTicker(tickerInput.value);
    if (display) drawLoading(context, display);
  }
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void loadTicker(tickerInput.value);
});

replay.addEventListener('click', () => {
  restartPlayback();
});

downloadButton.addEventListener('click', () => {
  if (exportAbort) {
    exportAbort.abort();
    return;
  }
  if (animation) void download(animation);
});

window.__anim = {
  get frameCount() {
    return FRAME_COUNT;
  },
  get hookFrame() {
    return animation?.hookFrame ?? 72;
  },
  get calloutFrame() {
    return animation?.calloutFrame ?? 0;
  },
  seek(frame: number) {
    if (!animation) return;
    playing = false;
    shownFrame = frame;
    drawFrame(context, animation, frame);
  },
  finish() {
    if (!animation) return;
    playing = false;
    generation += 1;
    shownFrame = FRAME_COUNT - 1;
    drawFrame(context, animation, FRAME_COUNT - 1);
    markFinished();
  },
  get frame() {
    return shownFrame;
  },
  get rate() {
    return playbackRate;
  },
};

if (!tickerInput.value.trim()) tickerInput.value = 'NVDA';
void loadTicker(tickerInput.value);

async function loadTicker(raw: string): Promise<void> {
  const display = canonicalizeTicker(raw);
  const mapped = display ? mapRelaySymbol(display) : null;
  if (!display || !mapped) {
    setStatus('Use a ticker like 0700.HK or NVDA.');
    document.body.dataset.state = 'error';
    replay.hidden = !animation;
    return;
  }
  exportAbort?.abort();
  loadAbort?.abort();
  const abort = new AbortController();
  loadAbort = abort;
  generation += 1;
  playing = false;
  animation = null;
  saveButton.hidden = true;
  saveButton.textContent = 'Download MP4';
  replay.hidden = true;
  document.body.dataset.state = 'loading';
  drawLoading(context, display);
  setStatus(`Loading ${display}…`);
  const range = lookback;
  try {
    const session = lastCompletedSession(mapped.market, new Date());
    const payload = await fetchChart(display, session, range, abort.signal);
    const series = parseYahooChart(payload, session);
    const next = buildAnimation({
      displaySymbol: series.displaySymbol,
      name: series.name,
      currency: series.currency,
      bars: series.bars,
      dividends: series.dividends,
    });
    if (abort.signal.aborted) return;
    animation = next;
    saveButton.hidden = true;
    saveButton.textContent = 'Download MP4';
    document.body.dataset.state = 'ready';
    replay.hidden = false;
    setStatus(PLAYING_HINT);
    startPlayback();
  } catch (error) {
    if (abort.signal.aborted) return;
    document.body.dataset.state = 'error';
    replay.hidden = true;
    setStatus(error instanceof Error ? error.message : 'Could not load that ticker.');
  }
}

async function fetchChart(symbol: string, session: string, range: LookbackRange, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  const onAbort = () => controller.abort();
  signal.addEventListener('abort', onAbort);
  try {
    const response = await fetch(chartApiPath(symbol, session, range), {
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(friendlyRelay(body?.error, response.status));
    }
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(signal.aborted ? 'Cancelled' : 'The data relay timed out.');
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', onAbort);
  }
}

function restartPlayback(): void {
  if (!animation || exportAbort || document.body.dataset.state === 'loading') return;
  generation += 1;
  playing = false;
  saveButton.hidden = true;
  saveButton.textContent = 'Download MP4';
  document.body.dataset.state = 'ready';
  replay.hidden = false;
  setStatus(PLAYING_HINT);
  startPlayback();
}

function startPlayback(): void {
  const gen = generation;
  playing = true;
  shownFrame = 0;
  if (animation) drawFrame(context, animation, 0);
  clockStart = performance.now();
  requestAnimationFrame((now) => {
    if (gen !== generation) return;
    tick(now, gen);
  });
}

function tick(now: number, gen: number): void {
  if (gen !== generation || !playing || !animation) return;
  const frame = frameAt(now, clockStart, playbackRate, FRAME_COUNT);
  if (gen !== generation || !playing || !animation) return;
  shownFrame = frame;
  drawFrame(context, animation, frame);
  if (frame >= FRAME_COUNT - 1) {
    playing = false;
    markFinished();
    return;
  }
  requestAnimationFrame((next) => tick(next, gen));
}

function markFinished(): void {
  document.body.dataset.state = 'played';
  saveButton.hidden = false;
  saveButton.textContent = 'Download MP4';
  replay.hidden = !animation;
  setStatus(FINISHED_HINT);
}

async function download(current: Animation): Promise<void> {
  const abort = new AbortController();
  exportAbort = abort;
  const gen = generation;
  document.body.dataset.state = 'encoding';
  saveButton.hidden = false;
  saveButton.textContent = '0% · Cancel';
  replay.hidden = true;
  playing = false;
  try {
    const result = await exportAnimation(current, (frame, total) => {
      if (gen !== generation) return;
      const pct = Math.min(100, Math.round((frame / total) * 100));
      saveButton.textContent = `${pct}% · Cancel`;
      setStatus(`Encoding ${frame.toLocaleString('en-US')} / ${total.toLocaleString('en-US')}`);
    }, abort.signal);
    if (gen !== generation) return;
    const name = `${labelFor(current.symbol).replace(/\./g, '-')}-price.${result.extension}`;
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    document.body.dataset.state = 'played';
    setStatus(`Saved ${name}`);
  } catch (error) {
    if (gen !== generation) return;
    document.body.dataset.state = 'played';
    if (error instanceof DOMException && error.name === 'AbortError') {
      setStatus('Export cancelled.');
    } else {
      setStatus(error instanceof Error ? error.message : 'Export failed.');
    }
  } finally {
    if (exportAbort === abort) exportAbort = null;
    if (gen === generation) {
      saveButton.textContent = 'Download MP4';
      if (document.body.dataset.state === 'encoding') {
        document.body.dataset.state = 'played';
        setStatus(FINISHED_HINT);
      }
      replay.hidden = !animation || document.body.dataset.state === 'loading';
    }
  }
}

function readLookback(): LookbackRange {
  try {
    return readStoredLookback(sessionStorage);
  } catch {
    return '5y';
  }
}

function writeLookback(range: LookbackRange): void {
  try {
    writeStoredLookback(sessionStorage, range);
  } catch {
    // Private browsing can reject storage. The in-memory range still applies.
  }
}

function setLookback(range: LookbackRange, focus = false): void {
  const changed = range !== lookback;
  lookback = range;
  writeLookback(range);
  syncLookback(focus);
  if (!changed) return;
  void loadTicker(ticker.value);
}

function syncLookback(focus: boolean): void {
  for (const button of lookbackButtons) {
    const checked = button.dataset.span === lookback;
    button.setAttribute('aria-checked', checked ? 'true' : 'false');
    button.tabIndex = checked ? 0 : -1;
    if (checked && focus) button.focus();
  }
}

function readStoredRate(): PlaybackRate {
  try {
    return parsePlaybackRate(sessionStorage.getItem(SPEED_STORAGE_KEY));
  } catch {
    return 1;
  }
}

function writeStoredRate(rate: PlaybackRate): void {
  try {
    sessionStorage.setItem(SPEED_STORAGE_KEY, String(rate));
  } catch {
    // Private browsing can reject storage. The in-memory rate still applies.
  }
}

function setPlaybackRate(rate: PlaybackRate, focus = false): void {
  if (rate !== playbackRate && playing) {
    clockStart = anchorClock(performance.now(), shownFrame, rate);
  }
  playbackRate = rate;
  writeStoredRate(rate);
  syncSpeed(focus);
}

function syncSpeed(focus: boolean): void {
  for (const button of speedButtons) {
    const checked = Number(button.dataset.rate) === playbackRate;
    button.setAttribute('aria-checked', checked ? 'true' : 'false');
    button.tabIndex = checked ? 0 : -1;
    if (checked && focus) button.focus();
  }
}

function rateFromKey(key: string): PlaybackRate | null {
  const index = PLAYBACK_RATES.indexOf(playbackRate);
  if (key === 'ArrowRight' || key === 'ArrowDown') return PLAYBACK_RATES[(index + 1) % PLAYBACK_RATES.length] ?? null;
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return PLAYBACK_RATES[(index - 1 + PLAYBACK_RATES.length) % PLAYBACK_RATES.length] ?? null;
  }
  if (key === 'Home') return PLAYBACK_RATES[0];
  if (key === 'End') return PLAYBACK_RATES[PLAYBACK_RATES.length - 1] ?? null;
  return null;
}

function setStatus(text: string): void {
  status.textContent = text;
}

function friendlyRelay(code: string | undefined, statusCode: number): string {
  if (code === 'invalid_symbol') return 'Use a ticker like 0700.HK or NVDA.';
  if (code === 'invalid_session') return 'That price date was not accepted. Try again.';
  if (code === 'rate_limited') return 'Too many requests. Wait a minute and try again.';
  if (code === 'upstream') return 'Yahoo Finance did not answer. Try again.';
  if (code === 'origin_not_allowed') return 'This page is not allowed to load prices.';
  return `Could not load that ticker (${statusCode}).`;
}

function labelFor(symbol: string): string {
  return symbol.endsWith('.US') ? symbol.slice(0, -3) : symbol;
}

declare global {
  interface Window {
    __anim?: {
      readonly frameCount: number;
      readonly hookFrame: number;
      readonly calloutFrame: number;
      seek(frame: number): void;
      finish(): void;
      readonly frame: number;
      readonly rate: number;
    };
  }
}
