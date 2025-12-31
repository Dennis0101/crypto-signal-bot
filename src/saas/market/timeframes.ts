export type Timeframe =
  | '5s'
  | '15s'
  | '30s'
  | '1m'
  | '3m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | '1d'
  | '1w'
  | '1M'
  | '1y';

export function timeframeToMs(tf: Timeframe): number | null {
  switch (tf) {
    case '5s':
      return 5_000;
    case '15s':
      return 15_000;
    case '30s':
      return 30_000;
    case '1m':
      return 60_000;
    case '3m':
      return 180_000;
    case '5m':
      return 300_000;
    case '15m':
      return 900_000;
    case '30m':
      return 1_800_000;
    case '1h':
      return 3_600_000;
    case '4h':
      return 14_400_000;
    case '1d':
      return 86_400_000;
    case '1w':
      return 604_800_000;
    case '1M':
      return 2_592_000_000; // 30d approx (charting only)
    case '1y':
      return 31_536_000_000; // 365d (charting only)
    default:
      return null;
  }
}

