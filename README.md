# 🐋 Polymarket Whale Monitor

US × Iran Ceasefire 마켓 — $1,000+ 거래 실시간 모니터링

## 구조

```
                 ┌─────────────────────────────┐
                 │  Polymarket Data API (public)│
                 └──────┬──────────┬────────────┘
                        │          │
          ┌─────────────▼──┐  ┌────▼──────────────┐
          │  AWS Lambda     │  │  Vercel Web (Next) │
          │  EventBridge 1m │  │  Browser 15s poll  │
          │  DynamoDB dedup │  │  Browser notif     │
          │  → Telegram     │  │  Sound alert       │
          └─────────────────┘  └───────────────────┘
```

## 폴더 구조

```
polymarket-whale/
├── lambda/               ← AWS Lambda (Telegram 알림)
│   ├── index.mjs         ← Lambda 코드 (의존성 없음)
│   ├── template.yaml     ← CloudFormation 템플릿
│   ├── lambda-deploy.zip ← 업로드용 zip
│   └── AWS-SETUP.md      ← AWS 설정 가이드
│
└── vercel-web/           ← Next.js 웹 대시보드
    ├── app/
    │   ├── layout.js
    │   └── page.js
    ├── package.json
    └── next.config.js
```

## 1. 웹 대시보드 배포 (GitHub → Vercel)

```bash
# GitHub repo 생성 후
cd vercel-web
git init
git add .
git commit -m "whale monitor"
git remote add origin https://github.com/YOUR/polymarket-whale-monitor.git
git push -u origin main

# Vercel에서 Import Project → GitHub repo 선택 → Deploy
```

## 2. AWS Lambda 배포

`lambda/AWS-SETUP.md` 참고.

요약:
1. DynamoDB 테이블 생성 (`polymarket-whale-seen-tx`)
2. Lambda 함수 생성 → `lambda-deploy.zip` 업로드
3. 환경변수 설정 (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, THRESHOLD)
4. EventBridge 룰 생성 (1분 간격)

## 비용

- Vercel: 무료 (Hobby)
- AWS: $0 (Free Tier)
