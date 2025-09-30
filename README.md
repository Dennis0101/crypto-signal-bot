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

src/
 ├── clients/
 │    └── bitget.ts
 │         • Bitget REST API 연동 모듈
 │         • 캔들 데이터, 체결 데이터, 티커/랭킹, 심볼 목록 제공
 │
 ├── indicators/
 │    ├── calc.ts
 │    │    • 기본 지표 계산 (SMA, EMA, 변동성 등)
 │    └── cvd.ts
 │         • CVD(Cumulative Volume Delta) 및 Volume Profile 생성
 │
 ├── strategy/
 │    └── signal.ts
 │         • 지표·체결 데이터 기반 매매 시그널 결정 (LONG/SHORT/NEUTRAL)
 │
 ├── paper/
 │    ├── store.ts
 │    │    • Paper Trading 계정·포지션 상태 저장소
 │    ├── service.ts
 │    │    • 주문, 청산, 반전, 초기화 등 가상거래 로직
 │    ├── math.ts
 │    │    • 수량 계산, 손익(PnL) 계산 유틸리티
 │    └── ui.ts
 │         • Paper Trading 전용 포트폴리오 Embed UI
 │
 ├── streams/
 │    └── bitget.ts
 │         • Bitget WebSocket 실시간 구독
 │         • 가격/체결 데이터 스트리밍 → 메시지 자동 업데이트
 │
 ├── ui/
 │    ├── components.ts
 │    │    • Discord UI 컴포넌트 정의 (버튼, 드롭다운)
 │    └── embed.ts
 │         • 분석 결과 Embed 메시지 생성
 │
 ├── utils/
 │    └── cache.ts
 │         • TTL Cache (API 호출 과호출 방지)
 │
 ├── commands/
 │    ├── coin.ts
 │    │    • `!코인` 명령어 처리 (분석 실행)
 │    └── coin-root.ts
 │         • Top25 / Scalp10 랭킹 UI 보조 메시지
 │
 ├── router.ts
 │    • Discord 이벤트 라우터
 │    • 메시지 명령어, 버튼/셀렉트 인터랙션, Paper Trading 연동
 │
 ├── config.ts
 │    • 환경설정 (API Base URL, 기본 심볼/TF, 캐시·쿨다운 설정)
 │
 └── index.ts
      • 엔트리포인트
      • Discord Client 초기화 + Router 연결
