# 📊 Discord Crypto Analysis Bot

Bitget 선물 데이터를 기반으로 **실시간 코인 분석, 신호 제공, 거래대금 랭킹/단타 추천**을 지원하는 디스코드 봇입니다.  
UI는 버튼 + 드롭다운 셀렉터로 구성되어 있으며, 실시간 가격/변동률까지 표시됩니다.

---

## 🚀 기능 소개

### 🔎 주요 기능
- `!코인 [심볼] [타임프레임]` → 실시간 분석 실행
- 버튼 인터랙션:
  - **Analyze**: 최신 데이터로 다시 분석
  - **Long / Short**: 매수/매도 선택(실제 주문 미체결, 시뮬레이션 알림만)
  - **Refresh**: 최신 데이터 갱신
- 드롭다운 인터랙션:
  - **심볼 선택**: BTCUSDT, ETHUSDT 등
  - **타임프레임 선택**: 1m / 5m / 15m / 1h / 4h
  - **🏆 상위 25위 (24h 거래대금 기준)**
  - **⚡ 단타 추천 10 (변동성 우선)**

### 📊 분석 지표
- **캔들 데이터 (OHLCV)**  
- **최근 체결 데이터 기반 CVD (Cumulative Volume Delta)**  
- **Volume Profile** (주요 거래대금 가격대 Top3)  
- **자동 신호 생성 (decide)**: Long / Short / Neutral  

---

## 🖼️ UI 예시

![Bot UI Example](https://cdn.discordapp.com/attachments/1413350627936833637/1421668008144932865/IMG_8078.png)

---

## ⚙️ 설치 및 실행 방법
 Railway 에서 배포 했습니다 .
### 1️⃣ 환경 설정
```bash
git clone https://github.com/yourname/crypto-discord-bot.git
cd crypto-discord-bot
npm install
