/* eslint-disable @typescript-eslint/no-explicit-any */
'use client';

import { useEffect, useMemo, useRef } from 'react';
import type { UTCTimestamp } from 'lightweight-charts';

type Candle = { time: number; open: number; high: number; low: number; close: number };

function toSec(ms: number) {
  return Math.floor(ms / 1000) as UTCTimestamp;
}

export function Chart(props: { symbol: string; tf: string; type: 'candles' | 'heikin' | 'bars'; showTrades: boolean; showLines: boolean }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const overlayRef = useRef<any[]>([]);

  const key = useMemo(() => `${props.symbol}:${props.tf}:${props.type}:${props.showTrades}:${props.showLines}`, [props]);

  useEffect(() => {
    let mounted = true;

    async function boot() {
      const container = containerRef.current;
      if (!container) return;

      const { createChart, CandlestickSeries, BarSeries, LineSeries } = await import('lightweight-charts');

      // reset
      container.innerHTML = '';
      chartRef.current = null;
      seriesRef.current = null;
      overlayRef.current = [];

      const chart = createChart(container, {
        layout: { background: { color: 'rgba(0,0,0,0)' }, textColor: '#cfe0f2' },
        grid: { vertLines: { color: 'rgba(38,60,84,.25)' }, horzLines: { color: 'rgba(38,60,84,.25)' } },
        rightPriceScale: { borderColor: 'rgba(38,60,84,.45)' },
        timeScale: { borderColor: 'rgba(38,60,84,.45)', timeVisible: true, secondsVisible: true },
        crosshair: { mode: 1 },
      });
      chartRef.current = chart;

      const series =
        props.type === 'bars'
          ? chart.addSeries(BarSeries, { upColor: '#2ee59d', downColor: '#ff4d6d' })
          : chart.addSeries(CandlestickSeries, {
              upColor: '#2ee59d',
              downColor: '#ff4d6d',
              borderUpColor: '#2ee59d',
              borderDownColor: '#ff4d6d',
              wickUpColor: 'rgba(46,229,157,.9)',
              wickDownColor: 'rgba(255,77,109,.9)',
            });
      seriesRef.current = series;

      const ro = new ResizeObserver(() => {
        chart.applyOptions({ width: container.clientWidth, height: container.clientHeight });
      });
      ro.observe(container);

      const res = await fetch(`/v1/market/candles?symbol=${encodeURIComponent(props.symbol)}&tf=${encodeURIComponent(props.tf)}&limit=600`, {
        credentials: 'include',
      });
      const json = await res.json();
      const raw: Candle[] = (json?.candles || []).map((c: any) => ({
        time: Number(c.time),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      }));

      const candles = props.type === 'heikin' ? toHeikin(raw) : raw;
      series.setData(candles.map((c) => ({ ...c, time: toSec(c.time) })));
      chart.timeScale().fitContent();

      if (props.showTrades) {
        const tRes = await fetch(`/v1/trades?symbol=${encodeURIComponent(props.symbol)}&limit=150`, { credentials: 'include' });
        if (tRes.ok) {
          const tj = await tRes.json();
          const trades = tj?.trades || [];
          const markers: any[] = [];
          const lines: any[] = [];

          for (const t of trades) {
            const entryTs = toSec(new Date(t.entryTime).getTime());
            const exitTs = t.exitTime ? toSec(new Date(t.exitTime).getTime()) : null;
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
            if (exitTs && props.showLines && t.exitPrice) {
              const line = chart.addSeries(LineSeries, {
                color: 'rgba(110,231,255,.30)',
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
          // Markers are supported on some series types (e.g. Candlestick).
          if ((series as any).setMarkers) {
            (series as any).setMarkers(markers);
          }
          overlayRef.current = lines;
        }
      }

      return () => ro.disconnect();
    }

    boot().catch(() => {});

    return () => {
      mounted = false;
      void mounted;
      try {
        for (const s of overlayRef.current) chartRef.current?.removeSeries?.(s);
        chartRef.current?.remove?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return <div ref={containerRef} className="h-[calc(100vh-56px-24px)] w-full" />;
}

function toHeikin(candles: Candle[]): Candle[] {
  const out: Candle[] = [];
  let prevOpen: number | null = null;
  let prevClose: number | null = null;
  for (const c of candles) {
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const base: number = prevClose === null ? haClose : prevClose;
    const haOpen: number = prevOpen === null ? (c.open + c.close) / 2 : (prevOpen + base) / 2;
    const haHigh = Math.max(c.high, haOpen, haClose);
    const haLow = Math.min(c.low, haOpen, haClose);
    out.push({ ...c, open: haOpen, high: haHigh, low: haLow, close: haClose });
    prevOpen = haOpen;
    prevClose = haClose;
  }
  return out;
}

