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
      body: `${trade.title} \u00b7 ${trade.outcome} @ ${trade.price}`,
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
    if ("Notification" in window && Notification.permission === "default") { Notification.requestPermission(); }
    (async () => {
      try {
        const res = await fetch(`${GAMMA_API}/events/slug/${EVENT_SLUG}`);
        const data = await res.json();
        setMarkets(data.markets.filter((m) => m.active && !m.closed).map((m) => ({
          conditionId: m.conditionId, title: m.groupItemTitle || m.question,
          yesPrice: JSON.parse(m.outcomePrices)[0], noPrice: JSON.parse(m.outcomePrices)[1],
          volume24h: m.volume24hr, liquidity: m.liquidityNum, lastTradePrice: m.lastTradePrice,
        })));
      } catch (e) { setError("Failed to load markets: " + e.message); }
    })();
  }, []);

  const poll = useCallback(async () => {
    if (!markets.length) return;
    try {
      const cids = selectedMarket === "all" ? markets.map((m) => m.conditionId) : [selectedMarket];
      const all = [];
      for (const cid of cids) { const r = await fetch(`${DATA_API}/trades?market=${cid}&limit=50`); const d = await r.json(); if (Array.isArray(d)) all.push(...d); }
      const big = all.filter((t) => t.size * t.price >= threshold).sort((a, b) => b.timestamp - a.timestamp);
      const fresh = big.filter((t) => !seenRef.current.has(t.transactionHash));
      if (fresh.length > 0 && seenRef.current.size > 0) {
        fresh.forEach((t) => { if (soundOn) playAlert(); sendNotif(t); setFlashTx(t.transactionHash); setTimeout(() => setFlashTx(null), 2000); });
      }
      big.forEach((t) => seenRef.current.add(t.transactionHash));
      setTrades(big.slice(0, 100)); setLastCheck(new Date()); setError(null);
    } catch (e) { setError("Poll error: " + e.message); }
  }, [markets, threshold, soundOn, selectedMarket]);

  useEffect(() => {
    if (isRunning && markets.length) { poll(); ivRef.current = setInterval(poll, POLL_INTERVAL); }
    return () => clearInterval(ivRef.current);
  }, [isRunning, poll, markets]);

  useEffect(() => {
    if (!markets.length) return;
    const iv = setInterval(async () => {
      try {
        const r = await fetch(`${GAMMA_API}/events/slug/${EVENT_SLUG}`);
        const d = await r.json();
        setMarkets((prev) => prev.map((m) => {
          const f = d.markets.find((x) => x.conditionId === m.conditionId);
          if (!f) return m;
          return { ...m, yesPrice: JSON.parse(f.outcomePrices)[0], noPrice: JSON.parse(f.outcomePrices)[1], volume24h: f.volume24hr, lastTradePrice: f.lastTradePrice };
        }));
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
        @keyframes flashRow{0%{background:#fff3e0}50%{background:#fffaf5}100%{background:transparent}}
        @keyframes slideIn{from{transform:translateY(-3px);opacity:0}to{transform:translateY(0);opacity:1}}
        *{box-sizing:border-box}
        body{margin:0;background:#fff}
      `}</style>

      <div style={{ background: "#fff", color: "#1a1a1a", minHeight: "100vh", padding: "14px 20px", maxWidth: 960, margin: "0 auto", fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingBottom: 8, borderBottom: "1px solid #e8e8e8" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 24 }}>{"\uD83D\uDC0B"}</span>
            <div>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 700, color: "#111" }}>Whale Monitor</h1>
              <p style={{ margin: 0, fontSize: 13, color: "#999" }}>US {"\u00D7"} Iran Ceasefire {"\u2014"} Polymarket</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: isRunning ? "#22c55e" : "#ef4444" }} />
            <span style={{ fontSize: 14, color: "#999" }}>
              {isRunning ? "Live" : "Paused"}{lastCheck && ` \u00b7 ${lastCheck.toLocaleTimeString()}`}
            </span>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", marginBottom: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 3, fontWeight: 500 }}>Threshold</div>
            <div style={{ display: "flex", gap: 3 }}>
              {[500, 1000, 5000, 10000].map((v) => (
                <button key={v} onClick={() => { setThreshold(v); seenRef.current.clear(); }}
                  style={{ padding: "5px 11px", fontSize: 14, fontWeight: threshold === v ? 600 : 400, background: threshold === v ? "#f0f0f0" : "#fff", color: threshold === v ? "#111" : "#999", border: `1px solid ${threshold === v ? "#ccc" : "#e5e5e5"}`, borderRadius: 4, cursor: "pointer" }}>
                  {fmtUSD(v)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: "#aaa", marginBottom: 3, fontWeight: 500 }}>Market</div>
            <select value={selectedMarket} onChange={(e) => { setSelectedMarket(e.target.value); seenRef.current.clear(); }}
              style={{ padding: "5px 8px", fontSize: 14, background: "#fff", color: "#333", border: "1px solid #e5e5e5", borderRadius: 4, outline: "none", minWidth: 140 }}>
              <option value="all">All Markets</option>
              {markets.map((m) => (<option key={m.conditionId} value={m.conditionId}>{m.title}</option>))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 3 }}>
            <button onClick={() => setSoundOn(!soundOn)} style={{ padding: "5px 8px", fontSize: 18, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 4, cursor: "pointer" }}>{soundOn ? "\uD83D\uDD0A" : "\uD83D\uDD07"}</button>
            <button onClick={() => setIsRunning(!isRunning)} style={{ padding: "5px 8px", fontSize: 18, background: "#fff", border: "1px solid #e5e5e5", borderRadius: 4, cursor: "pointer" }}>{isRunning ? "\u23F8" : "\u25B6\uFE0F"}</button>
          </div>
        </div>

        {error && <div style={{ padding: "6px 10px", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 4, fontSize: 14, color: "#b91c1c", marginBottom: 8 }}>{error}</div>}

        {/* Market Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(175px,1fr))", gap: 6, marginBottom: 10 }}>
          {markets.map((m) => {
            const pct = (parseFloat(m.yesPrice) * 100).toFixed(0);
            return (
              <div key={m.conditionId} style={{ background: "#fafafa", border: "1px solid #eee", borderRadius: 5, padding: "7px 10px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#333" }}>{m.title}</span>
                  <span style={{ fontSize: 16, fontWeight: 700, color: pct > 50 ? "#16a34a" : "#dc2626" }}>{pct}%</span>
                </div>
                <div style={{ display: "flex", gap: 12, marginTop: 3 }}>
                  <div><span style={{ fontSize: 11, color: "#bbb" }}>YES </span><span style={{ fontSize: 14, fontWeight: 600, color: "#16a34a" }}>{m.yesPrice}</span></div>
                  <div><span style={{ fontSize: 11, color: "#bbb" }}>NO </span><span style={{ fontSize: 14, fontWeight: 600, color: "#dc2626" }}>{m.noPrice}</span></div>
                  <div><span style={{ fontSize: 11, color: "#bbb" }}>24H </span><span style={{ fontSize: 14, fontWeight: 500, color: "#666" }}>{fmtUSD(m.volume24h || 0)}</span></div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Stats */}
        <div style={{ display: "flex", gap: 24, padding: "8px 14px", background: "#fafafa", border: "1px solid #eee", borderRadius: 5, marginBottom: 8 }}>
          {[
            { label: "Trades", val: trades.length, color: "#111" },
            { label: "Value", val: fmtUSD(totalVal), color: "#111" },
            { label: "Buys", val: buys, color: "#16a34a" },
            { label: "Sells", val: sells, color: "#dc2626" },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 12, color: "#bbb", fontWeight: 500 }}>{s.label}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* Feed header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
          <span style={{ fontSize: 14, color: "#999", fontWeight: 500 }}>Trade Feed</span>
          <span style={{ fontSize: 13, color: "#ccc" }}>{trades.length} trades {"\u2265"} {fmtUSD(threshold)}</span>
        </div>

        {/* Feed */}
        <div style={{ maxHeight: 540, overflowY: "auto", borderRadius: 5, border: "1px solid #eee" }}>
          {trades.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "#ccc", fontSize: 15 }}>
              {isRunning ? "Scanning for whale trades..." : "Monitor paused"}
            </div>
          )}
          {trades.map((t) => {
            const val = t.size * t.price;
            const buy = t.side === "BUY";
            const whale = val >= 10000;
            return (
              <div key={t.transactionHash + t.timestamp}
                style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "7px 12px", borderBottom: "1px solid #f0f0f0",
                  borderLeft: `3px solid ${buy ? "#22c55e" : "#ef4444"}`,
                  animation: t.transactionHash === flashTx ? "flashRow 2s ease-out" : "slideIn .2s ease-out",
                  gap: 8,
                }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontSize: 12, fontWeight: 600, padding: "2px 6px", borderRadius: 3,
                    background: buy ? "#f0fdf4" : "#fef2f2", color: buy ? "#16a34a" : "#dc2626", flexShrink: 0,
                  }}>{t.side}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 600, color: "#333" }}>{(t.title || "").replace("US x Iran ceasefire by ", "")}</span>
                      <span style={{ fontSize: 12, fontWeight: 500, color: t.outcome === "Yes" ? "#16a34a" : "#ea580c" }}>{t.outcome}</span>
                    </div>
                    <div style={{ fontSize: 13, color: "#aaa", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {fmtSize(t.size)} @ {t.price} {"\u00b7"} {t.pseudonym || t.name || t.proxyWallet?.slice(0, 10)}
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: whale ? "#d97706" : "#333" }}>
                    {whale && "\uD83D\uDC0B "}{fmtUSD(val)}
                  </div>
                  <div style={{ fontSize: 12, color: "#ccc", marginTop: 1 }}>{timeAgo(t.timestamp)}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 12, paddingTop: 8, borderTop: "1px solid #eee", fontSize: 13, color: "#ccc", textAlign: "center" }}>
          Polling every {POLL_INTERVAL / 1000}s {"\u00b7"}{" "}
          <a href="https://polymarket.com/event/us-x-iran-ceasefire-by" target="_blank" rel="noopener" style={{ color: "#aaa" }}>polymarket.com</a>
        </div>
      </div>
    </>
  );
}
