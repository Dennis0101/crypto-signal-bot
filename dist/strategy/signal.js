import { getLLMDecision } from '../clients/openai.js';
export function ruleDecision(f, cvd) {
    if (!isFinite(f.e20) || !isFinite(f.e50) || !isFinite(f.rsi)) {
        return { dir: 'NEUTRAL', conf: 40, hint: '데이터 부족' };
    }
    const cvdUp = (cvd?.length || 0) > 2 && cvd.at(-1).cvd > cvd.at(-2).cvd;
    if (f.e20 > f.e50 && f.rsi > 55) {
        return {
            dir: 'LONG',
            conf: 65 + (cvdUp ? 10 : 0),
            hint: `상승 우위(EMA+RSI${cvdUp ? '+CVD상방' : ''})`
        };
    }
    if (f.e20 < f.e50 && f.rsi < 45) {
        return {
            dir: 'SHORT',
            conf: 65 + (!cvdUp ? 10 : 0),
            hint: `하락 우위(EMA+RSI${!cvdUp ? '+CVD하방' : ''})`
        };
    }
    return { dir: 'NEUTRAL', conf: 50, hint: '횡보/혼조' };
}
function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}
function dirNorm(v) {
    if (!v)
        return undefined;
    const s = v.toUpperCase();
    if (s === 'LONG' || s === 'SHORT' || s === 'NEUTRAL')
        return s;
    return undefined;
}
export async function decide(symbol, tf, f, cvd, profile) {
    // 1) 규칙 판단
    const rule = ruleDecision(f, cvd);
    // 2) LLM 컨텍스트 생성
    const context = {
        cvdNow: cvd.at(-1)?.cvd ?? 0,
        cvdUp: cvd.length > 2 && cvd.at(-1).cvd > cvd.at(-2).cvd,
        topNodes: profile
            .slice()
            .sort((a, b) => b.vol - a.vol)
            .slice(0, 3),
    };
    // 3) LLM 요청 (실패해도 전체 로직은 규칙으로 진행)
    let llm = null;
    try {
        llm = await getLLMDecision({ symbol, tf, f, rule, context });
    }
    catch {
        /* LLM 실패는 무시하고 규칙으로 진행 */
    }
    // 4) 방향/신뢰도/레벨 결합
    const dir = dirNorm(llm?.direction) || rule.dir;
    const conf = clamp(Math.round(Number(llm?.confidence ?? rule.conf)), 1, 99);
    const levels = (() => {
        const ll = llm?.levels;
        if (ll && isFinite(ll.entry) && isFinite(ll.stop) && isFinite(ll.take_profit)) {
            return {
                entry: Number(ll.entry),
                stop: Number(ll.stop),
                take_profit: Number(ll.take_profit),
            };
        }
        // 기본 레벨(보수적으로)
        const entry = f.last;
        const stop = dir === 'LONG'
            ? entry * 0.985
            : dir === 'SHORT'
                ? entry * 1.015
                : entry * 0.995;
        const tp = dir === 'LONG'
            ? entry * 1.02
            : dir === 'SHORT'
                ? entry * 0.98
                : entry * 1.005;
        return { entry, stop, take_profit: tp };
    })();
    const risk = typeof llm?.risk === 'string' && llm.risk.trim().length > 0
        ? llm.risk
        : '변동성에 유의. 손절 필수.';
    // 5) 이유(reasons) 구성: 규칙 근거 + LLM 근거
    const reasons = [];
    // (a) 규칙 기반 근거 상세화
    if (isFinite(f.e20) && isFinite(f.e50)) {
        if (f.e20 > f.e50 * 1.001)
            reasons.push(`📈 EMA20(${f.e20.toFixed(2)}) > EMA50(${f.e50.toFixed(2)}) → 단기 상승 추세`);
        else if (f.e20 < f.e50 * 0.999)
            reasons.push(`📉 EMA20(${f.e20.toFixed(2)}) < EMA50(${f.e50.toFixed(2)}) → 단기 하락 추세`);
        else
            reasons.push(`〽️ EMA 수렴 → 방향성 약함`);
    }
    if (isFinite(f.rsi)) {
        const r = f.rsi;
        if (r >= 70)
            reasons.push(`🟠 RSI ${r.toFixed(1)} (과매수) → 눌림 위험`);
        else if (r <= 30)
            reasons.push(`🔵 RSI ${r.toFixed(1)} (과매도) → 반등 여지`);
        else if (r >= 55)
            reasons.push(`🟢 RSI ${r.toFixed(1)} (강세 영역)`);
        else if (r <= 45)
            reasons.push(`🔴 RSI ${r.toFixed(1)} (약세 영역)`);
        else
            reasons.push(`⚪ RSI ${r.toFixed(1)} (중립)`);
    }
    if (cvd.length >= 3) {
        const a = cvd.at(-3).cvd, b = cvd.at(-2).cvd, c = cvd.at(-1).cvd;
        const slope = (b - a) + (c - b);
        reasons.push(slope > 0 ? '🟢 CVD 상승(매수 우위)' :
            slope < 0 ? '🔴 CVD 하락(매도 우위)' :
                '⚪ CVD 중립');
    }
    if (context.topNodes.length) {
        const n = context.topNodes[0];
        if (n) {
            reasons.push(`🧱 대량 체결 존 ${n.price.toFixed(2)} (${Math.round(n.vol)}), ` +
                `${f.last >= n.price ? '지지 가능' : '저항 가능'}`);
        }
    }
    // (b) LLM이 이유를 주면 병합
    if (Array.isArray(llm?.reasons) && llm.reasons.length) {
        for (const r of llm.reasons) {
            const s = String(r).trim();
            if (s && !reasons.includes(s))
                reasons.push(s);
        }
    }
    else if (typeof llm?.rationale === 'string' && llm.rationale.trim()) {
        const s = llm.rationale.trim();
        if (!reasons.includes(s))
            reasons.push(s);
    }
    // 6) 요약 문장(LLM 우선, 없으면 규칙 hint)
    const rationale = (typeof llm?.rationale === 'string' && llm.rationale.trim()) ||
        rule.hint ||
        '특이 신호 없음';
    const source = llm ? 'HYBRID' : 'RULE';
    return {
        recommend: dir,
        confidence: conf,
        reasons,
        rationale,
        levels,
        risk,
        source,
    };
}
