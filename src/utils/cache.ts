export class TTLCache<K, V> {
  private m = new Map<K, { v: V; exp: number }>();
  constructor(private ttl: number) {}
  get(k: K): V | undefined {
    const e = this.m.get(k);
    if (!e) return;
    if (Date.now() > e.exp) { this.m.delete(k); return; }
    return e.v;
  }
  set(k: K, v: V) { this.m.set(k, { v, exp: Date.now() + this.ttl }); }
}
