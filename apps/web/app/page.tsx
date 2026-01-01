'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from '../components/Chart';
import { apiGet, apiJson } from '../lib/api';
import { Card, CardBody, CardHeader, Chip, Muted, Pill, Title } from '../components/ui';

type CType = 'candles' | 'heikin' | 'bars';

const TF_ALL = ['5s', '15s', '30s', '1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M', '1y'] as const;
type TF = (typeof TF_ALL)[number];
const TF_PRIMARY: TF[] = ['1m', '5m', '15m', '1h', '4h', '1d'];

type User = { id: string; email?: string | null; name?: string | null; tier: 'BASIC' | 'PRO' | 'VIP' };
type Trade = {
  id: string;
  symbol: string;
  side: 'LONG' | 'SHORT';
  status: 'OPEN' | 'CLOSED' | 'LIQUIDATED';
  entryTime: string;
  entryPrice: string;
  entryQty: string;
  exitTime?: string | null;
  exitPrice?: string | null;
  realizedPnlUsd?: string | null;
  rationaleJson: string;
};

export default function Page() {
  const [symbol, setSymbol] = useState('BTCUSDT');
  const [tf, setTf] = useState<TF>('1m');
  const [type, setType] = useState<CType>('candles');
  const [showTrades, setShowTrades] = useState(true);
  const [showLines, setShowLines] = useState(true);

  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<string>('Ready');

  const [rightTab, setRightTab] = useState<'auto' | 'risk'>('auto');
  const [bottomTab, setBottomTab] = useState<'trades' | 'tasks'>('trades');

  const [signal, setSignal] = useState<{
    action: 'NO_TRADE' | 'TRADE_CANDIDATE' | '—';
    recommend: 'LONG' | 'SHORT' | 'NEUTRAL' | '—';
    confidence?: number;
    why?: string;
    tier?: string;
    threshold?: number;
  }>({ action: '—', recommend: '—' });

  const [tradingEnabled, setTradingEnabled] = useState(false);
  const [risk, setRisk] = useState({ maxDailyLossUsd: 100, maxOpenExposureUsd: 200, maxConcurrentPositions: 1 });
  const [keySummary, setKeySummary] = useState<{ count: number; hint: string }>({ count: 0, hint: 'No keys.' });
  const [msg, setMsg] = useState<string>('');

  const [trades, setTrades] = useState<Trade[]>([]);
  const [tasks, setTasks] = useState<any[]>([]);

  const lastAnalyzeKey = useRef<string>('');

  const chartProps = useMemo(() => ({ symbol, tf, type, showTrades, showLines }), [symbol, tf, type, showTrades, showLines]);

  useEffect(() => {
    apiGet<{ user: User | null }>('/v1/auth/me')
      .then((j) => setUser(j.user))
      .catch(() => setUser(null));
  }, []);

  useEffect(() => {
    if (!user) return;
    apiGet<any>('/v1/settings')
      .then((j) => {
        setTradingEnabled(Boolean(j?.risk?.tradingEnabled));
        setRisk({
          maxDailyLossUsd: Number(j?.risk?.maxDailyLossUsd ?? 100),
          maxOpenExposureUsd: Number(j?.risk?.maxOpenExposureUsd ?? 200),
          maxConcurrentPositions: Number(j?.risk?.maxConcurrentPositions ?? 1),
        });
        const cnt = Array.isArray(j?.keys) ? j.keys.length : 0;
        setKeySummary({ count: cnt, hint: cnt ? `Keys: ${cnt} (last4 only)` : 'No keys.' });
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    if (!showTrades) return;
    if (!user) return;
    apiGet<{ trades: Trade[] }>(`/v1/trades?symbol=${encodeURIComponent(symbol)}&limit=50`)
      .then((j) => setTrades(j.trades || []))
      .catch(() => setTrades([]));
  }, [user, symbol, showTrades]);

  useEffect(() => {
    if (!user) return;
    apiGet<{ tasks: any[] }>(`/v1/trading/tasks?limit=20`)
      .then((j) => setTasks(j.tasks || []))
      .catch(() => setTasks([]));
  }, [user]);

  function normalizeTfForAnalysis(x: TF): TF {
    return x === '5s' || x === '15s' || x === '30s' ? '1m' : x;
  }

  async function analyze() {
    setMsg('');
    const sym = symbol.trim().toUpperCase();
    const tf2 = normalizeTfForAnalysis(tf);
    const key = `${sym}:${tf2}:${Date.now()}`;
    lastAnalyzeKey.current = key;
    setStatus('Analyzing…');
    try {
      const j = await apiGet<any>(`/v1/analysis/signal?symbol=${encodeURIComponent(sym)}&tf=${encodeURIComponent(tf2)}`);
      if (lastAnalyzeKey.current !== key) return;
      const d = j?.decision;
      const reasons: string[] = Array.isArray(d?.reasons) ? d.reasons : [];
      setSignal({
        action: j?.action ?? '—',
        recommend: d?.recommend ?? '—',
        confidence: typeof d?.confidence === 'number' ? d.confidence : undefined,
        why: reasons[0] || d?.rationale || '',
        tier: j?.tier,
        threshold: j?.strictness?.confidenceThreshold,
      });
      setStatus('Ready');
    } catch (e: any) {
      setSignal({ action: '—', recommend: '—', why: String(e?.message ?? e) });
      setStatus('Ready');
    }
  }

  async function executePaper() {
    setMsg('');
    setStatus('Executing…');
    try {
      const sym = symbol.trim().toUpperCase();
      const tf2 = normalizeTfForAnalysis(tf);
      const idKey = `exec_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`.slice(0, 80);
      const j = await apiJson<any>('POST', '/v1/trading/paper/execute-signal', {
        symbol: sym,
        tf: tf2,
        orderUsd: 100,
        leverage: 5,
        idempotencyKey: idKey,
      });
      if (j?.action === 'NO_TRADE') {
        setMsg(`NO TRADE • conf=${j?.decision?.confidence} • need>=${j?.strictness?.confidenceThreshold}`);
      } else {
        setMsg(`OPENED (paper) • orderId=${j?.orderId}`);
      }
      setStatus('Ready');
      // refresh trades overlay/list
      apiGet<{ trades: Trade[] }>(`/v1/trades?symbol=${encodeURIComponent(sym)}&limit=50`)
        .then((r) => setTrades(r.trades || []))
        .catch(() => {});
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
      setStatus('Ready');
    }
  }

  async function queueLive() {
    setMsg('');
    setStatus('Queueing…');
    try {
      const sym = symbol.trim().toUpperCase();
      const tf2 = normalizeTfForAnalysis(tf);
      const idKey = `live_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`.slice(0, 80);
      await apiJson<any>('POST', '/v1/trading/live/execute-signal', { symbol: sym, tf: tf2, orderUsd: 100, leverage: 5, idempotencyKey: idKey });
      setMsg('Queued (live). See Tasks.');
      setStatus('Ready');
      apiGet<{ tasks: any[] }>(`/v1/trading/tasks?limit=20`)
        .then((r) => setTasks(r.tasks || []))
        .catch(() => {});
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
      setStatus('Ready');
    }
  }

  async function halt() {
    setMsg('');
    setStatus('Halting…');
    try {
      await apiJson('POST', '/v1/trading/halt', { message: 'User requested halt from Next UI' });
      setMsg('HALTED');
      setStatus('Ready');
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
      setStatus('Ready');
    }
  }

  async function saveRisk() {
    setMsg('');
    setStatus('Saving…');
    try {
      await apiJson('PUT', '/v1/settings/risk', {
        maxDailyLossUsd: risk.maxDailyLossUsd,
        maxOpenExposureUsd: risk.maxOpenExposureUsd,
        maxConcurrentPositions: risk.maxConcurrentPositions,
      });
      setMsg('Saved risk limits.');
      setStatus('Ready');
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
      setStatus('Ready');
    }
  }

  async function toggleTrading() {
    setMsg('');
    setStatus(tradingEnabled ? 'Disabling…' : 'Enabling…');
    try {
      const j = await apiJson<any>('PUT', '/v1/settings/trading', { tradingEnabled: !tradingEnabled });
      setTradingEnabled(Boolean(j?.tradingEnabled));
      setMsg(Boolean(j?.tradingEnabled) ? 'Trading enabled.' : 'Trading disabled.');
      setStatus('Ready');
    } catch (e: any) {
      setMsg(String(e?.message ?? e));
      setStatus('Ready');
    }
  }

  const userLabel = user ? `${user.email || user.name || user.id} • ${user.tier}` : 'Not logged in';

  return (
    <div className="min-h-screen">
      <header className="h-14 border-b border-[color:var(--line)] bg-black/40 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-3 px-3">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-accent shadow-[0_0_0_6px_rgba(110,231,255,.07)]" />
            <div className="leading-tight">
              <div className="text-sm font-extrabold tracking-wide">Trading</div>
              <div className="text-[11px] text-[color:var(--muted)]">security-first</div>
            </div>
          </div>

          <div className="ml-4 flex flex-1 items-center gap-2">
            <input
              className="ctl w-36 font-mono text-sm"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void analyze();
              }}
            />
            <div className="hidden items-center gap-1 lg:flex">
              {TF_PRIMARY.map((x) => (
                <Chip key={x} active={tf === x} onClick={() => setTf(x)}>
                  {x}
                </Chip>
              ))}
            </div>
            <select className="ctl w-24" value={tf} onChange={(e) => setTf(e.target.value as TF)} aria-label="Timeframe">
              {TF_ALL.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
            <select className="ctl w-28" value={type} onChange={(e) => setType(e.target.value as CType)} aria-label="Chart type">
              <option value="candles">Candles</option>
              <option value="heikin">Heikin</option>
              <option value="bars">Bars</option>
            </select>

            <div className="ml-2 flex items-center gap-3 text-xs text-[color:var(--muted)]">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showTrades} onChange={(e) => setShowTrades(e.target.checked)} />
                Trades
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)} />
                Lines
              </label>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="rounded-full border border-[color:var(--line)] bg-black/35 px-3 py-2 text-xs text-[color:var(--muted)]">
              {userLabel}
            </div>
            <a className="btn btn-ghost" href="/v1/auth/google/start">
              Google
            </a>
            <a className="btn btn-ghost" href="/v1/auth/apple/start">
              Apple
            </a>
            <button
              className="btn btn-danger"
              onClick={() => {
                fetch('/v1/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => location.reload());
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] grid-cols-12 gap-3 px-3 pt-3">
        {/* Chart */}
        <section className="col-span-9 overflow-hidden rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] shadow-soft">
          <div className="flex h-10 items-center justify-between border-b border-[rgba(38,60,84,.35)] px-3">
            <div className="flex items-center gap-2">
              <div className="rounded-full border border-[rgba(110,231,255,.22)] bg-[rgba(110,231,255,.10)] px-3 py-1 text-xs font-extrabold">
                {symbol}
              </div>
              <div className="text-xs text-[color:var(--muted)]">{status}</div>
              {msg ? <div className="ml-2 text-xs text-[color:var(--muted)]">• {msg}</div> : null}
            </div>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost" onClick={() => void analyze()}>
                Analyze
              </button>
              <button className="btn" onClick={() => void executePaper()} disabled={!user}>
                Execute
              </button>
            </div>
          </div>
          <Chart {...chartProps} />
        </section>

        {/* Right panel */}
        <aside className="col-span-3 space-y-3">
          <div className="flex gap-2">
            <Chip active={rightTab === 'auto'} onClick={() => setRightTab('auto')} className="flex-1">
              Auto
            </Chip>
            <Chip active={rightTab === 'risk'} onClick={() => setRightTab('risk')} className="flex-1">
              Risk
            </Chip>
          </div>

          {rightTab === 'auto' ? (
            <Card>
              <CardHeader>
                <Title>Auto</Title>
                <Pill tone={signal.action === 'TRADE_CANDIDATE' ? 'good' : signal.action === 'NO_TRADE' ? 'warn' : 'neutral'}>
                  {signal.action === '—' ? 'IDLE' : signal.action}
                </Pill>
              </CardHeader>
              <CardBody>
                <div className="rounded-xl border border-[rgba(38,60,84,.35)] bg-black/30 p-3">
                  <div className="flex items-baseline justify-between">
                    <div className="text-base font-extrabold tracking-wide">{signal.recommend}</div>
                    <div className="text-xs text-[color:var(--muted)]">
                      {typeof signal.confidence === 'number' ? `${signal.confidence}%` : '—'}
                      {signal.threshold ? ` • need>=${signal.threshold}` : ''}
                    </div>
                  </div>
                  <div className="mt-2 line-clamp-2 text-xs text-[color:var(--muted)]">{signal.why || 'Click Analyze.'}</div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn btn-ghost" onClick={() => void analyze()}>
                    Analyze
                  </button>
                  <button className="btn" onClick={() => void executePaper()} disabled={!user}>
                    Execute (paper)
                  </button>
                  <button className="btn btn-ghost" onClick={() => void queueLive()} disabled={!user}>
                    Queue (live)
                  </button>
                  <button className="btn btn-danger" onClick={() => void halt()} disabled={!user}>
                    Halt
                  </button>
                </div>

                <div className="mt-3">
                  <Muted>Trading: {tradingEnabled ? 'enabled' : 'disabled'} • {keySummary.hint}</Muted>
                </div>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <Title>Risk</Title>
                <Pill tone={tradingEnabled ? 'good' : 'bad'}>{tradingEnabled ? 'TRADING ON' : 'TRADING OFF'}</Pill>
              </CardHeader>
              <CardBody>
                <div className="grid gap-2">
                  <label className="grid gap-1">
                    <span className="text-[11px] text-[color:var(--muted)]">Max daily loss (USD)</span>
                    <input
                      className="ctl w-full"
                      value={risk.maxDailyLossUsd}
                      onChange={(e) => setRisk((r) => ({ ...r, maxDailyLossUsd: Number(e.target.value || 0) }))}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] text-[color:var(--muted)]">Max exposure (USD)</span>
                    <input
                      className="ctl w-full"
                      value={risk.maxOpenExposureUsd}
                      onChange={(e) => setRisk((r) => ({ ...r, maxOpenExposureUsd: Number(e.target.value || 0) }))}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[11px] text-[color:var(--muted)]">Max positions</span>
                    <input
                      className="ctl w-full"
                      value={risk.maxConcurrentPositions}
                      onChange={(e) => setRisk((r) => ({ ...r, maxConcurrentPositions: Number(e.target.value || 0) }))}
                    />
                  </label>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button className="btn btn-ghost" onClick={() => void toggleTrading()} disabled={!user}>
                    {tradingEnabled ? 'Disable' : 'Enable'}
                  </button>
                  <button className="btn" onClick={() => void saveRisk()} disabled={!user}>
                    Save
                  </button>
                </div>
                <div className="mt-3">
                  <Muted>Keys are encrypted and never re-viewable.</Muted>
                </div>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <Title>Bottom</Title>
              <div className="flex gap-2">
                <Chip active={bottomTab === 'trades'} onClick={() => setBottomTab('trades')}>
                  Trades
                </Chip>
                <Chip active={bottomTab === 'tasks'} onClick={() => setBottomTab('tasks')}>
                  Tasks
                </Chip>
              </div>
            </CardHeader>
            <CardBody className="pt-0">
              {bottomTab === 'trades' ? (
                <div className="space-y-2">
                  {!user ? (
                    <Muted>Login to view trades.</Muted>
                  ) : trades.length === 0 ? (
                    <Muted>No trades.</Muted>
                  ) : (
                    trades.slice(0, 8).map((t) => {
                      const pnl = t.realizedPnlUsd ? Number(t.realizedPnlUsd) : null;
                      const tone = pnl === null ? 'neutral' : pnl >= 0 ? 'good' : 'bad';
                      const when = new Date(t.entryTime).toISOString().slice(11, 19);
                      return (
                        <div key={t.id} className="rounded-xl border border-[rgba(38,60,84,.35)] bg-black/25 p-2">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-extrabold">
                              {t.symbol} • {t.side}
                            </div>
                            <Pill tone={tone as any} className="h-7 px-2">
                              {pnl === null ? '—' : pnl.toFixed(2)}
                            </Pill>
                          </div>
                          <div className="mt-1 text-[11px] text-[color:var(--muted)]">{when} • entry {Number(t.entryPrice).toFixed(2)}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {!user ? (
                    <Muted>Login to view tasks.</Muted>
                  ) : tasks.length === 0 ? (
                    <Muted>No tasks.</Muted>
                  ) : (
                    tasks.slice(0, 6).map((t: any) => (
                      <div key={t.id} className="rounded-xl border border-[rgba(38,60,84,.35)] bg-black/25 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-extrabold">{t.type}</div>
                          <Pill tone={t.status === 'SUCCEEDED' ? 'good' : t.status === 'FAILED' ? 'bad' : 'neutral'} className="h-7 px-2">
                            {t.status}
                          </Pill>
                        </div>
                        <div className="mt-1 text-[11px] text-[color:var(--muted)]">
                          attempts={t.attempts}
                          {t.lastError ? ` • ${String(t.lastError).slice(0, 70)}` : ''}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </CardBody>
          </Card>
        </aside>
      </main>
    </div>
  );
}

