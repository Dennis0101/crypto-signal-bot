# 🪙 CoinInsight Bot (코인 시세 & AI 분석 디스코드 봇)

> **실시간 암호화폐 분석 · 자동 신호 생성 · AI 추천 사유 제공**

![preview](https://cdn.discordapp.com/attachments/1413350627936833637/1421668008144932865/IMG_8078.png?ex=68d9df02&is=68d88d82&hm=fbf794d51992712d5d8d4100e85091b566aa2e738485f0b2ada82fef2bfe3b7b&)

---

## ✨ 기능 소개

- **실시간 가격/지표 분석**
  - Bitget API 기반 선물 캔들 데이터
  - EMA20 / EMA50, RSI, 변동성, CVD 분석

- **자동 신호 생성**
  - 룰 기반 + OpenAI 결합
  - 방향성: LONG / SHORT / NEUTRAL
  - 신뢰도 점수 + 진입/손절/익절 레벨

- **추천 이유 설명**
  - 왜 롱(혹은 숏)인지, 어떤 근거가 있는지 자동으로 문장화
  - `EMA·RSI·CVD` 지표와 볼륨 상위 레벨 기반

- **디스코드 임베드 UI**
  - 깔끔한 카드 형식
  - 버튼: `Analyze`, `Long`, `Short`, `Refresh`
  - 글로벌 어디서든 “와” 할 비주얼 🎨

---

## 🚀 빠른 시작

### 1. 클론 & 의존성 설치
```bash
git clone https://github.com/yourname/coininsight-bot.git
cd coininsight-bot
npm install
