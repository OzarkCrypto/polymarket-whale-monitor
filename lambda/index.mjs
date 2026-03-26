// ============================================================
// Polymarket Whale Alert — AWS Lambda
// ============================================================
// EventBridge triggers this every 1 minute.
// Each invocation polls 3 times (every 15s) for near-real-time coverage.
// DynamoDB tracks seen tx hashes to prevent duplicate alerts.
// ============================================================

import https from "https";

// ── Config (from Lambda environment variables) ──────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";
const THRESHOLD = parseInt(process.env.THRESHOLD || "1000");
const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || "polymarket-whale-seen-tx";
const EVENT_SLUG = process.env.EVENT_SLUG || "us-x-iran-ceasefire-by";

const GAMMA_API = "https://gamma-api.polymarket.com";
const DATA_API = "https://data-api.polymarket.com";
const POLLS_PER_INVOCATION = 3;
const POLL_DELAY_MS = 15000;

// ── Lightweight HTTP fetch (no dependencies) ────────────────
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "whale-bot/1.0" } }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Parse error: ${data.slice(0, 200)}`)); }
      });
    }).on("error", reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// ── DynamoDB (AWS SDK v3 — built into Lambda runtime) ───────
import { DynamoDBClient, BatchGetItemCommand, BatchWriteItemCommand } from "@aws-sdk/client-dynamodb";

const ddb = new DynamoDBClient({});

async function getSeenHashes(hashes) {
  if (!hashes.length) return new Set();
  // BatchGetItem max 100 keys
  const batches = [];
  for (let i = 0; i < hashes.length; i += 100) {
    batches.push(hashes.slice(i, i + 100));
  }
  const seen = new Set();
  for (const batch of batches) {
    const res = await ddb.send(new BatchGetItemCommand({
      RequestItems: {
        [DYNAMODB_TABLE]: {
          Keys: batch.map((h) => ({ txHash: { S: h } })),
          ProjectionExpression: "txHash",
        },
      },
    }));
    const items = res.Responses?.[DYNAMODB_TABLE] || [];
    items.forEach((item) => seen.add(item.txHash.S));
  }
  return seen;
}

async function markSeen(hashes) {
  if (!hashes.length) return;
  const ttl = Math.floor(Date.now() / 1000) + 86400 * 3; // 3 day TTL
  const batches = [];
  for (let i = 0; i < hashes.length; i += 25) {
    batches.push(hashes.slice(i, i + 25));
  }
  for (const batch of batches) {
    await ddb.send(new BatchWriteItemCommand({
      RequestItems: {
        [DYNAMODB_TABLE]: batch.map((h) => ({
          PutRequest: {
            Item: {
              txHash: { S: h },
              ttl: { N: String(ttl) },
            },
          },
        })),
      },
    }));
  }
}

// ── Telegram ────────────────────────────────────────────────
async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const res = await httpPost(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
  });
  if (!res.ok) console.log("Telegram error:", JSON.stringify(res));
}

// ── Helpers ─────────────────────────────────────────────────
const fmtUSD = (v) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Core Logic ──────────────────────────────────────────────
async function loadMarkets() {
  const data = await httpGet(`${GAMMA_API}/events/slug/${EVENT_SLUG}`);
  return data.markets
    .filter((m) => m.active && !m.closed)
    .map((m) => ({
      conditionId: m.conditionId,
      title: m.groupItemTitle || m.question,
    }));
}

async function pollOnce(markets) {
  const allTrades = [];

  for (const market of markets) {
    try {
      const trades = await httpGet(`${DATA_API}/trades?market=${market.conditionId}&limit=30`);
      if (Array.isArray(trades)) {
        trades.forEach((t) => {
          t._marketTitle = market.title;
        });
        allTrades.push(...trades);
      }
    } catch (e) {
      console.log(`Error fetching ${market.title}: ${e.message}`);
    }
  }

  // Filter by threshold
  const bigTrades = allTrades.filter((t) => t.size * t.price >= THRESHOLD);

  if (!bigTrades.length) return [];

  // Check DynamoDB for already-seen
  const hashes = bigTrades.map((t) => t.transactionHash);
  const seen = await getSeenHashes(hashes);

  const newTrades = bigTrades.filter((t) => !seen.has(t.transactionHash));

  if (newTrades.length > 0) {
    // Mark as seen
    await markSeen(newTrades.map((t) => t.transactionHash));

    // Send alerts
    for (const t of newTrades) {
      const value = t.size * t.price;
      const emoji = t.side === "BUY" ? "🟢" : "🔴";
      const whale = value >= 10000 ? "🐋 " : value >= 5000 ? "🐳 " : "";
      const trader = t.pseudonym || t.name || t.proxyWallet?.slice(0, 12) || "unknown";

      const msg =
        `${whale}${emoji} <b>${t.side} ${fmtUSD(value)}</b>\n` +
        `📊 ${t.title || t._marketTitle}\n` +
        `${t.outcome} @ ${t.price} · ${Math.round(t.size).toLocaleString()} shares\n` +
        `👤 ${trader}\n` +
        `🔗 <a href="https://polygonscan.com/tx/${t.transactionHash}">tx</a> · ` +
        `<a href="https://polymarket.com/event/${EVENT_SLUG}">market</a>`;

      await sendTelegram(msg);
      console.log(`ALERT: ${t.side} ${fmtUSD(value)} on ${t._marketTitle} (${t.outcome})`);
    }
  }

  return newTrades;
}

// ── Lambda Handler ──────────────────────────────────────────
export const handler = async (event) => {
  console.log("Lambda invoked, loading markets...");
  const markets = await loadMarkets();
  console.log(`Monitoring ${markets.length} active markets, threshold ${fmtUSD(THRESHOLD)}`);

  let totalAlerts = 0;

  for (let i = 0; i < POLLS_PER_INVOCATION; i++) {
    const newTrades = await pollOnce(markets);
    totalAlerts += newTrades.length;
    console.log(`Poll ${i + 1}/${POLLS_PER_INVOCATION}: ${newTrades.length} new alerts`);

    if (i < POLLS_PER_INVOCATION - 1) {
      await sleep(POLL_DELAY_MS);
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      markets: markets.length,
      totalAlerts,
      threshold: THRESHOLD,
    }),
  };
};
