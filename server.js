/**
 * Vednity — Node.js server (ZERO dependencies)
 * ---------------------------------------------
 * Uses only Node's built-in modules (http, fs, path, zlib, tls, crypto).
 * No `npm install` needed. Works on Hostinger Node.js hosting, Render,
 * Railway, a VPS, or any host running Node 18+.
 *
 * Serves the website from /public and handles:
 *   POST /api/contact    -> sends email via SMTP (Hostinger mail)
 *   POST /api/subscribe  -> stores newsletter signups in data/subscribers.json
 *   GET  /health         -> uptime check
 *
 * Configure with environment variables or a .env file (see .env.example).
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const tls = require("tls");
const net = require("net");
const crypto = require("crypto");

/* ---------- Load .env (no dotenv needed) ---------- */
(function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    let v = (m[2] || "").trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
})();

const ENV = process.env;
const PORT = Number(ENV.PORT || 3000);
const PROD = ENV.NODE_ENV === "production";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const CONTACT_TO = ENV.CONTACT_TO || ENV.SMTP_USER || "hello@vednity.com";

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".woff": "font/woff", ".woff2": "font/woff2", ".mp4": "video/mp4", ".webm": "video/webm", ".pdf": "application/pdf",
};
const COMPRESSIBLE = new Set([".html", ".css", ".js", ".json", ".svg", ".txt", ".xml"]);

/* ---------- Helpers ---------- */
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://www.googletagmanager.com; " +
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; " +
    "connect-src 'self' https://www.google-analytics.com https://*.google-analytics.com; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; object-src 'none'" + (PROD ? "; upgrade-insecure-requests" : ""),
};
if (PROD) SECURITY_HEADERS["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}

function readBody(req, limit = 50 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new Error("Payload too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const ct = (req.headers["content-type"] || "").toLowerCase();
      try {
        if (ct.includes("application/json")) return resolve(JSON.parse(raw || "{}"));
        if (ct.includes("multipart/form-data")) return resolve(parseMultipart(raw, req.headers["content-type"] || ""));
        resolve(Object.fromEntries(new URLSearchParams(raw)));
      } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

function parseMultipart(raw, ct) {
  const m = ct.match(/boundary=("?)([^";]+)\1/); const out = {};
  if (!m) return out;
  for (const part of raw.split("--" + m[2])) {
    const nm = part.match(/name="([^"]+)"/); if (!nm) continue;
    const idx = part.indexOf("\r\n\r\n"); if (idx < 0) continue;
    out[nm[1]] = part.slice(idx + 4).replace(/\r\n$/, "");
  }
  return out;
}

const clean = (v, max = 200) => String(v ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clientIP = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "";

/* ---------- Simple rate limiter (5 requests / 15 min per IP) ---------- */
const hits = new Map();
function rateLimited(ip, max = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(ip, arr); return true; }
  arr.push(now); hits.set(ip, arr); return false;
}
setInterval(() => { const now = Date.now(); for (const [ip, arr] of hits) if (!arr.some((t) => now - t < 15 * 60 * 1000)) hits.delete(ip); }, 10 * 60 * 1000).unref();

/* ---------- Minimal SMTP client (AUTH LOGIN over TLS / STARTTLS) ---------- */
function sendMail({ from, to, replyTo, subject, text, html }) {
  const host = ENV.SMTP_HOST || "smtp.hostinger.com";
  const port = Number(ENV.SMTP_PORT || 465);
  const secure = String(ENV.SMTP_SECURE ?? (port === 465)) === "true";
  const user = ENV.SMTP_USER, pass = ENV.SMTP_PASS;
  if (!user || !pass) return Promise.reject(new Error("SMTP_USER / SMTP_PASS not configured"));

  const boundary = "----vednity" + crypto.randomBytes(8).toString("hex");
  const b64 = (s) => Buffer.from(s, "utf8").toString("base64").replace(/(.{76})/g, "$1\r\n");
  const encHeader = (s) => /[^\x20-\x7e]/.test(s) ? "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=" : s;
  const msg = [
    `From: ${from}`, `To: ${to}`, replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${encHeader(subject)}`, `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${host}>`, "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`, "",
    `--${boundary}`, "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(text),
    `--${boundary}`, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", b64(html || `<pre>${esc(text)}</pre>`),
    `--${boundary}--`, "",
  ].filter((l) => l !== null).join("\r\n").replace(/^\.$/gm, "..");

  const envelopeFrom = (from.match(/<([^>]+)>/) || [, from])[1];
  const rcpts = [].concat(to).map((t) => (t.match(/<([^>]+)>/) || [, t])[1]);

  return new Promise(async (resolve, reject) => {
    let sock, buf = "", waiter = null, finished = false;
    const timer = setTimeout(() => fail(new Error("SMTP timeout")), 25000);
    const fail = (e) => { if (finished) return; finished = true; clearTimeout(timer); try { sock.destroy(); } catch {} reject(e); };
    const onData = (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^\d{3}( |$)/.test(line) && waiter) { const w = waiter; waiter = null; w(line); } // final line of reply
      }
    };
    const attach = (s) => { sock = s; sock.on("data", onData); sock.on("error", fail); };
    const reply = () => new Promise((r) => { waiter = r; });
    const cmd = async (c) => { const p = reply(); if (c !== null) sock.write(c + "\r\n"); const l = await p; if (parseInt(l, 10) >= 400) throw new Error("SMTP " + l.trim()); return l; };
    const connect = () => new Promise((r, j) => {
      const s = secure ? tls.connect({ host, port, servername: host }, () => r(s)) : net.connect({ host, port }, () => r(s));
      s.once("error", j);
    });
    try {
      attach(await connect());
      await cmd(null);                          // 220 greeting
      await cmd(`EHLO ${host}`);
      if (!secure) {                            // STARTTLS upgrade (port 587)
        await cmd("STARTTLS");
        const plain = sock; plain.removeListener("data", onData);
        const up = await new Promise((r, j) => { const t = tls.connect({ socket: plain, servername: host }, () => r(t)); t.once("error", j); });
        attach(up);
        await cmd(`EHLO ${host}`);
      }
      await cmd("AUTH LOGIN");
      await cmd(Buffer.from(user).toString("base64"));
      await cmd(Buffer.from(pass).toString("base64"));
      await cmd(`MAIL FROM:<${envelopeFrom}>`);
      for (const r of rcpts) await cmd(`RCPT TO:<${r}>`);
      await cmd("DATA");
      await cmd(msg + "\r\n.");
      await cmd("QUIT").catch(() => {});
      finished = true; clearTimeout(timer); sock.end(); resolve();
    } catch (e) { fail(e); }
  });
}


/* ---------- Lead magnet: 30-point checklist (edit freely) ---------- */
const CHECKLIST_ITEMS = {
  "Website & Conversion": ["Loads in under 3 seconds on mobile", "Clear headline + call-to-action above the fold", "Contact / WhatsApp button visible on every page", "Forms have 5 fields or fewer", "Trust signals: reviews, logos, guarantees", "Every page has one primary goal"],
  "SEO": ["Every page has a unique title + meta description", "Google Business Profile claimed and complete", "Site is mobile-friendly and has HTTPS", "One blog post / month targeting a real search query", "Internal links between related pages", "No broken links or 404 pages"],
  "Paid Ads": ["Conversion tracking installed (GA4 + pixel)", "Separate campaigns for search vs. social", "At least 3 ad creatives per ad set", "Dedicated landing page (not the homepage)", "Negative keywords reviewed weekly", "Retargeting audience set up"],
  "Social Media": ["Bio says what you do + who it's for + CTA", "Posting 3+ times a week consistently", "Short-form video (reels) in the mix", "Replying to comments and DMs within 24h", "Content pillars defined (educate / entertain / sell)", "Monthly review of top-performing posts"],
  "Email & Retention": ["Welcome email sequence for new leads", "Abandoned-enquiry / cart follow-up", "Monthly newsletter with real value", "Review-request email after every sale", "Customer list segmented by interest", "Reactivation campaign for cold leads"],
};
const CHECKLIST_TEXT = "Your 30-point Digital Marketing Checklist from Vednity\n\n" + Object.entries(CHECKLIST_ITEMS).map(([k, v]) => k.toUpperCase() + "\n" + v.map((i) => "[ ] " + i).join("\n")).join("\n\n") + "\n\nWant us to run this audit for you, free? Reply to this email or visit https://www.vednity.com/#contact\n\n— Team Vednity";
const CHECKLIST_HTML = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;max-width:600px"><h2 style="margin:0 0 6px">Your 30-point Digital Marketing Checklist</h2><p style="color:#666;margin-top:0">Tick each item honestly — anything unticked is a growth opportunity.</p>` +
  Object.entries(CHECKLIST_ITEMS).map(([k, v]) => `<h3 style="color:#7c5cff;margin:22px 0 8px">${k}</h3><ul style="padding-left:20px;margin:0">${v.map((i) => `<li>${i}</li>`).join("")}</ul>`).join("") +
  `<p style="margin-top:26px"><a href="https://www.vednity.com/#contact" style="background:#7c5cff;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Get a free audit from Vednity</a></p><p style="color:#888;font-size:13px">— Team Vednity</p></div>`;

/* ---------- Routes ---------- */
async function handleContact(req, res) {
  const ip = clientIP(req);
  if (rateLimited(ip)) return sendJSON(res, 429, { success: false, message: "Too many requests. Please try again in 15 minutes." });
  let b; try { b = await readBody(req); } catch { return sendJSON(res, 400, { success: false, message: "Invalid request." }); }

  if (b.website) return sendJSON(res, 200, { success: true, message: "Thanks! We'll get back to you within 24 hours." }); // honeypot

  const name = clean(b.name, 100), email = clean(b.email, 150), phone = clean(b.phone, 40);
  const service = clean(b.service, 80), budget = clean(b.budget, 40);
  const message = String(b.message || "").trim().slice(0, 5000);
  const consent = b.consent === "on" || b.consent === true || b.consent === "true";

  if (!name) return sendJSON(res, 400, { success: false, message: "Please enter your name." });
  if (!isEmail(email)) return sendJSON(res, 400, { success: false, message: "Please enter a valid email address." });
  if (!service) return sendJSON(res, 400, { success: false, message: "Please select a service." });
  if (!message) return sendJSON(res, 400, { success: false, message: "Please enter a message." });
  if (!consent) return sendJSON(res, 400, { success: false, message: "Please accept the privacy policy." });

  // Always keep a local copy of every enquiry
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, "enquiries.jsonl"), JSON.stringify({ date: new Date().toISOString(), ip, name, email, phone, service, budget, message }) + "\n");
  } catch (e) { console.warn("[contact] could not write enquiries.jsonl:", e.message); }

  if (!ENV.SMTP_USER || !ENV.SMTP_PASS) {
    console.error("[contact] SMTP not configured — enquiry saved to data/enquiries.jsonl only");
    return sendJSON(res, 200, { success: true, message: `Thanks ${name}! Your message has been received. We'll reply within 24 hours.` });
  }

  const from = `"Vednity Website" <${ENV.SMTP_FROM || ENV.SMTP_USER}>`;
  const text = `New enquiry from the Vednity website\n\nName:    ${name}\nEmail:   ${email}\nPhone:   ${phone || "—"}\nService: ${service}\nBudget:  ${budget || "—"}\nIP:      ${ip}\nDate:    ${new Date().toISOString()}\n\nMessage:\n${message}\n`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6"><h2 style="margin:0 0 12px">New enquiry from the Vednity website</h2>
<table cellpadding="6" style="border-collapse:collapse">
<tr><td><b>Name</b></td><td>${esc(name)}</td></tr><tr><td><b>Email</b></td><td><a href="mailto:${esc(email)}">${esc(email)}</a></td></tr>
<tr><td><b>Phone</b></td><td>${esc(phone || "—")}</td></tr><tr><td><b>Service</b></td><td>${esc(service)}</td></tr>
<tr><td><b>Budget</b></td><td>${esc(budget || "—")}</td></tr><tr><td><b>Date</b></td><td>${new Date().toLocaleString()}</td></tr></table>
<p style="white-space:pre-wrap;border-left:3px solid #7c5cff;padding-left:12px;margin-top:16px">${esc(message)}</p></div>`;

  try {
    await sendMail({ from, to: CONTACT_TO, replyTo: `"${name.replace(/"/g, "")}" <${email}>`, subject: `New enquiry: ${service} — ${name}`, text, html });
    if (ENV.AUTO_REPLY !== "false") {
      sendMail({ from: `"Vednity" <${ENV.SMTP_FROM || ENV.SMTP_USER}>`, to: email, subject: "We received your message — Vednity",
        text: `Hi ${name},\n\nThanks for reaching out to Vednity! We've received your enquiry about ${service} and will get back to you within 24 hours.\n\n— Team Vednity` })
        .catch((e) => console.warn("[contact] auto-reply failed:", e.message));
    }
    sendJSON(res, 200, { success: true, message: `Thanks ${name}! Your message has been sent. We'll reply within 24 hours.` });
  } catch (err) {
    console.error("[contact] send failed:", err.message);
    sendJSON(res, 500, { success: false, message: "Sorry, the message could not be sent right now. Please email us directly at " + CONTACT_TO + "." });
  }
}

async function handleSubscribe(req, res) {
  if (rateLimited(clientIP(req))) return sendJSON(res, 429, { success: false, message: "Too many requests." });
  let b; try { b = await readBody(req); } catch { return sendJSON(res, 400, { success: false, message: "Invalid request." }); }
  const email = clean(b.email, 150).toLowerCase();
  if (!isEmail(email)) return sendJSON(res, 400, { success: false, message: "Please enter a valid email." });
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const file = path.join(DATA_DIR, "subscribers.json");
    const list = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
    const source = clean(b.source, 40) || "newsletter";
    if (!list.some((s) => s.email === email)) { list.push({ email, source, date: new Date().toISOString() }); fs.writeFileSync(file, JSON.stringify(list, null, 2)); }
    sendJSON(res, 200, { success: true, message: "Subscribed!" });
    // Deliver the lead magnet promised by the exit popup (only if SMTP is configured)
    if (source === "checklist" && ENV.SMTP_USER && ENV.SMTP_PASS) {
      sendMail({ from: `"Vednity" <${ENV.SMTP_FROM || ENV.SMTP_USER}>`, to: email, subject: "Your 30-point Digital Marketing Checklist", text: CHECKLIST_TEXT, html: CHECKLIST_HTML })
        .catch((e) => console.warn("[subscribe] checklist email failed:", e.message));
    }
  } catch (e) { console.error("[subscribe]", e.message); sendJSON(res, 500, { success: false, message: "Could not subscribe right now." }); }
}

/* ---------- Static files ---------- */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath.split("?")[0]);
  if (rel === "/") rel = "/index.html";
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return notFound(res);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!fs.existsSync(file) && fs.existsSync(file + ".html")) file += ".html"; // clean URLs: /privacy -> privacy.html
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return notFound(res);
  return sendFile(req, res, file, 200);
}

function sendFile(req, res, file, status) {
  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  const etag = `W/"${stat.size}-${Number(stat.mtimeMs).toString(36)}"`;
  const headers = { ...SECURITY_HEADERS, "Content-Type": MIME[ext] || "application/octet-stream", ETag: etag, "Last-Modified": stat.mtime.toUTCString(), Vary: "Accept-Encoding" };
  const versioned = /[?&]v=/.test(req.url || "");
  headers["Cache-Control"] = ext === ".html" ? "no-cache" : !PROD ? "no-cache" : versioned ? "public, max-age=31536000, immutable" : "public, max-age=86400";
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
  const ae = req.headers["accept-encoding"] || "";
  let stream = fs.createReadStream(file);
  if (COMPRESSIBLE.has(ext) && stat.size > 1024) {
    if (ae.includes("br")) { headers["Content-Encoding"] = "br"; stream = stream.pipe(zlib.createBrotliCompress()); }
    else if (ae.includes("gzip")) { headers["Content-Encoding"] = "gzip"; stream = stream.pipe(zlib.createGzip()); }
  } else headers["Content-Length"] = stat.size;
  res.writeHead(status, headers);
  if (req.method === "HEAD") return res.end();
  stream.pipe(res);
}

function notFound(res) {
  const f = path.join(PUBLIC_DIR, "404.html");
  if (fs.existsSync(f)) { res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/html; charset=utf-8" }); return fs.createReadStream(f).pipe(res); }
  res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found");
}

/* ---------- Server ---------- */
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  if (ENV.LOG_REQUESTS !== "false") res.on("finish", () => { if (!/\.(css|js|png|svg|ico|webmanifest|woff2?)(\?|$)/.test(req.url || "")) console.log(`${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${Date.now() - started}ms`); });
  try {
    const url = req.url || "/";
    // Force HTTPS behind Hostinger's proxy
    if (PROD && ENV.FORCE_HTTPS !== "false" && req.headers["x-forwarded-proto"] === "http") {
      res.writeHead(301, { Location: "https://" + req.headers.host + url }); return res.end();
    }
    const pathname = url.split("?")[0];
    if (req.method === "POST" && pathname === "/api/contact") return await handleContact(req, res);
    if (req.method === "POST" && pathname === "/api/subscribe") return await handleSubscribe(req, res);
    if (pathname === "/health") return sendJSON(res, 200, { ok: true, uptime: Math.round(process.uptime()) });
    if (req.method !== "GET" && req.method !== "HEAD") return sendJSON(res, 405, { success: false, message: "Method not allowed" });
    return serveStatic(req, res, url);
  } catch (e) {
    console.error("[server]", e);
    if (!res.headersSent) sendJSON(res, 500, { success: false, message: "Server error" });
  }
});

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
server.listen(PORT, () => console.log(`Vednity website running on http://localhost:${PORT} (${PROD ? "production" : "development"})`));

/* ---------- Graceful shutdown & crash safety ---------- */
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
  console.log(`${sig} received — shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("uncaughtException", (e) => { console.error("[uncaughtException]", e); });

