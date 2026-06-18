// 로컬 네트워크 프롬프터 서버
// - 정적 페이지(/display, /remote)를 서빙하고
// - WebSocket으로 프롬프터 화면과 리모콘을 실시간으로 이어준다.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { WebSocketServer } = require("ws");
let QRCode = null;
try { QRCode = require("qrcode"); } catch { /* qrcode 없으면 QR 없이 동작 */ }

const PORT = process.env.PORT || 4173;
const PUBLIC = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

// 배포된 버전 확인용. 코드 바꿀 때마다 올린다.
const BUILD = "2026-06-18-flipfix";

function lanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal) return i.address;
    }
  }
  return "localhost";
}

function sendFile(res, file) {
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(file);
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    // HTML은 항상 최신을 받도록 캐시 금지(배포 후 옛 화면이 남는 문제 방지)
    if (ext === ".html") headers["Cache-Control"] = "no-store, must-revalidate";
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let p = url.pathname;

  if (p === "/version") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end(BUILD);
    return;
  }

  if (p === "/" || p === "/index.html") return sendFile(res, path.join(PUBLIC, "index.html"));
  if (p === "/display" || p === "/display.html") return sendFile(res, path.join(PUBLIC, "display.html"));
  if (p === "/remote" || p === "/remote.html") return sendFile(res, path.join(PUBLIC, "remote.html"));

  // 접속용 주소 + QR 코드(JSON)
  if (p === "/api/info") {
    // 클라우드(프록시 뒤)면 요청 헤더의 호스트/프로토콜을, 로컬이면 LAN IP를 쓴다.
    const proto = (req.headers["x-forwarded-proto"] || (req.socket.encrypted ? "https" : "http")).split(",")[0].trim();
    let host = req.headers.host || `${lanIP()}:${PORT}`;
    if (/^(localhost|127\.0\.0\.1)(:|$)/.test(host)) host = `${lanIP()}:${PORT}`;
    const base = `${proto}://${host}`;
    const info = { ip: host, port: PORT, base, display: `${base}/display`, remote: `${base}/remote` };
    if (QRCode) {
      try {
        info.displayQR = await QRCode.toDataURL(info.display, { margin: 1, width: 240 });
        info.remoteQR = await QRCode.toDataURL(info.remote, { margin: 1, width: 240 });
      } catch { /* ignore */ }
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(info));
    return;
  }

  // 그 외 정적 파일
  const safe = path.normalize(p).replace(/^(\.\.[/\\])+/, "");
  return sendFile(res, path.join(PUBLIC, safe));
});

// ── WebSocket 릴레이 ─────────────────────────────────────────────
const wss = new WebSocketServer({ server });

// 늦게 접속한 클라이언트를 위해 마지막 상태를 캐시한다.
let lastScript = null; // { type:'script', text }
let lastStatus = null; // { type:'status', ... } 프롬프터가 보고하는 현재 상태

function broadcast(sender, msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client !== sender && client.readyState === 1) client.send(data);
  }
}

wss.on("connection", (ws) => {
  ws.role = "unknown";
  // 접속 즉시 캐시된 상태 전달
  if (lastScript) ws.send(JSON.stringify(lastScript));
  if (lastStatus) ws.send(JSON.stringify(lastStatus));

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case "hello":
        ws.role = msg.role || "unknown";
        // 리모콘이 새로 들어오면 현재 상태를 다시 요청해 동기화
        if (ws.role === "remote") broadcast(ws, { type: "sync-request" });
        break;
      case "script":
        lastScript = { type: "script", text: msg.text || "" };
        broadcast(ws, lastScript);
        break;
      case "status":
        lastStatus = { ...msg, type: "status" };
        broadcast(ws, lastStatus);
        break;
      case "control":   // 리모콘 → 프롬프터
      case "sync-request":
        broadcast(ws, msg);
        break;
      default:
        broadcast(ws, msg);
    }
  });
});

server.listen(PORT, () => {
  const ip = lanIP();
  console.log("프롬프터 서버 실행 중");
  console.log(`  이 기기:   http://localhost:${PORT}`);
  console.log(`  같은 와이파이의 다른 기기:`);
  console.log(`    프롬프터(폰):  http://${ip}:${PORT}/display`);
  console.log(`    리모콘:        http://${ip}:${PORT}/remote`);
});
