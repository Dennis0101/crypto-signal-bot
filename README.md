# 📊 Bitget Futures Discord Bot

> **Bitget 선물 데이터 분석 + Paper Trading 지원 Discord Bot**  
> 실시간 시세 분석, CVD & 볼륨 프로파일 계산, 가상거래(Paper Trading) 기능을 모두 제공합니다.

---

## ✨ Features

### 📈 실시간 분석
- Bitget API 기반 **시세, 캔들, 체결 데이터 조회**
- **CVD (Cumulative Volume Delta)** 및 **Volume Profile** 계산
- 매매 **시그널 자동 결정 (LONG / SHORT / NEUTRAL)**

### 🎛️ 인터랙션 UI
- **버튼**
  - 📊 분석 새로고침
  - ▶️ Paper Trading 주문 (롱/숏/청산/반전)
  - 🧹 초기화, 💱 통화 전환(USD ↔ KRW)
- **셀렉트 메뉴**
  - 심볼 선택 (BTCUSDT, ETHUSDT 등)
  - 타임프레임 선택 (1m, 5m, 15m, 1h, 4h)
  - Top25 / Scalp10 종목 빠른 접근

### 💵 Paper Trading
- 가상 **계정/포지션 관리**
- 시장가 체결 (롱/숏)
- **평균가 갱신, 포지션 반전, 청산**
- 손익(PnL) 자동 반영 → Equity 업데이트
- 주문 금액, 레버리지, 표시 통화 설정 가능

### 🛠️ Utilities
- **TTL 캐시** → Bitget API 과호출 방지
- **안전 가격 조회 (Safe Price)** → 시세 조회 실패 대비
- **쿨다운(Cooldown)** → 동일 채널 과도한 명령 방지

---

## 📂 Project Structure

- **clients/bitget.ts** → Bitget REST API 연동 (캔들, 체결, 티커, 심볼)
- **indicators/** → SMA, EMA, 변동성, CVD 등 지표 계산
- **strategy/signal.ts** → 매매 시그널 생성
- **paper/** → Paper Trading 로직 및 UI
- **streams/bitget.ts** → WebSocket 실시간 데이터 구독
- **ui/** → Discord Embed & 버튼/드롭다운 UI
- **utils/cache.ts** → TTL 캐시 (API 과호출 방지)
- **commands/** → Discord 명령어 처리
- **router.ts** → 이벤트 라우팅
- **config.ts** → 환경설정
- **index.ts** → 진입점 (Client 초기화 + Router 연결)
