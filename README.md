# 📊 코인 시세봇 (AI 분석 & 페이퍼 트레이딩)

## 📌 개요
디스코드에서 **Bitget 실시간 데이터**와 **AI·규칙 기반 분석**을 활용해  
코인 시세를 분석하고, 가상선물(Paper Trading) 기능을 제공하는 봇입니다.  

---

## ✨ 기능

### 🔍 분석 기능
- Bitget 실시간 캔들/거래 데이터 수집
- EMA20, EMA50, RSI, 변동성 등 주요 지표 계산
- CVD(누적 거래량 차이), 볼륨 프로파일 분석
- AI + Rule 기반 **LONG / SHORT / NEUTRAL** 신호 생성
- 추천 사유, 신뢰도, 리스크 표시
- UI 제공: 버튼(Analyze/Refresh 등), 셀렉트(심볼, 타임프레임, 상위25/단타10)

### 🧪 가상선물 (Paper Trading)
- **계정 관리**
  - Paper Trading ON/OFF
  - Reset (초기화)
  - 통화 전환 (USD ↔ KRW)
- **포지션 관리**
  - Long / Short 체결
  - Close(청산)
  - Flip(반전)
  - Refresh PnL (실시간 손익 갱신)
- **거래 설정**
  - 주문 금액 선택 (25 / 50 / 100 / 250 / 500 / 1000 / 2000 USD)
  - 레버리지 선택 (1x / 2x / 3x / 5x / 10x / 15x / 20x / 30x / 50x)
- **포트폴리오 UI**
  - 잔고(Equity)
  - 총자산(USD, KRW 환산)
  - 미실현 PnL
  - ROI (수익률)
  - 포지션별 진입가 / 현재가 / 수량 / 증거금 / 손익

### 🛠️ 관리 기능
- `!채널메세지비우기` : 최근 14일 이내 메시지 일괄 삭제 (권한 필요)
- 오류 자동 방어
  - 심볼 오류 처리
  - API 실패 시 폴백
  - Discord 상호작용 만료 대비

---

## 💡 강점
- **실시간 분석** : Bitget 최신 데이터 반영  
- **AI+규칙 혼합 전략** : 단순 지표보다 높은 신뢰도 제공  
- **풍부한 UI** : 버튼·드롭다운·임베드 조합으로 직관적인 사용성  
- **실전 대비 훈련** : 실제 거래소와 유사한 Paper Trading 환경  
- **보안/안정성 강화** : 안전 가격 조회, Ephemeral 메시지, 권한 검사, 14일 제한 고려  

---

## 🔐 보완 시스템
- **안전 가격 조회 시스템**  
  - 티커 실패 시 1분봉 종가 폴백
- **권한 검사**  
  - 메시지 삭제 등 관리 명령어는 권한 보유자만 실행 가능
- **에러 핸들링**  
  - try/catch 및 사용자 친화적 에러 메시지 표시
- **UI 제한**  
  - Discord 컴포넌트(버튼/셀렉트) 5줄 제한 

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
