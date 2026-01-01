import type { PropsWithChildren } from 'react';

export function Card(props: PropsWithChildren<{ className?: string }>) {
  return (
    <div className={`rounded-2xl border border-[color:var(--line)] bg-[color:var(--panel)] shadow-card ${props.className ?? ''}`}>
      {props.children}
    </div>
  );
}

export function CardHeader(props: PropsWithChildren<{ className?: string }>) {
  return <div className={`flex items-center justify-between px-3 py-3 ${props.className ?? ''}`}>{props.children}</div>;
}

export function CardBody(props: PropsWithChildren<{ className?: string }>) {
  return <div className={`px-3 pb-3 ${props.className ?? ''}`}>{props.children}</div>;
}

export function Title(props: PropsWithChildren<{ className?: string }>) {
  return <div className={`text-sm font-extrabold tracking-wide ${props.className ?? ''}`}>{props.children}</div>;
}

export function Muted(props: PropsWithChildren<{ className?: string }>) {
  return <div className={`text-xs text-[color:var(--muted)] ${props.className ?? ''}`}>{props.children}</div>;
}

export function Pill(props: PropsWithChildren<{ tone?: 'neutral' | 'good' | 'bad' | 'warn'; className?: string }>) {
  const tone = props.tone ?? 'neutral';
  const cls =
    tone === 'good'
      ? 'border-[rgba(46,229,157,.28)] bg-[rgba(46,229,157,.10)] text-[color:var(--green)]'
      : tone === 'bad'
        ? 'border-[rgba(255,77,109,.28)] bg-[rgba(255,77,109,.10)] text-[color:var(--red)]'
        : tone === 'warn'
          ? 'border-[rgba(247,201,75,.28)] bg-[rgba(247,201,75,.10)] text-[color:var(--amber)]'
          : 'border-[color:var(--line)] bg-black/35 text-[color:var(--muted)]';
  return (
    <div className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-extrabold ${cls} ${props.className ?? ''}`}>
      {props.children}
    </div>
  );
}

export function Chip(props: PropsWithChildren<{ active?: boolean; onClick?: () => void; className?: string }>) {
  const active = Boolean(props.active);
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={[
        'h-8 rounded-full border px-3 text-xs font-extrabold transition',
        active
          ? 'border-[rgba(110,231,255,.30)] bg-[rgba(110,231,255,.10)] text-[color:var(--text)]'
          : 'border-[color:var(--line)] bg-black/30 text-[color:var(--muted)] hover:border-[rgba(110,231,255,.22)]',
        props.className ?? '',
      ].join(' ')}
    >
      {props.children}
    </button>
  );
}

