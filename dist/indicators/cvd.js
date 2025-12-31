export function buildCVDandProfile(trades, tfMs, binAbs) {
    const buckets = new Map();
    for (const t of trades) {
        const k = Math.floor(t.time / tfMs) * tfMs;
        const b = buckets.get(k) || { buy: 0, sell: 0 };
        if (t.side === 'buy')
            b.buy += t.size;
        else
            b.sell += t.size;
        buckets.set(k, b);
    }
    const times = [...buckets.keys()].sort((a, b) => a - b);
    let cvd = 0;
    const cvdSeries = times.map(ts => {
        const { buy, sell } = buckets.get(ts);
        cvd += (buy - sell);
        return { time: ts, buy, sell, cvd };
    });
    const profile = new Map();
    for (const t of trades) {
        const bin = Math.round(t.price / binAbs) * binAbs;
        profile.set(bin, (profile.get(bin) || 0) + t.size);
    }
    const profileArr = [...profile.entries()]
        .map(([price, vol]) => ({ price, vol }))
        .sort((a, b) => a.price - b.price);
    return { cvdSeries, profile: profileArr };
}
