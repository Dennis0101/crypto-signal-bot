export class TTLCache {
    ttl;
    m = new Map();
    constructor(ttl) {
        this.ttl = ttl;
    }
    get(k) {
        const e = this.m.get(k);
        if (!e)
            return;
        if (Date.now() > e.exp) {
            this.m.delete(k);
            return;
        }
        return e.v;
    }
    set(k, v) { this.m.set(k, { v, exp: Date.now() + this.ttl }); }
}
