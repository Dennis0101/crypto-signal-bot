# 📊 Crypto Signal Bot (Discord)

AI 기반 암호화폐 분석 및 가상 선물거래(Paper Trading) 지원 디스코드 봇입니다.  
실시간 신호 분석, 차트 지표, 주문 시뮬레이션, 서버별 랭킹 기능을 제공합니다.

---

## 🚀 주요 기능

### 🔎 시그널 분석
- **Bitget API** 연동하여 캔들/체결 데이터 수집
- 주요 지표 계산:
  - EMA20 / EMA50
  - RSI
  - 변동성(Volatility)
  - CVD(누적 체결량 불균형)
  - 볼륨 프로파일 상위 지점
- **추천 방향 자동 결정**: `LONG / SHORT / NEUTRAL`
- AI 보조(LLM) + 규칙 기반 신호 하이브리드 분석
- Discord **임베드(embed)** 형식으로 시각화

### 🧪 Paper Trading (가상 선물거래)
- 가상 계정 생성 (기본 Equity: `$100,000`)
- 주문 체결/청산 시뮬레이션:
  - LONG / SHORT / CLOSE / FLIP
- 레버리지 최대 **50배**
- 주문 금액 선택 가능 (100 ~ 10,000 USD)
- 자산 통화 **USD ↔ KRW 토글**
- 포지션/자산 현황 임베드 제공
- `Reset` 기능으로 초기화 가능

### 🏆 서버별 랭킹 시스템
- 서버별 참여자 자동 추적
- **수익률 기준 랭킹** 계산:
  - Equity 변화율 = (현재 자산 - 초기 자본) / 초기 자본
- 명령어: `!랭킹`
- Discord 임베드로 **TOP 10** 표시

### ⚙️ 유저 인터페이스
- 버튼 & 셀렉트 메뉴 지원:
  - Analyze / Refresh
  - Long / Short
  - 심볼 선택 / 타임프레임 선택
  - TOP25 거래량 코인, 단타 추천 10 선택
- 최대 5행 컴포넌트 구성으로 UI 최적화
- 서버별 개별 계정 관리 (길드 ID + 유저 ID)

### 🧹 관리 기능
- `!채널메세지비우기` → 채널 메시지 일괄 삭제 (14일 제한 준수)
- 쿨다운 시스템 (`30초`)으로 API 과부하 방지
- 캐시 시스템 (`15초 TTL`) 적용

---

## 📖 사용 방법

### 1. 명령어
- `!코인 [심볼] [타임프레임]` → 시그널 분석 시작
- `!랭킹` → 서버별 Paper Trading 수익률 TOP 10
- `!채널메세지비우기` → 채널 메시지 전체 삭제

### 2. 기본 심볼 & 타임프레임
- 기본 심볼: **BTCUSDT**
- 단타 추천 TOP10 심볼: **변동성 우선**
- 기본 타임프레임: **15m**
- 선택 가능 심볼: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `XRPUSDT`, `ARBUSDT`, `ONDOUSDT`
- 타임프레임: `1m`, `5m`, `15m`, `1h`, `4h`

---

## 🛠️ 시스템 설계 포인트

- **안정성 강화**
  - Discord 메시지/상호작용 오류 핸들링 보강
  - API 호출 동시성 제한 → Bitget rate limit 대응
  - `subscribeStream`으로 실시간 가격 업데이트 구독

- **확장성 확보**
  - 서버별 데이터 구조 도입 → 여러 길드에서 독립 운영 가능
  - Paper Trading 계정 상태 저장소(Store) 구조화
  - 향후 Redis/DB 연동으로 영속성 강화 가능

- **사용성 개선**
  - 직관적인 버튼/셀렉트 UI
  - 실시간 Refresh 지원
  - 미실현 손익(uPnL)과 총자산 표시
  - 원화 환산 제공 (USD/KRW 환율 적용)

---

## 🔧 설치 및 실행

```bash
# 1. 레포지토리 클론
git clone https://github.com/사용자명/crypto-signal-bot.git
cd crypto-signal-bot

# 2. 의존성 설치
npm install

# 3. 환경변수 설정 (.env)
DISCORD_TOKEN=디스코드봇토큰
OPENAI_API_KEY=OpenAI키
FX_USDKRW=1400

# 4. 실행
npm run dev
