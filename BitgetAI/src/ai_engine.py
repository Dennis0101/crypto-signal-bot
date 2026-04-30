# ============================================================
#  AlphaBrain Pro - AI 분석 엔진 v2
#  기술적 지표 + 시장 레짐 감지 + RandomForest ML
#
#  추가된 지표:
#    ADX (추세 강도)  ·  Supertrend (동적 지지/저항)
#    VWAP (기관 기준선)  ·  CMF (차이킨 머니플로우)
#    MFI (머니플로우 인덱스)  ·  Pivot Points (일봉 S/R)
#    Keltner Channel  ·  Elder Ray
#  개선 사항:
#    - 시장 레짐(추세/횡보) 감지 → 임계값 동적 조정
#    - ATR 기반 변동성 필터 (횡보 시 신호 억제)
#    - 배당 가중치 앙상블 점수
#    - config min_score 연동 (하드코딩 제거)
# ============================================================

import numpy as np
import pandas as pd
import warnings
import os
import joblib
import time

from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

import sys as _sys

warnings.filterwarnings('ignore')

# EXE(frozen) 환경에서는 exe 옆 폴더, 개발 환경에서는 프로젝트 루트
_BASE      = os.path.dirname(_sys.executable) if getattr(_sys, 'frozen', False) \
             else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_PATH = os.path.join(_BASE, 'model.joblib')

LONG  = 'LONG'
SHORT = 'SHORT'
HOLD  = 'HOLD'


class AIEngine:
    """
    강화된 AI 트레이딩 신호 생성기

    지표: RSI · MACD · BB · EMA · ATR · Stochastic · OBV
          ADX · Supertrend · VWAP · CMF · MFI · Keltner · Elder Ray
    레짐: ADX 기반 추세/횡보 자동 감지
    ML:   RandomForest Pipeline (StandardScaler + RF)
    """

    def __init__(self):
        self.model: Pipeline | None = None
        self.model_trained = False
        self.feature_cols: list = []
        self.last_train_time = None

    # ══════════════════════════════════════════════════════════
    # ① 기술적 지표 계산
    # ══════════════════════════════════════════════════════════

    def calculate_indicators(self, df: pd.DataFrame) -> pd.DataFrame:
        """OHLCV DataFrame에 전체 기술적 지표 추가"""
        d = df.copy()
        close = d['close']
        high  = d['high']
        low   = d['low']
        vol   = d['volume']
        n     = len(d)

        # ── RSI (14) ──────────────────────────────────────────
        delta    = close.diff()
        avg_gain = delta.clip(lower=0).ewm(com=13, adjust=False).mean()
        avg_loss = (-delta).clip(lower=0).ewm(com=13, adjust=False).mean()
        d['rsi'] = 100 - (100 / (1 + avg_gain / (avg_loss + 1e-10)))

        # ── MACD (12, 26, 9) ─────────────────────────────────
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        d['macd']        = ema12 - ema26
        d['macd_signal'] = d['macd'].ewm(span=9, adjust=False).mean()
        d['macd_hist']   = d['macd'] - d['macd_signal']

        # ── 볼린저 밴드 (20, 2) ───────────────────────────────
        bb_mid = close.rolling(20).mean()
        bb_std = close.rolling(20).std()
        d['bb_upper'] = bb_mid + 2 * bb_std
        d['bb_lower'] = bb_mid - 2 * bb_std
        d['bb_mid']   = bb_mid
        d['bb_pct']   = (close - d['bb_lower']) / (d['bb_upper'] - d['bb_lower'] + 1e-10)
        d['bb_width'] = (d['bb_upper'] - d['bb_lower']) / (bb_mid + 1e-10)

        # ── EMA ───────────────────────────────────────────────
        d['ema9']  = close.ewm(span=9,   adjust=False).mean()
        d['ema21'] = close.ewm(span=21,  adjust=False).mean()
        d['ema50'] = close.ewm(span=50,  adjust=False).mean()
        d['ema200']= close.ewm(span=200, adjust=False).mean()
        d['ema9_slope']  = d['ema9'].diff(3)  / (d['ema9'].shift(3)  + 1e-10)
        d['ema21_slope'] = d['ema21'].diff(3) / (d['ema21'].shift(3) + 1e-10)
        d['ema_cross_9_21']  = (d['ema9']  - d['ema21']) / (d['ema21'] + 1e-10)
        d['ema_cross_21_50'] = (d['ema21'] - d['ema50']) / (d['ema50'] + 1e-10)

        # ── ATR (14) ──────────────────────────────────────────
        tr = pd.concat([
            high - low,
            (high - close.shift()).abs(),
            (low  - close.shift()).abs()
        ], axis=1).max(axis=1)
        d['atr']     = tr.ewm(com=13, adjust=False).mean()
        d['atr_pct'] = d['atr'] / (close + 1e-10)

        # ── 스토캐스틱 (14, 3) ────────────────────────────────
        low14  = low.rolling(14).min()
        high14 = high.rolling(14).max()
        d['stoch_k'] = 100 * (close - low14) / (high14 - low14 + 1e-10)
        d['stoch_d'] = d['stoch_k'].rolling(3).mean()

        # ── 거래량 지표 ───────────────────────────────────────
        d['vol_ma20']  = vol.rolling(20).mean()
        d['vol_ratio'] = vol / (d['vol_ma20'] + 1e-10)

        # OBV
        obv = [0.0]
        for i in range(1, n):
            if   close.iloc[i] > close.iloc[i-1]: obv.append(obv[-1] + vol.iloc[i])
            elif close.iloc[i] < close.iloc[i-1]: obv.append(obv[-1] - vol.iloc[i])
            else:                                  obv.append(obv[-1])
        obv_s = pd.Series(obv, index=d.index)
        d['obv']        = obv_s
        d['obv_ma']     = obv_s.rolling(20).mean()
        d['obv_signal'] = (obv_s - d['obv_ma']) / (d['obv_ma'].abs() + 1e-10)

        # ── 수익률 ────────────────────────────────────────────
        d['ret_1']  = close.pct_change(1)
        d['ret_3']  = close.pct_change(3)
        d['ret_7']  = close.pct_change(7)
        d['ret_14'] = close.pct_change(14)

        # ── CCI (20) ──────────────────────────────────────────
        typical  = (high + low + close) / 3
        tp_ma    = typical.rolling(20).mean()
        tp_std   = typical.rolling(20).std()
        d['cci'] = (typical - tp_ma) / (0.015 * tp_std + 1e-10)

        # ── Williams %R (14) ─────────────────────────────────
        d['williams_r'] = -100 * (high14 - close) / (high14 - low14 + 1e-10)

        # ════════════════════════════════════════════════════
        # ▼ 강화된 신규 지표
        # ════════════════════════════════════════════════════

        # ── ADX (14) — 추세 강도 ─────────────────────────────
        #   ADX < 20: 횡보  |  20~40: 중간  |  > 40: 강한 추세
        up   = high.diff()
        down = -low.diff()
        dm_plus  = pd.Series(np.where((up > down) & (up > 0), up, 0.0), index=d.index)
        dm_minus = pd.Series(np.where((down > up) & (down > 0), down, 0.0), index=d.index)
        tr14     = tr.ewm(com=13, adjust=False).mean()
        di_plus  = 100 * dm_plus.ewm(com=13,  adjust=False).mean() / (tr14 + 1e-10)
        di_minus = 100 * dm_minus.ewm(com=13, adjust=False).mean() / (tr14 + 1e-10)
        dx       = 100 * (di_plus - di_minus).abs() / (di_plus + di_minus + 1e-10)
        d['adx']      = dx.ewm(com=13, adjust=False).mean()
        d['di_plus']  = di_plus
        d['di_minus'] = di_minus

        # ── Supertrend (10, 3) — 동적 추세 지지/저항 ─────────
        st_mult   = 3.0
        st_period = 10
        atr_st    = tr.rolling(st_period).mean()
        hl_mid    = (high + low) / 2

        # numpy 배열로 연산 (pandas .iloc 루프 대비 ~10x 빠름, pandas 2.x 경고 없음)
        up_arr    = (hl_mid + st_mult * atr_st).values.copy()
        dn_arr    = (hl_mid - st_mult * atr_st).values.copy()
        close_arr = close.values

        supertrend = np.full(n, np.nan)
        direction  = np.ones(n, dtype=np.int8)

        for i in range(1, n):
            if np.isnan(up_arr[i]) or np.isnan(dn_arr[i]):
                direction[i] = direction[i-1]
                continue
            prev_up = up_arr[i-1] if not np.isnan(up_arr[i-1]) else up_arr[i]
            prev_dn = dn_arr[i-1] if not np.isnan(dn_arr[i-1]) else dn_arr[i]

            if close_arr[i-1] <= prev_up:
                up_arr[i] = min(up_arr[i], prev_up)
            if close_arr[i-1] >= prev_dn:
                dn_arr[i] = max(dn_arr[i], prev_dn)

            if direction[i-1] == -1 and close_arr[i] > up_arr[i]:
                direction[i] = 1
            elif direction[i-1] == 1 and close_arr[i] < dn_arr[i]:
                direction[i] = -1
            else:
                direction[i] = direction[i-1]

            supertrend[i] = dn_arr[i] if direction[i] == 1 else up_arr[i]

        d['supertrend']     = supertrend
        d['supertrend_dir'] = direction.astype(float)  # 1 = 상승, -1 = 하락
        d['st_dist']        = (close - pd.Series(supertrend, index=d.index)) / (close + 1e-10)

        # ── VWAP (롤링 50봉 — 누적 방식은 장기 드리프트로 신호 오염)
        tp_vol = typical * vol
        d['vwap'] = tp_vol.rolling(50).sum() / (vol.rolling(50).sum() + 1e-10)
        d['vwap_dist'] = (close - d['vwap']) / (d['vwap'] + 1e-10)

        # ── CMF (차이킨 머니플로우, 20) ───────────────────────
        mf_mult   = ((close - low) - (high - close)) / (high - low + 1e-10)
        mf_vol    = mf_mult * vol
        d['cmf']  = mf_vol.rolling(20).sum() / (vol.rolling(20).sum() + 1e-10)

        # ── MFI (머니플로우 인덱스, 14) ──────────────────────
        tp_chg    = typical.diff()
        pos_mf    = (typical * vol).where(tp_chg > 0, 0.0).rolling(14).sum()
        neg_mf    = (typical * vol).where(tp_chg < 0, 0.0).rolling(14).sum()
        d['mfi']  = 100 - (100 / (1 + pos_mf / (neg_mf + 1e-10)))

        # ── Keltner Channel (20, 2×ATR) ──────────────────────
        kc_mid     = close.ewm(span=20, adjust=False).mean()
        kc_atr     = d['atr']
        d['kc_upper'] = kc_mid + 2 * kc_atr
        d['kc_lower'] = kc_mid - 2 * kc_atr
        d['kc_pct']   = (close - d['kc_lower']) / (d['kc_upper'] - d['kc_lower'] + 1e-10)

        # BB와 KC 비교 — Squeeze 감지 (BB < KC → 에너지 압축)
        d['squeeze'] = ((d['bb_upper'] < d['kc_upper']) &
                        (d['bb_lower'] > d['kc_lower'])).astype(float)

        # ── Elder Ray ────────────────────────────────────────
        ema13           = close.ewm(span=13, adjust=False).mean()
        d['bull_power'] = high - ema13
        d['bear_power'] = low  - ema13
        d['bull_power_norm'] = d['bull_power'] / (d['atr'] + 1e-10)
        d['bear_power_norm'] = d['bear_power'] / (d['atr'] + 1e-10)

        # ── 피벗 포인트 거리 (최근 20봉 고/저/종 기준) ─────────
        pivot     = (high.rolling(20).max() + low.rolling(20).min() + close.rolling(20).mean()) / 3
        d['pivot_dist'] = (close - pivot) / (pivot + 1e-10)

        return d

    # ══════════════════════════════════════════════════════════
    # ② Feature 컬럼 목록
    # ══════════════════════════════════════════════════════════

    def _get_feature_cols(self) -> list:
        return [
            # 기존
            'rsi', 'macd', 'macd_signal', 'macd_hist',
            'bb_pct', 'bb_width',
            'ema_cross_9_21', 'ema_cross_21_50',
            'ema9_slope', 'ema21_slope',
            'atr_pct',
            'stoch_k', 'stoch_d',
            'vol_ratio', 'obv_signal',
            'ret_1', 'ret_3', 'ret_7', 'ret_14',
            'cci', 'williams_r',
            # 강화된 신규
            'adx', 'di_plus', 'di_minus',
            'supertrend_dir', 'st_dist',
            'vwap_dist',
            'cmf', 'mfi',
            'kc_pct', 'squeeze',
            'bull_power_norm', 'bear_power_norm',
            'pivot_dist',
        ]

    # ══════════════════════════════════════════════════════════
    # ③ 라벨 생성
    # ══════════════════════════════════════════════════════════

    def _make_labels(self, df: pd.DataFrame, horizon: int = 4) -> pd.Series:
        """
        ATR 기반 동적 임계값으로 라벨 생성
        (고정 0.8% 대신 ATR 비율 사용 → 코인별 변동성 자동 적응)
        """
        future_ret = df['close'].pct_change(horizon).shift(-horizon)
        atr_pct    = df['atr_pct'].fillna(0.01)
        threshold  = (atr_pct * 0.8).clip(0.005, 0.03)
        labels = np.where(future_ret > threshold,  1,
                 np.where(future_ret < -threshold, -1, 0))
        return pd.Series(labels, index=df.index)

    # ══════════════════════════════════════════════════════════
    # ④ 모델 학습
    # ══════════════════════════════════════════════════════════

    def train(self, dataframes: list, callback=None) -> bool:
        all_X, all_y = [], []
        feature_cols = self._get_feature_cols()
        total = len(dataframes)

        for i, (symbol, df) in enumerate(dataframes):
            try:
                d      = self.calculate_indicators(df)
                labels = self._make_labels(d)
                d['label'] = labels
                d = d.dropna()
                if len(d) < 100:
                    continue

                X = d[feature_cols].values
                y = d['label'].values
                X = np.nan_to_num(X, nan=0.0, posinf=1.0, neginf=-1.0)
                X = np.clip(X, -10, 10)
                all_X.append(X)
                all_y.append(y)

                if callback:
                    callback((i + 1) / total * 0.8)
            except Exception:
                continue

        if not all_X:
            return False

        X_full = np.vstack(all_X)
        y_full = np.concatenate(all_y)

        if callback:
            callback(0.85)

        rf = RandomForestClassifier(
            n_estimators=200,
            max_depth=10,
            min_samples_split=15,
            min_samples_leaf=8,
            max_features='sqrt',
            class_weight='balanced',
            random_state=42,
            n_jobs=-1,
        )

        self.model = Pipeline([
            ('scaler', StandardScaler()),
            ('clf', rf),
        ])
        self.model.fit(X_full, y_full)
        self.feature_cols     = feature_cols
        self.model_trained    = True
        self.last_train_time  = time.time()

        try:
            joblib.dump({
                'model':        self.model,
                'feature_cols': self.feature_cols,
                'train_time':   self.last_train_time,
            }, MODEL_PATH)
        except Exception as e:
            warnings.warn(f"[AIEngine] 모델 저장 실패: {e}")

        if callback:
            callback(1.0)

        return True

    def load_model(self) -> bool:
        if not os.path.exists(MODEL_PATH):
            return False
        try:
            data = joblib.load(MODEL_PATH)
            self.model           = data['model']
            self.feature_cols    = data['feature_cols']
            self.last_train_time = data.get('train_time', 0)
            self.model_trained   = True
            return True
        except Exception as e:
            warnings.warn(f"[AIEngine] 모델 로드 실패 (기본값 사용): {e}")
            # 손상된 파일만 삭제 — 단순 로드 오류 시 보존
            try:
                if os.path.getsize(MODEL_PATH) == 0:
                    os.remove(MODEL_PATH)
            except Exception:
                pass
            return False

    # ══════════════════════════════════════════════════════════
    # ⑤ 시장 레짐 감지
    # ══════════════════════════════════════════════════════════

    def _detect_regime(self, row) -> str:
        """
        ADX 기반 시장 레짐 분류
        Returns: 'strong_trend' | 'trend' | 'ranging'
        """
        adx = float(row.get('adx', 25))
        if adx >= 40:
            return 'strong_trend'
        if adx >= 20:
            return 'trend'
        return 'ranging'

    # ══════════════════════════════════════════════════════════
    # ⑥ 기술적 점수 계산
    # ══════════════════════════════════════════════════════════

    def _calc_tech_score(self, row, df: pd.DataFrame) -> float:
        """기술적 지표 종합 점수 (0~100, 50=중립)"""
        scores = []
        w      = []   # 가중치

        # ── RSI ───────────────────────────────────────────────
        rsi = float(row.get('rsi', 50))
        if   rsi <= 25: scores.append(92); w.append(1.5)
        elif rsi <= 35: scores.append(75); w.append(1.3)
        elif rsi >= 75: scores.append(8);  w.append(1.5)
        elif rsi >= 65: scores.append(25); w.append(1.3)
        else:           scores.append(50 + (50 - rsi) * 0.6); w.append(1.0)

        # ── MACD 히스토그램 방향 + 크기 ──────────────────────
        macd_hist      = float(row.get('macd_hist', 0))
        macd_hist_prev = float(df['macd_hist'].iloc[-2]) if len(df) > 1 else 0
        expanding      = abs(macd_hist) > abs(macd_hist_prev)
        if   macd_hist > 0 and expanding: scores.append(78); w.append(1.2)
        elif macd_hist > 0:               scores.append(62); w.append(1.0)
        elif macd_hist < 0 and expanding: scores.append(22); w.append(1.2)
        elif macd_hist < 0:               scores.append(38); w.append(1.0)
        else:                             scores.append(50); w.append(0.8)

        # ── 볼린저 밴드 위치 ──────────────────────────────────
        bb_pct = float(row.get('bb_pct', 0.5))
        if   bb_pct < 0.05: scores.append(88); w.append(1.2)
        elif bb_pct < 0.15: scores.append(75); w.append(1.0)
        elif bb_pct > 0.95: scores.append(12); w.append(1.2)
        elif bb_pct > 0.85: scores.append(25); w.append(1.0)
        elif bb_pct > 0.5:  scores.append(55); w.append(0.8)
        else:               scores.append(45); w.append(0.8)

        # ── Supertrend 방향 ───────────────────────────────────
        st_dir  = float(row.get('supertrend_dir', 0))
        st_dist = float(row.get('st_dist', 0))
        if   st_dir > 0 and st_dist > 0.02: scores.append(80); w.append(1.5)
        elif st_dir > 0:                    scores.append(65); w.append(1.3)
        elif st_dir < 0 and st_dist < -0.02:scores.append(20); w.append(1.5)
        elif st_dir < 0:                    scores.append(35); w.append(1.3)
        else:                               scores.append(50); w.append(0.8)

        # ── ADX 추세 강도 보조 (DI+ vs DI-) ─────────────────
        adx      = float(row.get('adx', 20))
        di_plus  = float(row.get('di_plus', 25))
        di_minus = float(row.get('di_minus', 25))
        if adx > 25:
            if   di_plus > di_minus * 1.3: scores.append(72); w.append(1.4)
            elif di_minus > di_plus * 1.3: scores.append(28); w.append(1.4)
            else:                          scores.append(50); w.append(0.7)
        else:
            scores.append(50); w.append(0.4)   # 횡보장은 낮은 가중치

        # ── VWAP 상대 위치 ────────────────────────────────────
        vwap_dist = float(row.get('vwap_dist', 0))
        if   vwap_dist > 0.02:  scores.append(68); w.append(1.1)
        elif vwap_dist > 0:     scores.append(57); w.append(0.9)
        elif vwap_dist < -0.02: scores.append(32); w.append(1.1)
        else:                   scores.append(43); w.append(0.9)

        # ── CMF (자금 유입/유출) ──────────────────────────────
        cmf = float(row.get('cmf', 0))
        if   cmf > 0.15:  scores.append(76); w.append(1.2)
        elif cmf > 0.05:  scores.append(62); w.append(1.0)
        elif cmf < -0.15: scores.append(24); w.append(1.2)
        elif cmf < -0.05: scores.append(38); w.append(1.0)
        else:             scores.append(50); w.append(0.7)

        # ── MFI ───────────────────────────────────────────────
        mfi = float(row.get('mfi', 50))
        if   mfi <= 20: scores.append(82); w.append(1.1)
        elif mfi <= 35: scores.append(65); w.append(0.9)
        elif mfi >= 80: scores.append(18); w.append(1.1)
        elif mfi >= 65: scores.append(35); w.append(0.9)
        else:           scores.append(50); w.append(0.7)

        # ── EMA 크로스 ────────────────────────────────────────
        ema_cross = float(row.get('ema_cross_9_21', 0))
        if   ema_cross > 0.008: scores.append(74); w.append(1.0)
        elif ema_cross > 0.002: scores.append(60); w.append(0.9)
        elif ema_cross < -0.008:scores.append(26); w.append(1.0)
        elif ema_cross < -0.002:scores.append(40); w.append(0.9)
        else:                   scores.append(50); w.append(0.6)

        # ── 스토캐스틱 ────────────────────────────────────────
        stoch_k = float(row.get('stoch_k', 50))
        stoch_d = float(row.get('stoch_d', 50))
        if   stoch_k < 20 and stoch_k > stoch_d: scores.append(82); w.append(1.1)
        elif stoch_k > 80 and stoch_k < stoch_d: scores.append(18); w.append(1.1)
        elif stoch_k > stoch_d:                  scores.append(60); w.append(0.8)
        else:                                    scores.append(40); w.append(0.8)

        # ── Elder Ray ─────────────────────────────────────────
        bull = float(row.get('bull_power_norm', 0))
        bear = float(row.get('bear_power_norm', 0))
        if   bull > 0.5 and bear > -0.5: scores.append(70); w.append(0.9)
        elif bear < -0.5 and bull < 0.5: scores.append(30); w.append(0.9)
        else:                            scores.append(50); w.append(0.6)

        # ── KC Squeeze (에너지 압축 → 돌파 준비) ─────────────
        squeeze = float(row.get('squeeze', 0))
        kc_pct  = float(row.get('kc_pct', 0.5))
        if squeeze:
            boost = (kc_pct - 0.5) * 30   # 방향에 따라 점수 가산
            scores.append(50 + boost); w.append(1.3)

        # ── 거래량 확인 ───────────────────────────────────────
        vol_ratio = float(row.get('vol_ratio', 1))
        if vol_ratio > 2.0:
            # 거래량 급증 시 기존 점수들을 방향으로 당김
            mean_score = np.average(scores, weights=w) if scores else 50
            pull = (mean_score - 50) * 0.15
            scores.append(50 + pull * 2); w.append(1.0)

        # ── 가격 모멘텀 ───────────────────────────────────────
        ret_1 = float(row.get('ret_1', 0))
        ret_3 = float(row.get('ret_3', 0))
        momentum = np.clip(50 + ret_1 * 1500 + ret_3 * 500, 10, 90)
        scores.append(float(momentum)); w.append(0.8)

        tech = float(np.average(scores, weights=w))
        return float(np.clip(tech, 0, 100))

    # ══════════════════════════════════════════════════════════
    # ⑦ 신호 생성 (메인)
    # ══════════════════════════════════════════════════════════

    def generate_signal(self, symbol: str, df: pd.DataFrame,
                        min_score: float = 65.0) -> dict:
        """
        단일 코인 매매 신호 생성

        Args:
            min_score: 진입 임계값 (config.min_score 연동)

        Returns:
            {signal, score, confidence, tech_score, ml_score,
             regime, indicators, reason, price, atr}
        """
        try:
            d = self.calculate_indicators(df)
            if len(d) < 100:
                return self._neutral(symbol, 'Insufficient data (min 100 candles)')

            latest = d.iloc[-1]
            regime = self._detect_regime(latest)

            # ── ATR 변동성 필터 ───────────────────────────────
            atr_pct = float(latest.get('atr_pct', 0))
            if atr_pct < 0.0015:   # 변동성 0.15% 미만 → 횡보 스킵
                return self._neutral(symbol, f'Low volatility (ATR {atr_pct*100:.2f}%)')

            # ── 기술적 점수 ───────────────────────────────────
            tech_score = self._calc_tech_score(latest, d)

            # ── ML 점수 ───────────────────────────────────────
            ml_score      = 50.0
            ml_prob_long  = 0.33
            ml_prob_short = 0.33

            if self.model_trained and self.model is not None:
                try:
                    feat_cols = self._get_feature_cols()
                    X = d[feat_cols].iloc[-1:].values
                    X = np.nan_to_num(X, nan=0.0, posinf=1.0, neginf=-1.0)
                    X = np.clip(X, -10, 10)

                    probs    = self.model.predict_proba(X)[0]
                    classes  = self.model.classes_
                    prob_map = {c: p for c, p in zip(classes, probs)}

                    ml_prob_long  = float(prob_map.get(1,  0))
                    ml_prob_short = float(prob_map.get(-1, 0))
                    ml_score      = float(np.clip(50 + (ml_prob_long - ml_prob_short) * 50, 0, 100))
                except Exception:
                    pass

            # ── 앙상블 점수 ───────────────────────────────────
            # ML 확신도에 따라 가중치를 동적으로 조정
            # 확신도 낮음(≈0) → ml_weight≈0.25, 확신도 높음(≈1) → ml_weight≈0.60
            if self.model_trained and self.model is not None:
                ml_confidence = abs(ml_prob_long - ml_prob_short)
                ml_weight = 0.25 + ml_confidence * 0.35
                final_score = (1.0 - ml_weight) * tech_score + ml_weight * ml_score
            else:
                final_score = tech_score

            # ── 레짐별 임계값 조정 ────────────────────────────
            #   강한 추세:  임계값 낮춤 (더 적극적)
            #   횡보:       임계값 높임 (더 보수적)
            if regime == 'strong_trend':
                th_offset = -3.0
            elif regime == 'ranging':
                th_offset = +5.0
            else:
                th_offset = 0.0

            long_threshold  = min_score + th_offset            # 예: 65 → 62 or 70
            short_threshold = (100 - min_score) - th_offset    # 예: 35 → 38 or 30

            # ── 신호 결정 ─────────────────────────────────────
            if final_score >= long_threshold:
                signal = LONG
            elif final_score <= short_threshold:
                signal = SHORT
            else:
                signal = HOLD

            confidence = abs(final_score - 50) / 50

            reason = self._make_reason(latest, signal, tech_score, ml_score, regime)

            return {
                'symbol':        symbol,
                'signal':        signal,
                'score':         round(float(final_score), 1),
                'confidence':    round(confidence, 3),
                'tech_score':    round(float(tech_score), 1),
                'ml_score':      round(float(ml_score), 1),
                'ml_prob_long':  round(ml_prob_long, 3),
                'ml_prob_short': round(ml_prob_short, 3),
                'regime':        regime,
                'indicators': {
                    'rsi':          round(float(latest.get('rsi', 50)), 1),
                    'macd':         round(float(latest.get('macd', 0)), 4),
                    'macd_hist':    round(float(latest.get('macd_hist', 0)), 4),
                    'bb_pct':       round(float(latest.get('bb_pct', 0.5)), 3),
                    'stoch_k':      round(float(latest.get('stoch_k', 50)), 1),
                    'stoch_d':      round(float(latest.get('stoch_d', 50)), 1),
                    'adx':          round(float(latest.get('adx', 20)), 1),
                    'supertrend_dir': int(latest.get('supertrend_dir', 0)),
                    'vwap_dist':    round(float(latest.get('vwap_dist', 0)), 4),
                    'cmf':          round(float(latest.get('cmf', 0)), 3),
                    'mfi':          round(float(latest.get('mfi', 50)), 1),
                    'squeeze':      int(latest.get('squeeze', 0)),
                    'ema_cross':    round(float(latest.get('ema_cross_9_21', 0)), 4),
                    'vol_ratio':    round(float(latest.get('vol_ratio', 1)), 2),
                    'cci':          round(float(latest.get('cci', 0)), 1),
                    'atr_pct':      round(float(latest.get('atr_pct', 0)), 4),
                    'williams_r':   round(float(latest.get('williams_r', -50)), 1),
                },
                'reason': reason,
                'price':  float(df['close'].iloc[-1]),
                'atr':    float(latest.get('atr', 0)),
            }

        except Exception as e:
            return self._neutral(symbol, f'Analysis error: {e}')

    # ══════════════════════════════════════════════════════════
    # ⑧ 신호 이유 텍스트
    # ══════════════════════════════════════════════════════════

    def _make_reason(self, row, signal: str,
                     tech: float, ml: float, regime: str) -> str:
        parts = []

        regime_str = {'strong_trend': 'StrongTrend', 'trend': 'Trend', 'ranging': 'Ranging'}.get(regime, '')
        if regime_str:
            parts.append(f'[{regime_str}]')

        rsi      = float(row.get('rsi', 50))
        macd_h   = float(row.get('macd_hist', 0))
        bb_pct   = float(row.get('bb_pct', 0.5))
        ema_c    = float(row.get('ema_cross_9_21', 0))
        cmf      = float(row.get('cmf', 0))
        st_dir   = float(row.get('supertrend_dir', 0))
        adx      = float(row.get('adx', 20))
        squeeze  = bool(row.get('squeeze', 0))

        if rsi < 30:      parts.append(f'RSI Oversold({rsi:.0f})')
        elif rsi > 70:    parts.append(f'RSI Overbought({rsi:.0f})')

        if   macd_h > 0:  parts.append('MACD↑')
        elif macd_h < 0:  parts.append('MACD↓')

        if   bb_pct < 0.12: parts.append('BB Lower')
        elif bb_pct > 0.88: parts.append('BB Upper')

        if   ema_c > 0.003:  parts.append('GoldenCross')
        elif ema_c < -0.003: parts.append('DeadCross')

        if   st_dir > 0: parts.append('Supertrend↑')
        elif st_dir < 0: parts.append('Supertrend↓')

        if adx > 35:    parts.append(f'ADX Strong({adx:.0f})')

        if   cmf > 0.1:  parts.append('MoneyIn')
        elif cmf < -0.1: parts.append('MoneyOut')

        if squeeze:     parts.append('Squeeze')

        parts.append(f'ML{ml:.0f}')

        return ' | '.join(parts) if parts else f'{signal} signal'

    # ══════════════════════════════════════════════════════════
    # ⑨ 멀티 타임프레임 (MTF) 상위 방향성 확인
    # ══════════════════════════════════════════════════════════

    def get_htf_bias(self, symbol: str, exchange, htf: str = '4h') -> int:
        """
        상위 타임프레임 추세 방향 반환
        Returns: 1 (강세), -1 (약세), 0 (중립/판단불가)
        """
        try:
            df_htf = exchange.get_ohlcv(symbol, htf, limit=100)
            if len(df_htf) < 50:
                return 0
            d = self.calculate_indicators(df_htf)
            row = d.iloc[-1]

            bull = 0
            bear = 0

            # Supertrend 방향 (가중치 2)
            st_dir = float(row.get('supertrend_dir', 0))
            if st_dir > 0:   bull += 2
            elif st_dir < 0: bear += 2

            # EMA 9/21 크로스
            ema_c = float(row.get('ema_cross_9_21', 0))
            if ema_c > 0.002:    bull += 1
            elif ema_c < -0.002: bear += 1

            # EMA 21/50 크로스
            ema_c2 = float(row.get('ema_cross_21_50', 0))
            if ema_c2 > 0.001:    bull += 1
            elif ema_c2 < -0.001: bear += 1

            # RSI 중심 기준
            rsi = float(row.get('rsi', 50))
            if rsi > 55:   bull += 1
            elif rsi < 45: bear += 1

            if bull >= 3: return 1
            if bear >= 3: return -1
            return 0
        except Exception:
            return 0

    # ══════════════════════════════════════════════════════════
    # ⑩ BTC 시장 국면 감지
    # ══════════════════════════════════════════════════════════

    def get_market_regime(self, exchange) -> str:
        """
        BTC 4h 추세 기반 전체 시장 국면
        Returns: 'bull' | 'bear' | 'neutral'
        """
        try:
            df = exchange.get_ohlcv('BTC/USDT:USDT', '4h', limit=100)
            if len(df) < 50:
                return 'neutral'
            d = self.calculate_indicators(df)
            row = d.iloc[-1]

            st_dir   = float(row.get('supertrend_dir', 0))
            ema_c    = float(row.get('ema_cross_21_50', 0))
            adx      = float(row.get('adx', 20))
            rsi      = float(row.get('rsi', 50))

            if st_dir > 0 and ema_c > 0 and rsi > 48:
                return 'bull'
            if st_dir < 0 and ema_c < 0 and rsi < 52:
                return 'bear'
            return 'neutral'
        except Exception:
            return 'neutral'

    # ══════════════════════════════════════════════════════════
    # ⑪ 다중 코인 스캔 (MTF + 오더북 통합)
    # ══════════════════════════════════════════════════════════

    def scan_symbols(self, symbols: list, exchange,
                     min_score: float = 65.0,
                     callback=None,
                     config=None) -> list:
        """
        여러 심볼 병렬 스캔 → 강한 신호 순 정렬
        ThreadPoolExecutor(max_workers=5)로 API 호출 병렬화,
        세마포어로 동시 요청 수를 제한해 레이트 리밋 준수.
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed
        import threading

        cfg = config or {}
        # 설정 읽기
        tf           = cfg.get('timeframe', '1h') if hasattr(cfg, 'get') else '1h'
        mtf_enabled  = cfg.get('mtf_enabled', True) if hasattr(cfg, 'get') else True
        htf          = cfg.get('mtf_timeframe', '4h') if hasattr(cfg, 'get') else '4h'
        ob_filter    = cfg.get('orderbook_filter', True) if hasattr(cfg, 'get') else True
        ob_threshold = cfg.get('orderbook_imbalance_threshold', 1.5) if hasattr(cfg, 'get') else 1.5

        total     = len(symbols)
        results   = []
        lock      = threading.Lock()
        completed = [0]
        api_sem   = threading.Semaphore(7)

        def _scan_one(symbol: str):
            with api_sem:
                try:
                    df = exchange.get_ohlcv(symbol, tf, 300)
                    time.sleep(0.25)
                except Exception:
                    return None

            try:
                signal = self.generate_signal(symbol, df, min_score=min_score)
            except Exception:
                return None

            # ── MTF 확인 ────────────────────────────────────────
            if mtf_enabled and signal['signal'] != HOLD:
                try:
                    htf_bias = self.get_htf_bias(symbol, exchange, htf)
                    signal['htf_bias'] = htf_bias
                    if htf_bias != 0:
                        if (signal['signal'] == LONG  and htf_bias == 1) or \
                           (signal['signal'] == SHORT and htf_bias == -1):
                            # 상위 TF 추세 일치 → 신뢰도 보너스
                            signal['score']      = min(signal['score'] + 4.0, 100.0)
                            signal['confidence'] = min(signal['confidence'] + 0.05, 1.0)
                            signal['reason']     += ' | MTF Confirm↑'
                        else:
                            # 상위 TF 반대 → 신뢰도 패널티
                            signal['score']      = max(signal['score'] - 6.0, 0.0)
                            signal['confidence'] = max(signal['confidence'] - 0.08, 0.0)
                            signal['reason']     += ' | MTF Mismatch↓'
                except Exception:
                    pass

            # ── 오더북 불균형 필터 ───────────────────────────────
            if ob_filter and signal['signal'] != HOLD:
                try:
                    ob = exchange.get_orderbook(symbol, depth=20)
                    imb = ob['imbalance']
                    signal['orderbook_imbalance'] = round(imb, 3)
                    if signal['signal'] == LONG and imb < (1 / ob_threshold):
                        # 매도 잔량 압도 → 롱 신뢰도 하락
                        signal['score']  = max(signal['score'] - 3.0, 0.0)
                        signal['reason'] += f' | OB SellPress({imb:.2f})'
                    elif signal['signal'] == SHORT and imb > ob_threshold:
                        # 매수 잔량 압도 → 숏 신뢰도 하락
                        signal['score']  = max(signal['score'] - 3.0, 0.0)
                        signal['reason'] += f' | OB BuyPress({imb:.2f})'
                    elif (signal['signal'] == LONG  and imb > ob_threshold) or \
                         (signal['signal'] == SHORT and imb < (1 / ob_threshold)):
                        # 방향 일치 → 보너스
                        signal['score']  = min(signal['score'] + 2.0, 100.0)
                        signal['reason'] += f' | OB Aligned({imb:.2f})'
                except Exception:
                    pass

            with lock:
                completed[0] += 1
                if callback:
                    try:
                        callback(symbol, completed[0] / total)
                    except Exception:
                        pass
            return signal

        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(_scan_one, sym): sym for sym in symbols}
            for future in as_completed(futures):
                try:
                    result = future.result()
                    if result is not None:
                        results.append(result)
                except Exception:
                    pass   # 개별 심볼 실패 시 전체 스캔 계속

        results.sort(key=lambda x: abs(x['score'] - 50), reverse=True)
        return results

    # ══════════════════════════════════════════════════════════
    # ⑩ 유틸
    # ══════════════════════════════════════════════════════════

    def _neutral(self, symbol: str, reason: str = '') -> dict:
        return {
            'symbol':        symbol,
            'signal':        HOLD,
            'score':         50.0,
            'confidence':    0.0,
            'tech_score':    50.0,
            'ml_score':      50.0,
            'ml_prob_long':  0.33,
            'ml_prob_short': 0.33,
            'regime':        'unknown',
            'indicators':    {},
            'reason':        reason or 'HOLD',
            'price':         0.0,
            'atr':           0.0,
        }
