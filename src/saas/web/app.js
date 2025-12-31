import { createChart } from 'https://cdn.jsdelivr.net/npm/lightweight-charts@4.2.1/dist/lightweight-charts.esm.production.js';

const el = (id) => document.getElementById(id);
const statusText = el('statusText');
const symbolPill = el('symbolPill');

const symbolInput = el('symbolInput');
const tfSelect = el('tfSelect');
const typeSelect = el('typeSelect');
const btnLoad = el('btnLoad');
const btnFit = el('btnFit');

const chkTrades = el('chkTrades');
const chkLines = el('chkLines');

const btnGoogle = el('btnGoogle');
const btnApple = el('btnApple');
const btnLogout = el('btnLogout');
const userText = el('userText');
const userPill = el('userPill');

const tradesHint = el('tradesHint');
const tradesTable = el('tradesTable');
const tradesEmpty = el('tradesEmpty');

// Settings UI
const settingsHint = el('settingsHint');
const btnSaveKey = el('btnSaveKey');
const btnReloadKeys = el('btnReloadKeys');
const keyLabel = el('keyLabel');
const apiKey = el('apiKey');
const apiSecret = el('apiSecret');
const apiPass = el('apiPass');
const keysHint = el('keysHint');

const btnSaveRisk = el('btnSaveRisk');
const riskDaily = el('riskDaily');
const riskExposure = el('riskExposure');
const riskPositions = el('riskPositions');

const btnTradingToggle = el('btnTradingToggle');
const tradingState = el('tradingState');
const btnExecSignal = el('btnExecSignal');
const btnHalt = el('btnHalt');
const execHint = el('execHint');
const btnLiveExec = el('btnLiveExec');
const btnRefreshTasks = el('btnRefreshTasks');
const tasksHint = el('tasksHint');
const btnVerifyKey = el('btnVerifyKey');
const keyVerifyState = el('keyVerifyState');

function setStatus(s) {
  statusText.textContent = s;
}

function fmt(n, d = 2) {
  if (n === null || n === undefined) return '';
  const x = Number(n);
  if (!Number.isFinite(x)) return '';
  return x.toFixed(d);
}

function toUnixSeconds(ms) {
  return Math.floor(ms / 1000);
}

function heikinAshi(candles) {
  // candles: {time(ms), open, high, low, close, volume}
  const out = [];
  let prevHaOpen = null;
  let prevHaClose = null;

  for (const c of candles) {
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen =
      prevHaOpen === null
        ? (c.open + c.close) / 2
        : (prevHaOpen + prevHaClose) / 2;
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
  try { json = JSON.parse(txt); } catch { /* ignore */ }
  if (!res.ok) {
    const msg = json?.error?.message || txt || `HTTP ${res.status}`;
    throw new Error(msg);
  }
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
  try { json = JSON.parse(txt); } catch { /* ignore */ }
  if (!res.ok) {
    const msg = json?.error?.message || txt || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

let chart;
let candleSeries;
let tradeMarkers = [];
let tradeLineSeries = [];

function initChart() {
  const container = el('chart');
  chart = createChart(container, {
    layout: {
      background: { type: 'solid', color: 'rgba(11,15,20,0)' },
      textColor: '#cfe0f2',
    },
    grid: {
      vertLines: { color: 'rgba(27,42,58,.35)' },
      horzLines: { color: 'rgba(27,42,58,.35)' },
    },
    rightPriceScale: { borderColor: 'rgba(27,42,58,.8)' },
    timeScale: { borderColor: 'rgba(27,42,58,.8)', timeVisible: true, secondsVisible: true },
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

function resetOverlays() {
  tradeMarkers = [];
  candleSeries.setMarkers([]);
  for (const s of tradeLineSeries) chart.removeSeries(s);
  tradeLineSeries = [];
}

function setSeriesType(type) {
  // Recreate series to change type cleanly.
  const data = candleSeries.data ? candleSeries.data() : null;
  chart.removeSeries(candleSeries);

  if (type === 'bars') {
    candleSeries = chart.addBarSeries({
      upColor: '#2ee59d',
      downColor: '#ff4d6d',
    });
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
  setStatus('Loading candles…');
  resetOverlays();

  const j = await apiGet(`/v1/market/candles?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(tf)}&limit=400`);
  let candles = (j?.candles || []).map((c) => ({
    time: toUnixSeconds(Number(c.time)),
    open: Number(c.open),
    high: Number(c.high),
    low: Number(c.low),
    close: Number(c.close),
  }));

  if (type === 'heikin') {
    // Need original ms-based values for HA calc; reconstruct pseudo with seconds->ms
    const msCandles = (j?.candles || []).map((c) => ({
      time: Number(c.time),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));
    const ha = heikinAshi(msCandles).map((c) => ({
      time: toUnixSeconds(Number(c.time)),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close),
    }));
    candles = ha;
    setSeriesType('candles');
  } else if (type === 'bars') {
    setSeriesType('bars');
  } else {
    setSeriesType('candles');
  }

  candleSeries.setData(candles);
  chart.timeScale().fitContent();
  setStatus('Loaded');

  if (chkTrades.checked) await loadTradesOverlay(symbol);
}

async function loadMe() {
  try {
    const j = await apiGet('/v1/auth/me');
    const u = j?.user;
    if (!u) {
      userText.textContent = 'Not logged in';
      userPill.querySelector('.user-pill-dot').classList.remove('on');
      btnLogout.style.display = 'none';
      tradesHint.textContent = 'Login to see your trade history overlays.';
      settingsHint.textContent = 'Login to configure keys and risk limits.';
      btnSaveKey.disabled = true;
      btnReloadKeys.disabled = true;
      btnSaveRisk.disabled = true;
      btnTradingToggle.disabled = true;
      btnExecSignal.disabled = true;
      btnHalt.disabled = true;
      btnLiveExec.disabled = true;
      btnRefreshTasks.disabled = true;
      btnVerifyKey.disabled = true;
      tradingState.textContent = 'OFF';
      tradingState.classList.remove('on');
      tradingState.classList.add('off');
      return null;
    }
    userText.textContent = `${u.email || u.name || u.id} • ${u.tier}`;
    userPill.querySelector('.user-pill-dot').classList.add('on');
    btnLogout.style.display = '';
    tradesHint.textContent = 'Your trade history is shown below and on the chart.';
    settingsHint.textContent = 'Keys are encrypted and can’t be viewed again.';
    btnSaveKey.disabled = false;
    btnReloadKeys.disabled = false;
    btnSaveRisk.disabled = false;
    btnTradingToggle.disabled = false;
    btnExecSignal.disabled = false;
    btnHalt.disabled = false;
    btnLiveExec.disabled = false;
    btnRefreshTasks.disabled = false;
    btnVerifyKey.disabled = false;
    return u;
  } catch {
    return null;
  }
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
    // keys list is not rendered as a full list yet; we provide a hint
    const keyCount = Array.isArray(j?.keys) ? j.keys.length : 0;
    keysHint.textContent = keyCount ? `Saved keys: ${keyCount}. (Last4 only, never re-viewable)` : 'No keys saved yet.';
  } catch (e) {
    keysHint.textContent = `Settings unavailable: ${e.message}`;
  }
}

function setTradingUi(on) {
  tradingState.textContent = on ? 'ON' : 'OFF';
  tradingState.classList.toggle('on', on);
  tradingState.classList.toggle('off', !on);
  btnTradingToggle.textContent = on ? 'Disable trading' : 'Enable trading';
}

function clearTradesTable() {
  const rows = Array.from(tradesTable.querySelectorAll('.row.data'));
  for (const r of rows) r.remove();
  tradesEmpty.style.display = '';
}

function addTradeRow(t) {
  tradesEmpty.style.display = 'none';
  const row = document.createElement('div');
  row.className = 'row data';

  const entryTime = new Date(t.entryTime).toISOString().replace('T', ' ').slice(0, 19);
  const pnl = t.realizedPnlUsd;
  const pnlClass = pnl === null || pnl === undefined ? '' : (Number(pnl) >= 0 ? 'pnl-pos' : 'pnl-neg');

  let why = '';
  try {
    const r = JSON.parse(t.rationaleJson);
    why = r?.summary || r?.rationale || '';
    if (!why && typeof r === 'string') why = r;
  } catch {
    why = t.rationaleJson || '';
  }

  row.innerHTML = `
    <div>${entryTime}</div>
    <div>${t.symbol}</div>
    <div>${t.side}</div>
    <div>${fmt(t.entryPrice, 2)}</div>
    <div>${t.exitPrice ? fmt(t.exitPrice, 2) : ''}</div>
    <div class="${pnlClass}">${pnl === null || pnl === undefined ? '' : fmt(pnl, 2)}</div>
    <div class="why" title="${(why || '').replaceAll('"','&quot;')}">${why || ''}</div>
  `;
  tradesTable.appendChild(row);
}

async function loadTradesOverlay(symbol) {
  await loadMe(); // ensure auth state hint is up to date
  clearTradesTable();
  resetOverlays();

  setStatus('Loading trades…');
  let j;
  try {
    j = await apiGet(`/v1/trades?symbol=${encodeURIComponent(symbol)}&limit=200`);
  } catch (e) {
    setStatus('Trades: login required');
    return;
  }
  const trades = j?.trades || [];
  for (const t of trades) addTradeRow(t);

  if (!chkTrades.checked) {
    setStatus('Loaded');
    return;
  }

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
      text: `${side} entry`,
    });

    if (exitTs) {
      markers.push({
        time: exitTs,
        position: side === 'LONG' ? 'aboveBar' : 'belowBar',
        color: '#f7c94b',
        shape: 'circle',
        text: 'exit',
      });
    }

    if (exitTs && chkLines.checked && t.exitPrice) {
      const line = chart.addLineSeries({
        color: 'rgba(110,231,255,.35)',
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
  setStatus('Loaded');
}

btnLoad.addEventListener('click', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));
btnFit.addEventListener('click', () => chart.timeScale().fitContent());
typeSelect.addEventListener('change', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));
tfSelect.addEventListener('change', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));
chkTrades.addEventListener('change', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));
chkLines.addEventListener('change', () => loadCandles().catch((e) => setStatus(`Error: ${e.message}`)));

btnGoogle.addEventListener('click', () => (window.location.href = '/v1/auth/google/start'));
btnApple.addEventListener('click', () => (window.location.href = '/v1/auth/apple/start'));
btnLogout.addEventListener('click', async () => {
  try { await fetch('/v1/auth/logout', { method: 'POST', credentials: 'include' }); } catch {}
  await loadMe();
  settingsHint.textContent = 'Login to configure keys and risk limits.';
  clearTradesTable();
  resetOverlays();
});

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
    keysHint.textContent = `Saved. Key last4: ${j?.key?.apiKeyLast4 || '****'}. (Cannot be shown again)`;
    await loadSettings();
    setStatus('Saved');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

btnReloadKeys.addEventListener('click', async () => {
  await loadSettings();
});

btnSaveRisk.addEventListener('click', async () => {
  try {
    setStatus('Saving risk…');
    await apiJson('PUT', '/v1/settings/risk', {
      maxDailyLossUsd: riskDaily.value,
      maxOpenExposureUsd: riskExposure.value,
      maxConcurrentPositions: riskPositions.value,
    });
    await loadSettings();
    setStatus('Saved');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

btnTradingToggle.addEventListener('click', async () => {
  try {
    const next = tradingState.textContent !== 'ON';
    setStatus(next ? 'Enabling trading…' : 'Disabling trading…');
    const j = await apiJson('PUT', '/v1/settings/trading', { tradingEnabled: next });
    setTradingUi(Boolean(j?.tradingEnabled));
    setStatus('Saved');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

function makeIdempotency(prefix) {
  const rnd = Math.random().toString(16).slice(2);
  const t = Date.now().toString(16);
  return `${prefix}_${t}_${rnd}`.slice(0, 80);
}

btnExecSignal.addEventListener('click', async () => {
  try {
    const symbol = symbolInput.value.trim().toUpperCase();
    const tf = tfSelect.value;
    setStatus('Executing…');
    const j = await apiJson('POST', '/v1/trading/paper/execute-signal', {
      symbol,
      tf: tf === '5s' || tf === '15s' || tf === '30s' ? '1m' : tf, // analysis uses exchange tf best-effort
      orderUsd: 100,
      leverage: 5,
      idempotencyKey: makeIdempotency('exec'),
    });
    if (j.action === 'NO_TRADE') {
      execHint.textContent = `NO TRADE • tier=${j.tier} • conf=${j.decision?.confidence} • need>=${j.strictness?.confidenceThreshold}`;
      setStatus('No trade');
    } else {
      execHint.textContent = `OPENED • ${j.decision?.recommend} • conf=${j.decision?.confidence} • orderId=${j.orderId}`;
      setStatus('Opened (paper)');
      await loadTradesOverlay(symbol);
    }
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

btnHalt.addEventListener('click', async () => {
  try {
    setStatus('Halting…');
    await apiJson('POST', '/v1/trading/halt', { message: 'User requested halt from UI' });
    execHint.textContent = 'HALTED. Trading will refuse execution until cleared (admin).';
    setStatus('Halted');
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

async function refreshTasks() {
  try {
    const j = await apiGet('/v1/trading/tasks?limit=5');
    const tasks = j?.tasks || [];
    if (!tasks.length) {
      tasksHint.textContent = 'No tasks.';
      return;
    }
    const t = tasks[0];
    let extra = '';
    if (t.status === 'SUCCEEDED' && t.resultJson) {
      try {
        const r = JSON.parse(t.resultJson);
        if (r?.action) extra = ` • ${r.action}`;
        if (r?.dryRun) extra += ' • dry-run';
        if (r?.note) extra += ` • ${String(r.note).slice(0, 60)}`;
      } catch {
        // ignore
      }
    }
    tasksHint.textContent = `${t.status} • ${t.type} • attempts=${t.attempts}${extra}${t.lastError ? ` • ${t.lastError}` : ''}`;
  } catch (e) {
    tasksHint.textContent = `Tasks unavailable: ${e.message}`;
  }
}

btnLiveExec.addEventListener('click', async () => {
  try {
    const symbol = symbolInput.value.trim().toUpperCase();
    const tf = tfSelect.value;
    setStatus('Queueing live…');
    await apiJson('POST', '/v1/trading/live/execute-signal', {
      symbol,
      tf: tf === '5s' || tf === '15s' || tf === '30s' ? '1m' : tf,
      orderUsd: 100,
      leverage: 5,
      idempotencyKey: makeIdempotency('live_exec'),
    });
    setStatus('Queued');
    await refreshTasks();
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

btnRefreshTasks.addEventListener('click', () => refreshTasks());

btnVerifyKey.addEventListener('click', async () => {
  try {
    setStatus('Queueing verify…');
    await apiJson('POST', '/v1/trading/live/verify-key', {});
    setStatus('Queued');
    keyVerifyState.textContent = 'PENDING';
    keyVerifyState.classList.add('on');
    keyVerifyState.classList.remove('off');
    await refreshTasks();
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
});

// Tabs (visual only for now)
for (const b of document.querySelectorAll('.tab')) {
  b.addEventListener('click', () => {
    for (const x of document.querySelectorAll('.tab')) x.classList.remove('active');
    b.classList.add('active');
  });
}

initChart();
loadSettings().finally(() => {
  loadCandles().catch((e) => setStatus(`Error: ${e.message}`));
});

