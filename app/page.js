"use client";

import { useState, useEffect, useRef, useCallback } from "react";

const EVENT_SLUG = "us-x-iran-ceasefire-by";
const GAMMA_API = "https://gamma-api.polymarket.com";
const DATA_API = "https://data-api.polymarket.com";
const DEFAULT_THRESHOLD = 1000;
const POLL_INTERVAL = 15000;

const fmtUSD = (v) =>
  `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const fmtSize = (v) =>
  Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });

function timeAgo(ts) {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function playAlert() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1100, 880].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = freq;
      o.type = "square";
      g.gain.value = 0.06;
      o.start(ctx.currentTime + i * 0.15);
      o.stop(ctx.currentTime + i * 0.15 + 0.1);
    });
  } catch {}
}

function sendNotif(trade) {
  if ("Notification" in window && Notification.permission === "granted") {
    const val = (trade.size * trade.price).toFixed(0);
    new Notification(`${trade.side} ${fmtUSD(val)}`, {
      body: `${trade.title} · ${trade.outcome} @ ${trade.price}`,
      icon: trade.icon,
      tag: trade.transactionHash,
    });
  }
}

export default function Page() {
  const [markets, setMarkets] = useState([]);
  const [trades, setTrades] = useState([]);
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [isRunning, setIsRunning] = useState(true);
  const [soundOn, setSoundOn] = useState(true);
  const [lastCheck, setLastCheck] = useState(null);
  const [error, setError] = useState(null);
  const [flashTx, setFlashTx] = useState(null);
  const [selectedMarket, setSelectedMarket] = useState("all");
  const seenRef = useRef(new Set());
  const ivRef = useRef(null);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission();
    }
    (async () => {
      try {
        const res = await fetch(`${GAMMA_API}/events/slug/${EVENT_SLUG}`);
        const data = await res.json();
        setMarkets(
          data.markets
            .filter((m) => m.active && !m.closed)
            .map((m) => ({
              conditionId: m.conditionId,
              title: m.groupItemTitle || m.question,
              yesPrice: JSON.parse(m.outcomePrices)[0],
              noPrice: JSON.parse(m.outcomePrices)[1],
              volume24h: m.volume24hr,
              liquidity: m.liquidityNum,
              lastTradePrice: m.lastTradePrice,
            }))
        );
      } catch (e) {
        setError("Failed to load markets: " + e.message);
      }
    })();
  }, []);

  const poll = useCallback(async () => {
    if (!markets.length) return;
    try {
      const cids =
        selectedMarket === "all"
          ? markets.map((m) => m.conditionId)
          : [selectedMarket];
      const all = [];
      for (const cid of cids) {
        const r = await fetch(`${DATA_API}/trades?market=${cid}&limit=50`);
        const d = await r.json();
        if (Array.isArray(d)) all.push(...d);
      }
      const big = all
        .filter((t) => t.size * t.price >= threshold)
        .sort((a, b) => b.timestamp - a.timestamp);

      const fresh = big.filter((t) => !seenRef.current.has(t.transactionHash));
      if (fresh.length > 0 && seenRef.current.size > 0) {
        fresh.forEach((t) => {
          if (soundOn) playAlert();
          sendNotif(t);
          setFlashTx(t.transactionHash);
          setTimeout(() => setFlashTx(null), 2000);
        });
      }
      big.forEach((t) => seenRef.current.add(t.transactionHash));
      setTrades(big.slice(0, 100));
      setLastCheck(new Date());
      setError(null);
    } catch (e) {
      setError("Poll error: " + e.message);
    }
  }, [markets, threshold, soundOn, selectedMarket]);

  useEffect(() => {
    if (isRunning && markets.length) {
      poll();
      ivRef.current = setInterval(poll, POLL_INTERVAL);
    }
    return () => clearInterval(ivRef.current);
  }, [isRunning, poll, markets]);

  // Refresh prices
  useEffect(() => {
    if (!markets.length) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`${GAMMA_API}/events/slug/${EVENT_SLUG}`);
        const d = await r.json();
        setMarkets((prev) =>
          prev.map((m) => {
            const f = d.markets.find((x) => x.conditionId === m.conditionId);
            if (!f) return m;
            return {
              ...m,
              yesPrice: JSON.parse(f.outcomePrices)[0],
              noPrice: JSON.parse(f.outcomePrices)[1],
              volume24h: f.volume24hr,
              lastTradePrice: f.lastTradePrice,
            };
          })
        );
      } catch {}
    }, 30000);
    return () => clearInterval(iv);
  }, [markets.length]);

  const totalVal = trades.reduce((s, t) => s + t.size * t.price, 0);
  const buys = trades.filter((t) => t.side === "BUY").length;
  const sells = trades.filter((t) => t.side === "SELL").length;

  return (
    <>
      <style>{`
        @keyframes flashRow{0%{background:#ff440040}50%{background:#ff440020}100%{background:transparent}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
        @keyframes slideIn{from{transform:translateY(-6px);opacity:0}to{transform:translateY(0);opacity:1}}
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:5px}
        ::-webkit-scrollbar-track{background:#0a0a0a}
        ::-webkit-scrollbar-thumb{background:#333;border-radius:3px}
        body{margin:0;background:#050505}
      `}</style>

      <div
        style={{
          fontFamily: "'Outfit',sans-serif",
          background: "#050505",
          color: "#e0e0e0",
          minHeight: "100vh",
          padding: "20px 16px",
          maxWidth: 920,
          margin: "0 auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 20,
            paddingBottom: 14,
            borderBottom: "1px solid #1a1a1a",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: "#111",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1px solid #222",
                fontSize: 20,
              }}
            >
              🐋
            </div>
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontFamily: "'JetBrains Mono',monospace",
                  fontWeight: 700,
                  letterSpacing: 3,
                  color: "#fff",
                }}
              >
                WHALE MONITOR
              </h1>
              <p style={{ margin: 0, fontSize: 11, color: "#555" }}>
                US × Iran Ceasefire — Polymarket
              </p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: isRunning ? "#00ff88" : "#ff4444",
                animation: "pulse 2s infinite",
              }}
            />
            <span
              style={{
                fontSize: 10,
                fontFamily: "'JetBrains Mono',monospace",
                color: "#666",
              }}
            >
              {isRunning ? "LIVE" : "PAUSED"}
              {lastCheck && ` · ${lastCheck.toLocaleTimeString()}`}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div
          style={{
            display: "flex",
            gap: 14,
            alignItems: "flex-end",
            marginBottom: 18,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelSt}>THRESHOLD</label>
            <div style={{ display: "flex", gap: 5 }}>
              {[500, 1000, 5000, 10000].map((v) => (
                <button
                  key={v}
                  onClick={() => {
                    setThreshold(v);
                    seenRef.current.clear();
                  }}
                  style={{
                    padding: "5px 10px",
                    fontSize: 11,
                    fontFamily: "'JetBrains Mono',monospace",
                    background: threshold === v ? "#ff440020" : "#111",
                    color: threshold === v ? "#ff8844" : "#777",
                    border: `1px solid ${threshold === v ? "#ff440040" : "#222"}`,
                    borderRadius: 5,
                    cursor: "pointer",
                  }}
                >
                  {fmtUSD(v)}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={labelSt}>MARKET</label>
            <select
              value={selectedMarket}
              onChange={(e) => {
                setSelectedMarket(e.target.value);
                seenRef.current.clear();
              }}
              style={{
                padding: "5px 10px",
                fontSize: 11,
                fontFamily: "'JetBrains Mono',monospace",
                background: "#111",
                color: "#bbb",
                border: "1px solid #222",
                borderRadius: 5,
                outline: "none",
                minWidth: 150,
              }}
            >
              <option value="all">All Markets</option>
              {markets.map((m) => (
                <option key={m.conditionId} value={m.conditionId}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => setSoundOn(!soundOn)} style={iconBtnSt}>
              {soundOn ? "🔊" : "🔇"}
            </button>
            <button onClick={() => setIsRunning(!isRunning)} style={iconBtnSt}>
              {isRunning ? "⏸" : "▶️"}
            </button>
          </div>
        </div>

        {error && (
          <div
            style={{
              padding: "7px 12px",
              background: "#ff444418",
              border: "1px solid #ff444430",
              borderRadius: 5,
              fontSize: 11,
              color: "#ff8888",
              marginBottom: 14,
              fontFamily: "'JetBrains Mono',monospace",
            }}
          >
            {error}
          </div>
        )}

        {/* Market Cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(190px,1fr))",
            gap: 8,
            marginBottom: 16,
          }}
        >
          {markets.map((m) => {
            const pct = (parseFloat(m.yesPrice) * 100).toFixed(0);
            return (
              <div
                key={m.conditionId}
                style={{
                  background: "#0b0b0b",
                  border: "1px solid #181818",
                  borderRadius: 7,
                  padding: "10px 12px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, color: "#bbb" }}>
                    {m.title}
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono',monospace",
                      fontWeight: 700,
                      padding: "1px 7px",
                      borderRadius: 3,
                      background: pct > 50 ? "#00ff8815" : "#ff444415",
                      color: pct > 50 ? "#00ff88" : "#ff4444",
                    }}
                  >
                    {pct}%
                  </span>
                </div>
                <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                  <div>
                    <span style={miniLabelSt}>YES</span>
                    <span style={{ ...miniValSt, color: "#00ff88" }}>
                      {m.yesPrice}
                    </span>
                  </div>
                  <div>
                    <span style={miniLabelSt}>NO</span>
                    <span style={{ ...miniValSt, color: "#ff4444" }}>
                      {m.noPrice}
                    </span>
                  </div>
                  <div>
                    <span style={miniLabelSt}>24H</span>
                    <span style={miniValSt}>{fmtUSD(m.volume24h || 0)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Stats */}
        <div
          style={{
            display: "flex",
            gap: 18,
            padding: "12px 16px",
            background: "#0b0b0b",
            border: "1px solid #181818",
            borderRadius: 7,
            marginBottom: 14,
            flexWrap: "wrap",
          }}
        >
          {[
            { label: "TRADES", val: trades.length, color: "#fff" },
            { label: "VALUE", val: fmtUSD(totalVal), color: "#fff" },
            { label: "BUYS", val: buys, color: "#00ff88" },
            { label: "SELLS", val: sells, color: "#ff4444" },
          ].map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span
                style={{
                  fontSize: 9,
                  fontFamily: "'JetBrains Mono',monospace",
                  color: "#444",
                  letterSpacing: 1.2,
                }}
              >
                {s.label}
              </span>
              <span
                style={{
                  fontSize: 17,
                  fontFamily: "'JetBrains Mono',monospace",
                  fontWeight: 700,
                  color: s.color,
                }}
              >
                {s.val}
              </span>
            </div>
          ))}
        </div>

        {/* Feed header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              fontFamily: "'JetBrains Mono',monospace",
              color: "#444",
              letterSpacing: 2,
            }}
          >
            TRADE FEED
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: "'JetBrains Mono',monospace",
              color: "#333",
            }}
          >
            {trades.length} trades ≥ {fmtUSD(threshold)}
          </span>
        </div>

        {/* Feed */}
        <div
          style={{
            maxHeight: 500,
            overflowY: "auto",
            borderRadius: 7,
            border: "1px solid #181818",
          }}
        >
          {trades.length === 0 && (
            <div
              style={{
                padding: 36,
                textAlign: "center",
                color: "#333",
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 12,
              }}
            >
              {isRunning ? "Scanning for whale trades..." : "Monitor paused"}
            </div>
          )}
          {trades.map((t) => {
            const val = t.size * t.price;
            const buy = t.side === "BUY";
            const whale = val >= 10000;
            return (
              <div
                key={t.transactionHash + t.timestamp}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "9px 12px",
                  borderBottom: "1px solid #111",
                  borderLeft: `3px solid ${buy ? "#00ff88" : "#ff4444"}`,
                  animation:
                    t.transactionHash === flashTx
                      ? "flashRow 2s ease-out"
                      : "slideIn .3s ease-out",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontFamily: "'JetBrains Mono',monospace",
                      fontWeight: 700,
                      padding: "2px 7px",
                      borderRadius: 3,
                      letterSpacing: 1,
                      flexShrink: 0,
                      background: buy ? "#00ff8818" : "#ff444418",
                      color: buy ? "#00ff88" : "#ff4444",
                    }}
                  >
                    {t.side}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 5,
                      }}
                    >
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#bbb" }}>
                        {(t.title || "").replace("US x Iran ceasefire by ", "")}
                      </span>
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: "'JetBrains Mono',monospace",
                          fontWeight: 600,
                          color: t.outcome === "Yes" ? "#00ff88" : "#ff8844",
                        }}
                      >
                        {t.outcome}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "#444",
                        fontFamily: "'JetBrains Mono',monospace",
                        marginTop: 1,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {fmtSize(t.size)} @ {t.price} ·{" "}
                      {t.pseudonym || t.name || t.proxyWallet?.slice(0, 10)}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div
                    style={{
                      fontSize: 14,
                      fontFamily: "'JetBrains Mono',monospace",
                      fontWeight: 700,
                      color: whale ? "#ffaa00" : "#ddd",
                    }}
                  >
                    {whale && "🐋 "}
                    {fmtUSD(val)}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "#333",
                      fontFamily: "'JetBrains Mono',monospace",
                      marginTop: 1,
                    }}
                  >
                    {timeAgo(t.timestamp)}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 18,
            paddingTop: 12,
            borderTop: "1px solid #151515",
            fontSize: 10,
            color: "#333",
            textAlign: "center",
          }}
        >
          Polling every {POLL_INTERVAL / 1000}s ·{" "}
          <a
            href="https://polymarket.com/event/us-x-iran-ceasefire-by"
            target="_blank"
            rel="noopener"
            style={{ color: "#555" }}
          >
            polymarket.com
          </a>
        </div>
      </div>
    </>
  );
}

const labelSt = {
  fontSize: 9,
  fontFamily: "'JetBrains Mono',monospace",
  color: "#444",
  letterSpacing: 1.5,
};
const iconBtnSt = {
  padding: "5px 9px",
  fontSize: 15,
  background: "#111",
  border: "1px solid #222",
  borderRadius: 5,
  cursor: "pointer",
  color: "#bbb",
};
const miniLabelSt = {
  display: "block",
  fontSize: 8,
  fontFamily: "'JetBrains Mono',monospace",
  color: "#444",
  letterSpacing: 1,
};
const miniValSt = {
  fontSize: 12,
  fontFamily: "'JetBrains Mono',monospace",
  fontWeight: 600,
  color: "#888",
};
