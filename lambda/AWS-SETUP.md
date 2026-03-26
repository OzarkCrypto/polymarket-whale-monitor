# AWS 배포 가이드 — Polymarket Whale Alert Bot

## 아키텍처

```
EventBridge (매 1분)
    ↓ trigger
Lambda (55초 실행, 내부 3회 폴링)
    ├── Polymarket Data API 조회
    ├── DynamoDB 중복 체크
    ├── Telegram 알림 전송
    └── CloudWatch Logs 기록

비용: 거의 $0 (Free Tier 범위)
- Lambda: 월 1백만 요청 무료, 이 봇 ~43,200 요청/월
- DynamoDB: 25GB, 25 RCU/WCU 무료
- EventBridge: 무료
```

---

## 방법 A: AWS Console에서 수동 설정 (5분)

### Step 1: DynamoDB 테이블 생성

1. AWS Console → **DynamoDB** → Create table
2. 설정:
   - Table name: `polymarket-whale-seen-tx`
   - Partition key: `txHash` (String)
   - Table settings: **On-demand** (Customize → Read/write capacity: On-demand)
3. 생성 후 → Additional settings → Time to live (TTL)
   - TTL attribute: `ttl` → Enable

### Step 2: Lambda 함수 생성

1. AWS Console → **Lambda** → Create function
2. 설정:
   - Function name: `polymarket-whale-alert`
   - Runtime: **Node.js 20.x**
   - Architecture: arm64 (비용 절감)
   - Execution role: Create new role
3. 함수 생성 후:

   **코드 업로드:**
   - Code source → Upload from → .zip file
   - `lambda-deploy.zip` 업로드 (아래 생성 방법 참고)

   **환경변수 설정** (Configuration → Environment variables):
   ```
   TELEGRAM_BOT_TOKEN = 7123456789:AAxxxxxxxxxxxxxxx
   TELEGRAM_CHAT_ID   = 123456789
   THRESHOLD          = 1000
   DYNAMODB_TABLE     = polymarket-whale-seen-tx
   EVENT_SLUG         = us-x-iran-ceasefire-by
   ```

   **타임아웃 설정** (Configuration → General configuration → Edit):
   - Timeout: **55 seconds**
   - Memory: 128 MB

   **권한 추가** (Configuration → Permissions → Role name 클릭):
   - Add permissions → Attach policies
   - `AmazonDynamoDBFullAccess` 추가 (또는 아래 커스텀 정책)

   커스텀 정책 (최소 권한):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": [
         "dynamodb:BatchGetItem",
         "dynamodb:BatchWriteItem",
         "dynamodb:GetItem",
         "dynamodb:PutItem"
       ],
       "Resource": "arn:aws:dynamodb:*:*:table/polymarket-whale-seen-tx"
     }]
   }
   ```

### Step 3: EventBridge 스케줄 설정

1. AWS Console → **EventBridge** → Rules → Create rule
2. 설정:
   - Name: `polymarket-whale-schedule`
   - Event bus: default
   - Rule type: **Schedule**
3. Schedule pattern:
   - **Rate expression**: `rate(1 minute)`
4. Target:
   - AWS Lambda function → `polymarket-whale-alert`
5. Create

### Step 4: 테스트

1. Lambda → Test → 빈 이벤트 `{}` 로 테스트
2. CloudWatch Logs에서 로그 확인
3. Telegram에서 알림 수신 확인

---

## 방법 B: CloudFormation으로 원클릭 배포

1. AWS Console → **CloudFormation** → Create stack
2. Upload template → `template.yaml` 업로드
3. Parameters 입력:
   - TelegramBotToken
   - TelegramChatId
   - Threshold (기본 1000)
4. Create stack → 2분 대기
5. Lambda Console에서 코드를 `lambda-deploy.zip`으로 교체

---

## 방법 C: AWS CLI

```bash
# 1. DynamoDB 테이블 생성
aws dynamodb create-table \
  --table-name polymarket-whale-seen-tx \
  --attribute-definitions AttributeName=txHash,AttributeType=S \
  --key-schema AttributeName=txHash,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST

# TTL 활성화
aws dynamodb update-time-to-live \
  --table-name polymarket-whale-seen-tx \
  --time-to-live-specification Enabled=true,AttributeName=ttl

# 2. Lambda 함수 배포
aws lambda create-function \
  --function-name polymarket-whale-alert \
  --runtime nodejs20.x \
  --handler index.handler \
  --timeout 55 \
  --memory-size 128 \
  --zip-file fileb://lambda-deploy.zip \
  --role arn:aws:iam::YOUR_ACCOUNT_ID:role/YOUR_LAMBDA_ROLE \
  --environment Variables="{TELEGRAM_BOT_TOKEN=xxx,TELEGRAM_CHAT_ID=xxx,THRESHOLD=1000,DYNAMODB_TABLE=polymarket-whale-seen-tx,EVENT_SLUG=us-x-iran-ceasefire-by}"

# 3. EventBridge 룰 생성
aws events put-rule \
  --name polymarket-whale-schedule \
  --schedule-expression "rate(1 minute)"

aws lambda add-permission \
  --function-name polymarket-whale-alert \
  --statement-id eventbridge-invoke \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn arn:aws:events:REGION:ACCOUNT:rule/polymarket-whale-schedule

aws events put-targets \
  --rule polymarket-whale-schedule \
  --targets "Id"="1","Arn"="arn:aws:lambda:REGION:ACCOUNT:function:polymarket-whale-alert"
```

---

## Lambda 배포 zip 만드는 법

```bash
cd lambda
zip lambda-deploy.zip index.mjs
# AWS SDK v3는 Lambda Node.js 20.x 런타임에 내장이므로 npm install 불필요
```

`index.mjs` 하나만 zip하면 됨. 외부 의존성 없음 (AWS SDK v3는 런타임 내장, HTTP는 Node 내장 https 모듈 사용).

---

## 비용 예상

| 서비스 | 월 사용량 | 비용 |
|--------|-----------|------|
| Lambda | ~43,200 invocations × 55s × 128MB | Free Tier 내 |
| DynamoDB | ~수천 reads/writes | Free Tier 내 |
| EventBridge | ~43,200 invocations | 무료 |
| CloudWatch Logs | ~100MB | Free Tier 내 |
| **합계** | | **$0** |

---

## 모니터링 & 디버깅

- **CloudWatch Logs**: Lambda → Monitor → View CloudWatch logs
- **DynamoDB 항목 확인**: DynamoDB → Tables → polymarket-whale-seen-tx → Explore items
- **일시정지**: EventBridge → Rules → polymarket-whale-schedule → Disable
- **Threshold 변경**: Lambda → Configuration → Environment variables → THRESHOLD 수정

---

## 다른 마켓 추가

`EVENT_SLUG` 환경변수를 변경하면 다른 Polymarket 이벤트 모니터링 가능.
여러 이벤트를 동시에 모니터링하려면 Lambda 함수를 복제하거나 코드에서 배열로 처리.
