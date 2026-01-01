// @ts-nocheck
import { createChart } from '/_app/vendor/lightweight-charts.js';

const el = (id) => document.getElementById(id);

// Top controls
const symbolInput = el('symbolInput');
const tfSelect = el('tfSelect');
const typeSelect = el('typeSelect');
const btnLoad = el('btnLoad');
const btnFit = el('btnFit');

// HUD
const statusText = el('statusText');
const symbolPill = el('symbolPill');
const chkTrades = el('chkTrades');
const chkLines = el('chkLines');

// Auth
const btnGoogle = el('btnGoogle');
const btnApple = el('btnApple');
const btnLogout = el('btnLogout');
const userText = el('userText');
const userPill = el('userPill');

// Drawer
const btnDrawer = el('btnDrawer');
const btnCloseDrawer = el('btnCloseDrawer');
const drawer = el('drawer');
const backdrop = el('backdrop');

// Auto card
const btnAnalyze = el('btnAnalyze');
const btnExecSignal = el('btnExecSignal');
const btnLiveExec = el('btnLiveExec');
const btnHalt = el('btnHalt');
const sigDir = el('sigDir');
const sigConf = el('sigConf');
const sigWhy = el('sigWhy');
const autoState = el('autoState');
const execHint = el('execHint');

// Settings (drawer)
const settingsHint = el('settingsHint');
const btnTradingToggle = el('btnTradingToggle');
const tradingState = el('tradingState');
const keyLabel = el('keyLabel');
const apiKey = el('apiKey');
const apiSecret = el('apiSecret');
const apiPass = el('apiPass');
const btnSaveKey = el('btnSaveKey');
const btnReloadKeys = el('btnReloadKeys');
const btnVerifyKey = el('btnVerifyKey');
const keyVerifyState = el('keyVerifyState');
const keysHint = el('keysHint');
const riskDaily = el('riskDaily');
const riskExposure = el('riskExposure');
const riskPositions = el('riskPositions');
const btnSaveRisk = el('btnSaveRisk');

// Trades/tasks panels
const tradesHint = el('tradesHint');
const tradesList = el('tradesList');
const tradesEmpty = el('tradesEmpty');
const btnRefreshTasks = el('btnRefreshTasks');
const taskList = el('taskList');
const tasksHint = el('tasksHint');

function setStatus(s) {
  statusText.textContent = s;
}

function toUnixSeconds(ms) {
  return Math.floor(ms / 1000);
}

function fmt(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return x.toFixed(d);
}

function heikinAshi(candles) {
  const out = [];
  let prevHaOpen = null;
  let prevHaClose = null;
  for (const c of candles) {
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = prevHaOpen === null ? (c.open + c.close) / 2 : (prevHaOpen + prevHaClose) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    out.push({ ...c, open: haOpen, high: haHigh, low: haLow, close: haClose });
    prevHaOpen = haOpen;
    prevHaClose = haClose;
  }
  return out;
}

async function apiGet(path) {
  const res = await fetch(path, { credentials: 'include' });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  if (!res.ok) throw new Error(json?.error?.message || txt || `HTTP ${res.status}`);
  return json;
}

async function apiJson(method, path, body) {
  const res = await fetch(path, {
    method,
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch {}
  if (!res.ok) throw new Error(json?.error?.message || txt || `HTTP ${res.status}`);
  return json;
}

// --- Drawer UX ---
function openDrawer() {
  drawer.hidden = false;
  backdrop.hidden = false;
}
function closeDrawer() {
  drawer.hidden = true;
  backdrop.hidden = true;
}
btnDrawer.addEventListener('click', openDrawer);
btnCloseDrawer.addEventListener('click', closeDrawer);
backdrop.addEventListener('click', closeDrawer);
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
});

for (const b of document.querySelectorAll('.drawer-tabs .tab')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.drawer-tabs .tab')) x.classList.remove('active');
    b.classList.add('active');
    const tab = b.getAttribute('data-tab');
    for (const p of document.querySelectorAll('.tab-panel')) {
      p.hidden = p.getAttribute('data-panel') !== tab;
    }
  });
}

// --- Auth ---
async function loadMe() {
  try {
    const j = await apiGet('/v1/auth/me');
    const u = j?.user;
    const dot = userPill.querySelector('.chip-dot');
    if (!u) {
      userText.textContent = 'Not logged in';
      dot.classList.remove('on');
      btnLogout.style.display = 'none';
      settingsHint.textContent = 'Login to configure keys and risk.';
      tradesHint.textContent = 'Login to see your trade history.';
      disableAuthedControls(true);
      return null;
    }
    userText.textContent = `${u.email || u.name || u.id} • ${u.tier}`;
    dot.classList.add('on');
    btnLogout.style.display = '';
    settingsHint.textContent = 'Keys are encrypted and can’t be viewed again.';
    tradesHint.textContent = 'Your trade history.';
    disableAuthedControls(false);
    return u;
  } catch {
    disableAuthedControls(true);
    return null;
  }
}

function disableAuthedControls(disabled) {
  btnExecSignal.disabled = disabled;
  btnLiveExec.disabled = disabled;
  btnHalt.disabled = disabled;
  btnTradingToggle.disabled = disabled;
  btnSaveKey.disabled = disabled;
  btnReloadKeys.disabled = disabled;
  btnVerifyKey.disabled = disabled;
  btnSaveRisk.disabled = disabled;
  btnRefreshTasks.disabled = disabled;
}

btnGoogle.addEventListener('click', () => (window.location.href = '/v1/auth/google/start'));
btnApple.addEventListener('click', () => (window.location.href = '/v1/auth/apple/start'));
btnLogout.addEventListener('click', async () => {
  try { await fetch('/v1/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
  await loadMe();
  sigDir.textContent = '—';
  sigConf.textContent = '—';
  sigWhy.textContent = 'Waiting…';
});

// --- Chart ---
let chart;
let candleSeries;
let tradeLineSeries = [];

function initChart() {
  const container = el('chart');
  chart = createChart(container, {
    layout: { background: { type: 'solid', color: 'rgba(11,15,20,0)' }, textColor: '#cfe0f2' },
    grid: { vertLines: { color: 'rgba(38,60,84,.25)' }, horzLines: { color: 'rgba(38,60,84,.25)' } },
    rightPriceScale: { borderColor: 'rgba(38,60,84,.45)' },
    timeScale: { borderColor: 'rgba(38,60,84,.45)', timeVisible: true, secondsVisible: true },
    crosshair: { mode: 1 },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: '#2ee59d',
    downColor: '#ff4d6d',
    borderUpColor: '#2ee59d',
    borderDownColor: '#ff4d6d',
    wickUpColor: 'rgba(46,229,157,.9)',
    wickDownColor: 'rgba(255,77,109,.9)',
  });

  const ro = new ResizeObserver(() => {
    chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
  });
  ro.observe(container);
}

function clearOverlays() {
  candleSeries.setMarkers([]);
  for (const s of tradeLineSeries) chart.removeSeries(s);
  tradeLineSeries = [];
}

function setSeriesType(type) {
  const data = candleSeries.data ? candleSeries.data() : null;
  chart.removeSeries(candleSeries);

  if (type === 'bars') {
    candleSeries = chart.addBarSeries({ upColor: '#2ee59d', downColor: '#ff4d6d' });
  } else {
    candleSeries = chart.addCandlestickSeries({
      upColor: '#2ee59d',
      downColor: '#ff4d6d',
      borderUpColor: '#2ee59d',
      borderDownColor: '#ff4d6d',
      wickUpColor: 'rgba(46,229,157,.9)',
      wickDownColor: 'rgba(255,77,109,.9)',
    });
  }
  if (data) candleSeries.setData(data);
}

async function loadCandles() {
  const symbol = symbolInput.value.trim().toUpperCase();
  const tf = tfSelect.value;
  const type = typeSelect.value;
  symbolPill.textContent = symbol;

  setStatus('Loading…');
  clearOverlays();

  const j = await apiGet(`/v1/market/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&limit=500`);
  const raw = (j?.candles || []).map((c) => ({
    time: Number(c.time),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
  }));

  let view = raw;
  if (type === 'heikin') view = heikinAshi(raw);

  if (type === 'bars') setSeriesType('bars');
  else setSeriesType('candles');

  candleSeries.setData(view.map((c) => ({ ...c, time: toUnixSeconds(c.time) })));
  chart.timeScale().fitContent();
  setStatus('Ready');

  if (chkTrades.checked) {
    await loadTrades(symbol);
  }
}

btnLoad.addEventListener('click', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));
btnFit.addEventListener('click', () => chart.timeScale().fitContent());
typeSelect.addEventListener('change', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));
tfSelect.addEventListener('change', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));
chkTrades.addEventListener('change', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));
chkLines.addEventListener('change', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));

// --- Trades (drawer list + chart overlays) ---
function setTradeList(trades) {
  tradesList.innerHTML = '';
  if (!trades.length) {
    tradesEmpty.hidden = false;
    tradesList.appendChild(tradesEmpty);
    return;
  }
  tradesEmpty.hidden = true;
  for (const t of trades) {
    const entryTs = new Date(t.entryTime).toISOString().slice(0, 19).replace('T', ' ');
    const pnl = t.realizedPnlUsd;
    const badge = pnl === null || pnl === undefined ? '' : (Number(pnl) >= 0 ? 'pos' : 'neg');

    let why = '';
    try {
      const r = JSON.parse(t.rationaleJson);
      why = r?.summary || r?.rationale || r?.decision?.rationale || '';
    } catch {
      why = t.rationaleJson || '';
    }

    const node = document.createElement('div');
    node.className = 'item';
    node.innerHTML = `
      <div class="item-top">
        <div class="item-title">${t.symbol} • ${t.side}</div>
        <div class="badge ${badge}">${pnl === null || pnl === undefined ? '' : fmt(pnl, 2)}</div>
      </div>
      <div class="item-sub">${entryTs} • ${why || ''}</div>
    `;
    tradesList.appendChild(node);
  }
}

async function loadTrades(symbol) {
  setStatus('Loading trades…');
  let j;
  try {
    j = await apiGet(`/v1/trades?symbol=${encodeURIComponent(symbol)}&limit=150`);
  } catch (e) {
    setStatus('Trades require login');
    return;
  }
  const trades = j?.trades || [];
  setTradeList(trades);

  clearOverlays();
  if (!chkTrades.checked) return;

  const markers = [];
  const lines = [];
  for (const t of trades) {
    const entryTs = toUnixSeconds(new Date(t.entryTime).getTime());
    const exitTs = t.exitTime ? toUnixSeconds(new Date(t.exitTime).getTime()) : null;
    const side = t.side;
    markers.push({
      time: entryTs,
      position: side === 'LONG' ? 'belowBar' : 'aboveBar',
      color: side === 'LONG' ? '#2ee59d' : '#ff4d6d',
      shape: side === 'LONG' ? 'arrowUp' : 'arrowDown',
      text: side,
    });
    if (exitTs) {
      markers.push({
        time: exitTs,
        position: side === 'LONG' ? 'aboveBar' : 'belowBar',
        color: '#f7c94b',
        shape: 'circle',
        text: 'EXIT',
      });
    }
    if (exitTs && chkLines.checked && t.exitPrice) {
      const line = chart.addLineSeries({
        color: 'rgba(110,231,255,.32)',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      line.setData([
        { time: entryTs, value: Number(t.entryPrice) },
        { time: exitTs, value: Number(t.exitPrice) },
      ]);
      lines.push(line);
    }
  }
  candleSeries.setMarkers(markers);
  tradeLineSeries = lines;
  setStatus('Ready');
}

// --- Tasks (drawer) ---
function renderTasks(tasks) {
  taskList.innerHTML = '';
  if (!tasks.length) {
    tasksHint.textContent = 'No tasks.';
    taskList.appendChild(tasksHint);
    return;
  }
  for (const t of tasks) {
    const node = document.createElement('div');
    node.className = 'item';
    let extra = '';
    if (t.status === 'SUCCEEDED' && t.resultJson) {
      try {
        const r = JSON.parse(t.resultJson);
        if (r?.action) extra = ` • ${r.action}`;
        if (r?.dryRun) extra += ' • dry-run';
      } catch {}
    }
    node.innerHTML = `
      <div class="item-top">
        <div class="item-title">${t.type}</div>
        <div class="badge">${t.status}</div>
      </div>
      <div class="item-sub">attempts=${t.attempts}${extra}${t.lastError ? ` • ${t.lastError}` : ''}</div>
    `;
    taskList.appendChild(node);
  }
}

async function refreshTasks() {
  try {
    const j = await apiGet('/v1/trading/tasks?limit=10');
    renderTasks(j?.tasks || []);
  } catch (e) {
    tasksHint.textContent = `Tasks unavailable: ${e.message}`;
    taskList.innerHTML = '';
    taskList.appendChild(tasksHint);
  }
}
btnRefreshTasks.addEventListener('click', refreshTasks);

// --- Settings (drawer) ---
function setTradingUi(on) {
  tradingState.textContent = on ? 'ON' : 'OFF';
  tradingState.classList.toggle('on', on);
  tradingState.classList.toggle('off', !on);
  btnTradingToggle.textContent = on ? 'Disable trading' : 'Enable trading';
}

async function loadSettings() {
  const u = await loadMe();
  if (!u) return;

  try {
    const j = await apiGet('/v1/settings');
    const risk = j?.risk;
    if (risk) {
      riskDaily.value = String(risk.maxDailyLossUsd ?? 100);
      riskExposure.value = String(risk.maxOpenExposureUsd ?? 200);
      riskPositions.value = String(risk.maxConcurrentPositions ?? 1);
      setTradingUi(Boolean(risk.tradingEnabled));
    }
    const keyCount = Array.isArray(j?.keys) ? j.keys.length : 0;
    keysHint.textContent = keyCount ? `Saved keys: ${keyCount} (last4 only)` : 'No keys saved.';
  } catch (e) {
    keysHint.textContent = `Settings unavailable: ${e.message}`;
  }
}

btnSaveKey.addEventListener('click', async () => {
  try {
    setStatus('Saving key…');
    const payload = {
      exchange: 'BITGET',
      label: (keyLabel.value || '').trim() || undefined,
      apiKey: (apiKey.value || '').trim(),
      apiSecret: (apiSecret.value || '').trim(),
      passphrase: (apiPass.value || '').trim() || undefined,
      withdrawEnabled: false,
    };
    const j = await apiJson('POST', '/v1/exchange-keys', payload);
    apiKey.value = '';
    apiSecret.value = '';
    apiPass.value = '';
    keysHint.textContent = `Saved (last4: ${j?.key?.apiKeyLast4 || '****'}).`;
    await loadSettings();
    setStatus('Ready');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

btnReloadKeys.addEventListener('click', loadSettings);

btnSaveRisk.addEventListener('click', async () => {
  try {
    setStatus('Saving risk…');
    await apiJson('PUT', '/v1/settings/risk', {
      maxDailyLossUsd: riskDaily.value,
      maxOpenExposureUsd: riskExposure.value,
      maxConcurrentPositions: riskPositions.value,
    });
    await loadSettings();
    setStatus('Ready');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

btnTradingToggle.addEventListener('click', async () => {
  try {
    const next = tradingState.textContent !== 'ON';
    setStatus(next ? 'Enabling…' : 'Disabling…');
    const j = await apiJson('PUT', '/v1/settings/trading', { tradingEnabled: next });
    setTradingUi(Boolean(j?.tradingEnabled));
    setStatus('Ready');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

btnVerifyKey.addEventListener('click', async () => {
  try {
    setStatus('Queue verify…');
    await apiJson('POST', '/v1/trading/live/verify-key', {});
    keyVerifyState.textContent = 'PENDING';
    keyVerifyState.classList.add('on');
    keyVerifyState.classList.remove('off');
    setStatus('Ready');
    await refreshTasks();
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

// --- Signal / Auto card ---
function makeIdempotency(prefix) {
  const rnd = Math.random().toString(16).slice(2);
  const t = Date.now().toString(16);
  return `${prefix}_${t}_${rnd}`.slice(0, 80);
}

function normalizeTfForAnalysis(tf) {
  return tf === '5s' || tf === '15s' || tf === '30s' ? '1m' : tf;
}

function paintSignal(recommend, confidence, action, why) {
  sigDir.textContent = recommend || '—';
  sigConf.textContent = confidence ? `${confidence}%` : '—';
  sigWhy.textContent = why || '—';
  execHint.textContent = action || '—';
}

async function analyze() {
  const symbol = symbolInput.value.trim().toUpperCase();
  const tf = normalizeTfForAnalysis(tfSelect.value);
  setStatus('Analyzing…');
  try {
    const j = await apiGet(`/v1/analysis/signal?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}`);
    const d = j?.decision;
    const action = j?.action;
    const reasons = Array.isArray(d?.reasons) ? d.reasons : [];
    paintSignal(d?.recommend, d?.confidence, action, (reasons[0] || d?.rationale || ''));
    setStatus('Ready');
    autoState.textContent = 'OFF';
    autoState.classList.remove('on');
  } catch (e) {
    paintSignal('—', null, 'ANALYSIS_FAILED', e.message);
    setStatus('Ready');
  }
}

btnAnalyze.addEventListener('click', analyze);

btnExecSignal.addEventListener('click', async () => {
  try {
    const symbol = symbolInput.value.trim().toUpperCase();
    const tf = normalizeTfForAnalysis(tfSelect.value);
    setStatus('Executing…');
    const j = await apiJson('POST', '/v1/trading/paper/execute-signal', {
      symbol,
      tf,
      orderUsd: 100,
      leverage: 5,
      idempotencyKey: makeIdempotency('exec'),
    });
    if (j.action === 'NO_TRADE') {
      paintSignal(j?.decision?.recommend, j?.decision?.confidence, 'NO_TRADE', j?.decision?.rationale || 'Policy blocked');
      setStatus('Ready');
    } else {
      paintSignal(j?.decision?.recommend, j?.decision?.confidence, 'OPENED_PAPER', `orderId=${j.orderId}`);
      setStatus('Ready');
      if (chkTrades.checked) await loadTrades(symbol);
    }
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

btnLiveExec.addEventListener('click', async () => {
  try {
    const symbol = symbolInput.value.trim().toUpperCase();
    const tf = normalizeTfForAnalysis(tfSelect.value);
    setStatus('Queueing live…');
    await apiJson('POST', '/v1/trading/live/execute-signal', {
      symbol,
      tf,
      orderUsd: 100,
      leverage: 5,
      idempotencyKey: makeIdempotency('live_exec'),
    });
    paintSignal(sigDir.textContent, sigConf.textContent.replace('%',''), 'QUEUED_LIVE', 'Queued. See Tasks.');
    setStatus('Ready');
    await refreshTasks();
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

btnHalt.addEventListener('click', async () => {
  try {
    setStatus('Halting…');
    await apiJson('POST', '/v1/trading/halt', { message: 'User requested halt from UI' });
    execHint.textContent = 'HALTED';
    autoState.textContent = 'OFF';
    autoState.classList.remove('on');
    setStatus('Ready');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

// --- Boot ---
initChart();
await loadSettings();
await loadCandles().catch((e) => setStatus(`Error: ${e.message}`));

