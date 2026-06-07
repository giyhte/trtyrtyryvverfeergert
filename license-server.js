// OSM Simulator account + license portal.
// Run: node license-server.js
// Optional env:
//   PORT=8080
//   ADMIN_TOKEN=your-secret-admin-token
//   GAME_DIR=C:\path\to\web-osm-sim

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const tls = require("tls");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 8080);
const GAME_DIR = path.resolve(process.env.GAME_DIR || __dirname);
function resolveDataDir() {
  if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
  if (process.env.RENDER_DISK_PATH) return path.resolve(process.env.RENDER_DISK_PATH);
  for (const candidate of ["/data", "/var/data", "/opt/render/project/data"]) {
    try {
      if (fs.existsSync(candidate)) return path.resolve(candidate, "osm-simulator");
    } catch (_) {}
  }
  return path.resolve(__dirname, "portal-data");
}
const DATA_DIR = resolveDataDir();
const DATA_FILE = path.join(DATA_DIR, "licenses.json");
const LEGACY_DATA_FILE = path.join(__dirname, "licenses.json");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "osm-admin-2026";
const PORTAL_GAME_DIR = path.join(DATA_DIR, "portal-game");
const PORTAL_DEMO_DIR = path.join(DATA_DIR, "portal-demo");
const DEFAULT_DEMO_DIR = path.join(__dirname, "build", "demo", "osm-simulator-demo");
const ASSETS_DIR = path.join(DATA_DIR, "portal-assets");
const PENDING_UPDATE_DIR = path.join(DATA_DIR, "portal-updates-pending");
const EMAIL_OUTBOX_DIR = path.join(DATA_DIR, "portal-email-outbox");
const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
const sessions = new Map();
const onlineRooms = new Map();
const ONLINE_ROOM_TTL_MS = 1000 * 60 * 60 * 4;
const ONLINE_MAX_MESSAGE_BYTES = 64 * 1024;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".zip": "application/zip",
  ".wasm": "application/wasm",
};


const DEFAULT_BANNER_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="620" viewBox="0 0 1600 620">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="#020812"/>
      <stop offset=".48" stop-color="#0a2538"/>
      <stop offset="1" stop-color="#071018"/>
    </linearGradient>
    <radialGradient id="pulse" cx="70%" cy="42%" r="58%">
      <stop stop-color="#77dcff" stop-opacity=".48"/>
      <stop offset=".46" stop-color="#77dcff" stop-opacity=".13"/>
      <stop offset="1" stop-color="#77dcff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="gold" cx="24%" cy="74%" r="40%">
      <stop stop-color="#ffe879" stop-opacity=".34"/>
      <stop offset="1" stop-color="#ffe879" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="#9be8ff" stroke-opacity=".055"/>
      <circle cx="0" cy="0" r="1.4" fill="#9be8ff" fill-opacity=".11"/>
    </pattern>
    <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="9" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#000" flood-opacity=".42"/>
    </filter>
  </defs>
  <rect width="1600" height="620" fill="url(#bg)"/>
  <rect width="1600" height="620" fill="url(#grid)"/>
  <rect width="1600" height="620" fill="url(#pulse)"/>
  <rect width="1600" height="620" fill="url(#gold)"/>

  <g opacity=".18" stroke="#b6edff" stroke-width="2" fill="none">
    <path d="M-40 448 C175 344 337 472 548 382 S934 212 1282 292 S1510 332 1640 260"/>
    <path d="M-20 536 C270 418 458 612 710 460 S1110 368 1620 406"/>
    <path d="M170 -20 L1420 640 M455 -20 L1600 515 M-60 230 L955 650"/>
  </g>

  <g transform="translate(955 98)" filter="url(#softGlow)">
    <circle cx="252" cy="208" r="178" fill="none" stroke="#78dcff" stroke-opacity=".55" stroke-width="4"/>
    <circle cx="252" cy="208" r="88" fill="none" stroke="#94ffd3" stroke-opacity=".42" stroke-width="3"/>
    <path d="M252 208 L520 70" stroke="#78dcff" stroke-width="8" stroke-linecap="round" opacity=".55"/>
    <path d="M252 208 L105 390" stroke="#94ffd3" stroke-width="5" stroke-linecap="round" opacity=".5"/>
    <path d="M242 34 L286 170 L428 190 L313 273 L348 412 L252 339 L156 412 L191 273 L76 190 L218 170Z" fill="#78dcff" opacity=".12"/>
    <path d="M252 96 L282 188 L378 203 L302 260 L326 354 L252 304 L178 354 L202 260 L126 203 L222 188Z" fill="none" stroke="#e2f8ff" stroke-width="7" stroke-opacity=".62"/>
  </g>

  <g transform="translate(84 78)" filter="url(#shadow)">
    <rect width="735" height="390" rx="42" fill="#061723" fill-opacity=".74" stroke="#78dcff" stroke-opacity=".34"/>
    <path d="M54 112 h210" stroke="#78dcff" stroke-width="7" stroke-linecap="round" opacity=".9"/>
    <path d="M54 132 h86" stroke="#94ffd3" stroke-width="4" stroke-linecap="round" opacity=".75"/>
    <text x="54" y="88" font-family="Segoe UI, Arial, sans-serif" font-size="30" font-weight="900" fill="#78dcff" letter-spacing="7">TACTICAL ACCESS</text>
    <text x="54" y="190" font-family="Segoe UI, Arial, sans-serif" font-size="96" font-weight="950" fill="#eaf8ff" letter-spacing="13">OSM</text>
    <text x="58" y="252" font-family="Segoe UI, Arial, sans-serif" font-size="43" font-weight="900" fill="#a7eaff" letter-spacing="7">FRONTLINE COMMAND</text>
    <text x="60" y="309" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="700" fill="#b9d3e2">Browser license portal - demo - full library</text>
    <g transform="translate(54 330)">
      <rect width="184" height="54" rx="18" fill="#123d5c" stroke="#78dcff" stroke-opacity=".7"/>
      <text x="28" y="36" font-family="Segoe UI, Arial, sans-serif" font-size="19" font-weight="900" fill="#eaf8ff">LICENSE</text>
      <rect x="205" width="184" height="54" rx="18" fill="#0f3a31" stroke="#94ffd3" stroke-opacity=".7"/>
      <text x="238" y="36" font-family="Segoe UI, Arial, sans-serif" font-size="19" font-weight="900" fill="#eaf8ff">LIBRARY</text>
      <rect x="410" width="150" height="54" rx="18" fill="#453814" stroke="#ffe879" stroke-opacity=".72"/>
      <text x="460" y="36" font-family="Segoe UI, Arial, sans-serif" font-size="19" font-weight="900" fill="#fff1a6">PLAY</text>
    </g>
  </g>

  <g transform="translate(1060 438)" opacity=".92">
    <path d="M-8 44 C78 2 150 16 226 -16 S394 -60 516 -8" stroke="#78dcff" stroke-width="8" stroke-linecap="round" fill="none" opacity=".54"/>
    <path d="M44 20 L104 6 L92 44 Z" fill="#ff7c87"/>
    <path d="M210 -10 L286 -26 L267 23 Z" fill="#ffe879"/>
    <path d="M388 -24 L468 -45 L445 12 Z" fill="#94ffd3"/>
  </g>
</svg>`;

function ensureDirs() {
  for (const dir of [DATA_DIR, PORTAL_GAME_DIR, PORTAL_DEMO_DIR, ASSETS_DIR, PENDING_UPDATE_DIR, path.join(PENDING_UPDATE_DIR, "full"), path.join(PENDING_UPDATE_DIR, "demo"), EMAIL_OUTBOX_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
  if (DATA_FILE !== LEGACY_DATA_FILE && !fs.existsSync(DATA_FILE) && fs.existsSync(LEGACY_DATA_FILE)) {
    fs.copyFileSync(LEGACY_DATA_FILE, DATA_FILE);
  }
  fs.writeFileSync(path.join(ASSETS_DIR, "osm-banner.svg"), DEFAULT_BANNER_SVG, "utf8");
}

function starterDb() {
  return { createdAt: new Date().toISOString(), users: [], licenses: [], activations: [], uploads: [], pendingUpdates: [], releases: [], emailCodes: [] };
}

function normalizeDb(db) {
  db.users ||= [];
  db.licenses ||= [];
  db.activations ||= [];
  db.uploads ||= [];
  db.pendingUpdates ||= [];
  db.releases ||= [];
  db.emailCodes ||= [];
  for (const user of db.users) {
    user.role ||= "player";
    user.licenseKeys ||= [];
    user.settings ||= { email: "", nickname: user.login || "" };
    user.emailVerifiedAt ||= user.emailBoundAt || "";
    user.pendingEmail ||= "";
    user.cloudSaves ||= {};
    user.onlineStats ||= { matches: 0, wins: 0, losses: 0 };
  }
  return db;
}

function readDb() {
  if (!fs.existsSync(DATA_FILE)) {
    const db = starterDb();
    writeDb(db);
    return db;
  }
  return normalizeDb(JSON.parse(fs.readFileSync(DATA_FILE, "utf8")));
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizeDb(db), null, 2), "utf8");
}

function send(res, status, body, type = "text/html; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function sendJson(res, status, data, headers = {}) {
  return send(res, status, JSON.stringify(data), "application/json; charset=utf-8", headers);
}

function redirect(res, to) {
  res.writeHead(302, { Location: to });
  res.end();
}

function parseCookies(req) {
  const raw = req?.headers?.cookie || "";
  const out = {};
  raw.split(";").forEach((part) => {
    const idx = part.indexOf("=");
    if (idx < 0) return;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1));
  });
  return out;
}

function setCookie(res, name, value, maxAge = 43200) {
  res.setHeader("Set-Cookie", `${name}=${encodeURIComponent(value)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}

function getSession(req) {
  const sid = parseCookies(req).osm_session;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return session;
}

function getUser(req, db = readDb()) {
  const session = getSession(req);
  if (!session?.userId) return null;
  return db.users.find((u) => u.id === session.userId) || null;
}

function createUserSession(res, user) {
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, { userId: user.id, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14 });
  setCookie(res, "osm_session", sid, 1209600);
}

function getPostBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function formValue(body, key) {
  const params = new URLSearchParams(Buffer.isBuffer(body) ? body.toString("utf8") : body);
  return String(params.get(key) || "").trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(String(password), salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, saved) {
  const [salt, hash] = String(saved || "").split(":");
  if (!salt || !hash) return false;
  const current = hashPassword(password, salt).split(":")[1];
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(current));
}

function makeLicense() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const chunk = () => Array.from({ length: 4 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return `OSM-${chunk()}-${chunk()}-${chunk()}`;
}

function findLicense(db, key) {
  const normalized = String(key || "").trim().toUpperCase();
  return db.licenses.find((l) => l.key === normalized);
}

function isLicenseActive(license) {
  if (!license || !license.active) return false;
  if (!license.expiresAt) return true;
  return Date.parse(license.expiresAt) > Date.now();
}

function formatLicenseTime(license) {
  if (!license?.expiresAt) return "Infinite";
  const left = Date.parse(license.expiresAt) - Date.now();
  if (!Number.isFinite(left) || left <= 0) return "Expired";
  const days = Math.floor(left / 86400000);
  const hours = Math.ceil((left % 86400000) / 3600000);
  if (days > 0) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}


const UI_TEXT = {
  en: {
    library: "Library", settings: "Settings", logout: "Logout", login: "Login", register: "Register",
    portal: "OSM Game Portal", heroTitle: "OSM Frontline Command",
    heroLead: "A clean game portal: demo is available instantly, full version opens in the library after a license is saved to the account.",
    openLibrary: "Open library", playDemo: "Play demo", myLibrary: "My library", createAccount: "Create account",
    noLicenseNotice: "No license yet? Play demo now, then add a full license later.",
    demoNoKey: "Browser launch", demoNoKeyBody: "No install step: open the portal, sign in and start the version available to your account.",
    accountLicense: "Account security", accountLicenseBody: "Link an email to your profile so access is easier to restore later.",
    adminDrawer: "Game library", adminDrawerBody: "Full and Demo stay in one clean library with large launch buttons and license status.",
    footer: "OSM Simulator - custom browser portal", fullAccess: "Full access",
    licenseSaved: "License saved on this account. Key input is hidden because Full is already unlocked.",
    licenseStatus: "License status", time: "Time", key: "Key", addLicense: "Add license", licenseKey: "License key",
    saveToAccount: "Save to account", noLicenseDemo: "No license? You can still play the demo version.",
    fullVersion: "Full version", fullBrowser: "Full browser version with account license.", licenseTime: "License time",
    noLicense: "No license", playFull: "Play Full", demo: "Demo", demoBody: "Demo version is available without a license.",
    myLicenses: "My licenses", noLinkedKeys: "No linked keys yet.", active: "Active", blocked: "Blocked / expired",
    accountSettings: "Account settings", nickname: "Nickname", email: "Email or Telegram", save: "Save",
    newPassword: "New password", changePassword: "Change password", passwordChanged: "Password changed.", settingsSaved: "Settings saved.",
    enterAccount: "Login to account", username: "Login", password: "Password", alreadyAccount: "Already have an account?", noAccount: "No account?", createShort: "Create",
    profile: "Profile", emailBinding: "Email binding", emailBound: "Email linked", emailMissing: "Email is not linked yet", emailHelp: "Use a real email so the account can be restored if needed.", bindEmail: "Bind email", updateEmail: "Update email", emailAddress: "Email address", accountReady: "Account is ready", emailCodeSent: "Verification code sent. Check your email and enter the code below.", emailCodeLocal: "Verification code saved locally in portal-email-outbox because SMTP is not configured.", verifyEmail: "Verify email", verificationCode: "Verification code", sendCode: "Send code", emailPending: "Waiting for code", emailVerified: "Email verified", invalidCode: "Code is invalid or expired.", licenseCheck: "Checking license", licenseCheckBody: "Server is checking your active license before Full starts..."
  },
  uk: {
    library: "\u0411\u0456\u0431\u043b\u0456\u043e\u0442\u0435\u043a\u0430", settings: "\u041d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f", logout: "\u0412\u0438\u0439\u0442\u0438", login: "\u0423\u0432\u0456\u0439\u0442\u0438", register: "\u0420\u0435\u0454\u0441\u0442\u0440\u0430\u0446\u0456\u044f",
    portal: "\u0406\u0433\u0440\u043e\u0432\u0438\u0439 \u043f\u043e\u0440\u0442\u0430\u043b OSM", heroTitle: "OSM Frontline Command",
    heroLead: "\u0414\u0435\u043c\u043e \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0435 \u043e\u0434\u0440\u0430\u0437\u0443, \u0430 \u043f\u043e\u0432\u043d\u0430 \u0432\u0435\u0440\u0441\u0456\u044f \u0432\u0456\u0434\u043a\u0440\u0438\u0432\u0430\u0454\u0442\u044c\u0441\u044f \u0432 \u0431\u0456\u0431\u043b\u0456\u043e\u0442\u0435\u0446\u0456 \u043f\u0456\u0441\u043b\u044f \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043d\u044f \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0457.",
    openLibrary: "\u0412\u0456\u0434\u043a\u0440\u0438\u0442\u0438 \u0431\u0456\u0431\u043b\u0456\u043e\u0442\u0435\u043a\u0443", playDemo: "\u0413\u0440\u0430\u0442\u0438 \u0434\u0435\u043c\u043e", myLibrary: "\u041c\u043e\u044f \u0431\u0456\u0431\u043b\u0456\u043e\u0442\u0435\u043a\u0430", createAccount: "\u0421\u0442\u0432\u043e\u0440\u0438\u0442\u0438 \u0430\u043a\u0430\u0443\u043d\u0442",
    noLicenseNotice: "\u041d\u0435\u043c\u0430\u0454 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0457? \u041c\u043e\u0436\u043d\u0430 \u0433\u0440\u0430\u0442\u0438 \u0432 \u0434\u0435\u043c\u043e, \u0430 \u043f\u043e\u0432\u043d\u0443 \u0432\u0435\u0440\u0441\u0456\u044e \u0434\u043e\u0434\u0430\u0442\u0438 \u043f\u0456\u0437\u043d\u0456\u0448\u0435.",
    demoNoKey: "\u0417\u0430\u043f\u0443\u0441\u043a \u0432 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0456", demoNoKeyBody: "\u0411\u0435\u0437 \u0432\u0441\u0442\u0430\u043d\u043e\u0432\u043b\u0435\u043d\u043d\u044f: \u0432\u0456\u0434\u043a\u0440\u0438\u0432 \u043f\u043e\u0440\u0442\u0430\u043b, \u0443\u0432\u0456\u0439\u0448\u043e\u0432 \u0456 \u0437\u0430\u043f\u0443\u0441\u0442\u0438\u0432 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0443 \u0432\u0435\u0440\u0441\u0456\u044e.",
    accountLicense: "\u0417\u0430\u0445\u0438\u0441\u0442 \u0430\u043a\u0430\u0443\u043d\u0442\u0430", accountLicenseBody: "\u041f\u0440\u0438\u0432\u0027\u044f\u0436\u0438 \u043f\u043e\u0448\u0442\u0443, \u0449\u043e\u0431 \u0431\u0443\u043b\u043e \u043b\u0435\u0433\u0448\u0435 \u0432\u0456\u0434\u043d\u043e\u0432\u0438\u0442\u0438 \u0434\u043e\u0441\u0442\u0443\u043f.",
    adminDrawer: "\u0411\u0456\u0431\u043b\u0456\u043e\u0442\u0435\u043a\u0430 \u0433\u0440\u0438", adminDrawerBody: "Full \u0456 Demo \u0437\u0456\u0431\u0440\u0430\u043d\u0456 \u0432 \u043e\u0434\u043d\u0456\u0439 \u0447\u0438\u0441\u0442\u0456\u0439 \u0431\u0456\u0431\u043b\u0456\u043e\u0442\u0435\u0446\u0456 \u0437 \u0432\u0435\u043b\u0438\u043a\u0438\u043c\u0438 \u043a\u043d\u043e\u043f\u043a\u0430\u043c\u0438.",
    footer: "OSM Simulator - \u0432\u043b\u0430\u0441\u043d\u0438\u0439 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u043d\u0438\u0439 \u043f\u043e\u0440\u0442\u0430\u043b", fullAccess: "\u041f\u043e\u0432\u043d\u0438\u0439 \u0434\u043e\u0441\u0442\u0443\u043f",
    licenseSaved: "\u041b\u0456\u0446\u0435\u043d\u0437\u0456\u044f \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u0430 \u043d\u0430 \u0446\u044c\u043e\u043c\u0443 \u0430\u043a\u0430\u0443\u043d\u0442\u0456. \u0412\u0432\u0435\u0434\u0435\u043d\u043d\u044f \u043a\u043b\u044e\u0447\u0430 \u0441\u0445\u043e\u0432\u0430\u043d\u043e.",
    licenseStatus: "\u0421\u0442\u0430\u0442\u0443\u0441 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0457", time: "\u0427\u0430\u0441", key: "\u041a\u043b\u044e\u0447", addLicense: "\u0414\u043e\u0434\u0430\u0442\u0438 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u044e", licenseKey: "\u041b\u0456\u0446\u0435\u043d\u0437\u0456\u0439\u043d\u0438\u0439 \u043a\u043b\u044e\u0447",
    saveToAccount: "\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438 \u0432 \u0430\u043a\u0430\u0443\u043d\u0442", noLicenseDemo: "\u041d\u0435\u043c\u0430\u0454 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0457? \u0414\u0435\u043c\u043e \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0435.",
    fullVersion: "\u041f\u043e\u0432\u043d\u0430 \u0432\u0435\u0440\u0441\u0456\u044f", fullBrowser: "\u041f\u043e\u0432\u043d\u0430 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u043d\u0430 \u0432\u0435\u0440\u0441\u0456\u044f \u0437 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0454\u044e.", licenseTime: "\u0427\u0430\u0441 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0457",
    noLicense: "\u041d\u0435\u043c\u0430\u0454 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0457", playFull: "\u0413\u0440\u0430\u0442\u0438 Full", demo: "\u0414\u0435\u043c\u043e", demoBody: "\u0414\u0435\u043c\u043e-\u0432\u0435\u0440\u0441\u0456\u044f \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u0430 \u0431\u0435\u0437 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0457.",
    myLicenses: "\u041c\u043e\u0457 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0457", noLinkedKeys: "\u041f\u0440\u0438\u0432\u0027\u044f\u0437\u0430\u043d\u0438\u0445 \u043a\u043b\u044e\u0447\u0456\u0432 \u0449\u0435 \u043d\u0435\u043c\u0430\u0454.", active: "\u0410\u043a\u0442\u0438\u0432\u043d\u0430", blocked: "\u0417\u0430\u0431\u043b\u043e\u043a\u043e\u0432\u0430\u043d\u0430 / \u0437\u0430\u043a\u0456\u043d\u0447\u0438\u043b\u0430\u0441\u044f",
    accountSettings: "\u041d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f \u0430\u043a\u0430\u0443\u043d\u0442\u0430", nickname: "\u041d\u0456\u043a", email: "Email \u0430\u0431\u043e Telegram", save: "\u0417\u0431\u0435\u0440\u0435\u0433\u0442\u0438",
    newPassword: "\u041d\u043e\u0432\u0438\u0439 \u043f\u0430\u0440\u043e\u043b\u044c", changePassword: "\u0417\u043c\u0456\u043d\u0438\u0442\u0438 \u043f\u0430\u0440\u043e\u043b\u044c", passwordChanged: "\u041f\u0430\u0440\u043e\u043b\u044c \u0437\u043c\u0456\u043d\u0435\u043d\u043e.", settingsSaved: "\u041d\u0430\u043b\u0430\u0448\u0442\u0443\u0432\u0430\u043d\u043d\u044f \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043e.",
    enterAccount: "\u0423\u0432\u0456\u0439\u0442\u0438 \u0432 \u0430\u043a\u0430\u0443\u043d\u0442", username: "\u041b\u043e\u0433\u0456\u043d", password: "\u041f\u0430\u0440\u043e\u043b\u044c", alreadyAccount: "\u0412\u0436\u0435 \u0454 \u0430\u043a\u0430\u0443\u043d\u0442?", noAccount: "\u041d\u0435\u043c\u0430\u0454 \u0430\u043a\u0430\u0443\u043d\u0442\u0430?", createShort: "\u0421\u0442\u0432\u043e\u0440\u0438\u0442\u0438",
    profile: "\u041f\u0440\u043e\u0444\u0456\u043b\u044c", emailBinding: "\u041f\u0440\u0438\u0432\u0027\u044f\u0437\u043a\u0430 \u043f\u043e\u0448\u0442\u0438", emailBound: "\u041f\u043e\u0448\u0442\u0443 \u043f\u0440\u0438\u0432\u0027\u044f\u0437\u0430\u043d\u043e", emailMissing: "\u041f\u043e\u0448\u0442\u0443 \u0449\u0435 \u043d\u0435 \u043f\u0440\u0438\u0432\u0027\u044f\u0437\u0430\u043d\u043e", emailHelp: "\u0412\u043a\u0430\u0436\u0438 \u0440\u0435\u0430\u043b\u044c\u043d\u0443 \u043f\u043e\u0448\u0442\u0443, \u0449\u043e\u0431 \u043f\u0440\u0438 \u043f\u043e\u0442\u0440\u0435\u0431\u0456 \u0432\u0456\u0434\u043d\u043e\u0432\u0438\u0442\u0438 \u0434\u043e\u0441\u0442\u0443\u043f.", bindEmail: "\u041f\u0440\u0438\u0432\u0027\u044f\u0437\u0430\u0442\u0438 \u043f\u043e\u0448\u0442\u0443", updateEmail: "\u041e\u043d\u043e\u0432\u0438\u0442\u0438 \u043f\u043e\u0448\u0442\u0443", emailAddress: "Email", accountReady: "\u0410\u043a\u0430\u0443\u043d\u0442 \u0433\u043e\u0442\u043e\u0432\u0438\u0439", emailCodeSent: "\u041a\u043e\u0434 \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043d\u044f \u043d\u0430\u0434\u0456\u0441\u043b\u0430\u043d\u043e. \u0412\u0432\u0435\u0434\u0438 \u0439\u043e\u0433\u043e \u043d\u0438\u0436\u0447\u0435.", emailCodeLocal: "\u041a\u043e\u0434 \u0437\u0431\u0435\u0440\u0435\u0436\u0435\u043d\u043e \u043b\u043e\u043a\u0430\u043b\u044c\u043d\u043e \u0432 portal-email-outbox, \u0431\u043e SMTP \u043d\u0435 \u043d\u0430\u043b\u0430\u0448\u0442\u043e\u0432\u0430\u043d\u043e.", verifyEmail: "\u041f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0438 email", verificationCode: "\u041a\u043e\u0434", sendCode: "\u041d\u0430\u0434\u0456\u0441\u043b\u0430\u0442\u0438 \u043a\u043e\u0434", emailPending: "\u041e\u0447\u0456\u043a\u0443\u0454 \u043a\u043e\u0434", emailVerified: "Email \u043f\u0456\u0434\u0442\u0432\u0435\u0440\u0434\u0436\u0435\u043d\u043e", invalidCode: "\u041a\u043e\u0434 \u043d\u0435\u0432\u0456\u0440\u043d\u0438\u0439 \u0430\u0431\u043e \u0437\u0430\u0441\u0442\u0430\u0440\u0456\u0432.", licenseCheck: "\u041f\u0435\u0440\u0435\u0432\u0456\u0440\u043a\u0430 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u0457", licenseCheckBody: "\u0421\u0435\u0440\u0432\u0435\u0440 \u043f\u0435\u0440\u0435\u0432\u0456\u0440\u044f\u0454 \u0430\u043a\u0442\u0438\u0432\u043d\u0443 \u043b\u0456\u0446\u0435\u043d\u0437\u0456\u044e \u043f\u0435\u0440\u0435\u0434 \u0437\u0430\u043f\u0443\u0441\u043a\u043e\u043c Full..."
  }
};

function getLang(req) {
  const lang = parseCookies(req || {}).osm_lang;
  return lang === "uk" ? "uk" : "en";
}

function ui(lang, key) {
  return UI_TEXT[lang]?.[key] || UI_TEXT.en[key] || key;
}

function renderLangSwitch(lang) {
  return `<span class="lang-switch" aria-label="Language"><a class="lang-pill ${lang === "en" ? "active" : ""}" href="/lang?set=en">EN</a><a class="lang-pill ${lang === "uk" ? "active" : ""}" href="/lang?set=uk">\u0423\u041a\u0420</a></span>`;
}

function canAdmin(req, user = null) {
  return parseCookies(req || {}).osm_admin === ADMIN_TOKEN || user?.role === "admin";
}

function renderAdminDock(req, user, db) {
  if (!canAdmin(req, user)) return "";
  const pendingCount = (db.pendingUpdates || []).length;
  const users = db.users.slice().sort((a, b) => a.login.localeCompare(b.login));
  const userRows = users.map((u) => `<div class="admin-user"><b>${escapeHtml(u.login)}</b><span>${escapeHtml(u.role || "player")} - ${(u.licenseKeys || []).length} keys</span><form method="post" action="/admin/user-rights"><input type="hidden" name="userId" value="${escapeHtml(u.id)}"><select name="role"><option value="player" ${u.role === "player" ? "selected" : ""}>player</option><option value="moderator" ${u.role === "moderator" ? "selected" : ""}>moderator</option><option value="admin" ${u.role === "admin" ? "selected" : ""}>admin</option></select><button type="submit">Rights</button></form><form method="post" action="/admin/grant-full"><input type="hidden" name="userId" value="${escapeHtml(u.id)}"><button type="submit">Grant Full</button></form></div>`).join("");
  return `<button class="admin-fab" id="adminFab" type="button">ADMIN</button><aside class="admin-drawer" id="adminDrawer"><div class="drawer-head"><div><b>Developer panel</b><span>${pendingCount} files waiting for release</span></div><button id="adminClose" type="button">x</button></div><section class="drawer-block"><h3>Upload game folder</h3><form method="post" action="/admin/upload-folder" enctype="multipart/form-data" data-folder-upload><select name="scope"><option value="full">Full version</option><option value="demo">Demo version</option></select><input name="version" placeholder="Patch version"><input name="files" type="file" webkitdirectory directory multiple required><button type="submit">Upload folder</button></form><p class="muted">Pick the folder with index.html. Paths are detected automatically.</p></section><section class="drawer-block"><h3>Release</h3><p class="muted">Draft files do not affect the live game until you publish.</p><form method="post" action="/admin/publish"><button class="primary" type="submit" ${pendingCount ? "" : "disabled"}>Publish update (${pendingCount})</button></form></section><section class="drawer-block"><h3>License</h3><form method="post" action="/admin/create"><input name="owner" placeholder="owner"><input name="maxUses" type="number" min="1" max="20" value="1"><button type="submit">Create key</button></form></section><section class="drawer-block"><h3>Account rights</h3>${userRows || `<p class="muted">No accounts yet.</p>`}</section><a class="drawer-link" href="/admin">Open full admin workspace</a></aside><script>document.addEventListener('click',function(e){if(e.target&&e.target.id==='adminFab')document.body.classList.add('admin-open');if(e.target&&e.target.id==='adminClose')document.body.classList.remove('admin-open');});</script>`;
}

function pageShell(title, body, req = null, user = null, db = null) {
  if (req && !req.headers) { user = req; req = null; }
  db ||= readDb();
  const lang = getLang(req || {});
  const logged = user ? `<a class="nav-link" href="/library">${ui(lang, "library")}</a><a class="nav-link" href="/settings">${ui(lang, "settings")}</a><a class="nav-link" href="/logout">${ui(lang, "logout")}</a>` : `<a class="nav-link" href="/login">${ui(lang, "login")}</a><a class="nav-link primary" href="/register">${ui(lang, "register")}</a>`;
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>
    :root{--panel:rgba(8,23,35,.94);--line:rgba(116,216,255,.38);--text:#ddf3ff;--muted:#9cb9cc;--accent:#78dcff;--good:#94ffd3;--bad:#ff7c87;--gold:#ffe879}*{box-sizing:border-box}body{margin:0;min-height:100vh;color:var(--text);font-family:"Segoe UI",Arial,sans-serif;background:radial-gradient(circle at 15% 10%,rgba(120,220,255,.18),transparent 34%),radial-gradient(circle at 80% 5%,rgba(148,255,211,.12),transparent 26%),linear-gradient(135deg,#02070d,#081827 58%,#11171c);overflow-x:hidden}a{color:inherit}.wrap{width:min(1180px,calc(100% - 28px));margin:0 auto}.nav{position:sticky;top:0;z-index:20;backdrop-filter:blur(16px);background:rgba(3,10,16,.76);border-bottom:1px solid rgba(116,216,255,.22)}.nav-inner{height:72px;display:flex;align-items:center;justify-content:space-between;gap:14px}.brand{display:flex;gap:12px;align-items:center;font-weight:900;letter-spacing:.08em;text-decoration:none}.logo{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;background:linear-gradient(135deg,rgba(120,220,255,.3),rgba(148,255,211,.18));border:1px solid var(--line);color:var(--accent)}.nav-actions,.actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.lang-switch{display:flex;gap:4px;align-items:center;padding:4px;border:1px solid rgba(120,220,255,.35);border-radius:16px;background:rgba(4,14,22,.58)}.lang-pill{min-width:42px;text-align:center;border-radius:12px;padding:8px 10px;color:#9cb9cc;text-decoration:none;font-weight:950;letter-spacing:.06em}.lang-pill.active{background:linear-gradient(135deg,#78dcff,#195373);color:#06111a;box-shadow:0 0 24px rgba(120,220,255,.3)}.nav-link,.button,button{border:1px solid rgba(120,220,255,.55);border-radius:15px;padding:12px 16px;color:#eaf8ff;background:linear-gradient(135deg,#143d5b,#092136);font-weight:900;text-decoration:none;cursor:pointer;font:inherit}.primary{background:linear-gradient(135deg,#69d5ff,#195373)!important;color:#06111a!important}.danger{border-color:rgba(255,124,135,.6)!important;background:linear-gradient(135deg,#61202b,#251018)!important}.ghost{background:rgba(4,14,22,.55)!important}.hero{padding:34px 0 42px}.hero-card{min-height:470px;border:1px solid var(--line);border-radius:34px;overflow:hidden;background:var(--panel);box-shadow:0 24px 80px rgba(0,0,0,.38);display:grid;grid-template-columns:1fr 1fr}.hero-copy{padding:44px;display:flex;flex-direction:column;justify-content:center}.hero-art{min-height:380px;background:url('/assets/osm-banner.svg') center/cover no-repeat}.eyebrow{color:var(--accent);font-weight:900;letter-spacing:.18em;text-transform:uppercase}.title{font-size:clamp(42px,6vw,82px);line-height:.92;margin:14px 0}.lead{font-size:18px;color:var(--muted);line-height:1.65}.panel{border:1px solid var(--line);border-radius:26px;background:var(--panel);box-shadow:0 20px 55px rgba(0,0,0,.28);padding:24px}.grid,.grid2{display:grid;gap:16px}.grid{grid-template-columns:repeat(3,1fr)}.grid2{grid-template-columns:repeat(2,1fr)}.card,.game-card{border:1px solid rgba(116,216,255,.24);border-radius:22px;background:rgba(3,14,22,.64);padding:18px}.game-card{display:grid;grid-template-columns:190px 1fr;gap:18px;align-items:center}.cover{height:124px;border-radius:20px;background:url('/assets/osm-banner.svg') center/cover no-repeat;border:1px solid rgba(116,216,255,.32)}.muted{color:var(--muted)}.ok{color:var(--good)}.bad{color:var(--bad)}.gold{color:var(--gold)}input,select{width:100%;border:1px solid var(--line);border-radius:15px;padding:13px 15px;color:var(--text);background:#061522;outline:none;font:inherit}label{display:block;color:var(--muted);font-weight:800;margin:0 0 7px}.form{display:grid;gap:14px;max-width:560px}.notice{padding:12px 14px;border:1px solid rgba(116,216,255,.28);border-radius:16px;background:rgba(116,216,255,.08);margin:0 0 14px}.profile-line{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0 14px}.chip{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border-radius:999px;background:rgba(148,255,211,.1);border:1px solid rgba(148,255,211,.26);color:var(--good);font-weight:900}.chip.warn{background:rgba(255,232,121,.08);border-color:rgba(255,232,121,.26);color:var(--gold)}table{width:100%;border-collapse:collapse}th,td{padding:11px;border-bottom:1px solid rgba(116,216,255,.14);text-align:left}th{color:var(--accent);background:rgba(116,216,255,.08)}code{display:inline-block;padding:4px 8px;border-radius:10px;background:rgba(255,255,255,.06);color:var(--gold);font-weight:900}.admin-layout{display:grid;gap:16px;padding:24px 0 44px}.split{display:grid;grid-template-columns:1fr 1fr;gap:14px}.footer{padding:38px 0;color:var(--muted);text-align:center}.admin-fab{position:fixed;right:18px;top:96px;z-index:60;min-width:64px;height:54px;border-radius:19px;padding:0 14px;font-size:16px;box-shadow:0 16px 50px rgba(0,0,0,.4)}.admin-drawer{position:fixed;left:50%;top:86px;z-index:70;width:min(860px,calc(100vw - 24px));max-height:calc(100vh - 110px);overflow:auto;padding:18px;background:rgba(5,16,25,.98);border:1px solid var(--line);border-radius:28px;box-shadow:0 32px 100px rgba(0,0,0,.58);transform:translate(-50%,-130%);opacity:0;transition:.28s ease}.admin-open .admin-drawer{transform:translate(-50%,0);opacity:1}.admin-open:before{content:"";position:fixed;inset:0;z-index:65;background:rgba(0,0,0,.34);backdrop-filter:blur(5px)}.drawer-head{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:14px}.drawer-head b{display:block;font-size:24px}.drawer-head span{color:var(--muted)}.drawer-head button{width:46px;height:46px;padding:0;border-radius:16px}.drawer-block{border:1px solid rgba(116,216,255,.22);border-radius:20px;padding:14px;margin-bottom:12px;background:rgba(4,14,22,.62)}.drawer-block form{display:grid;gap:9px}.admin-user{display:grid;gap:8px;padding:10px;border-radius:16px;background:rgba(255,255,255,.04);margin-bottom:8px}.admin-user span{display:block;color:var(--muted);font-size:13px}.drawer-link{display:block;text-align:center;text-decoration:none;border:1px solid var(--line);border-radius:16px;padding:13px}.top{display:flex;justify-content:space-between;gap:14px;align-items:center}.toast{position:sticky;top:86px;z-index:30;margin:0 auto 16px;width:min(720px,100%);animation:toastIn .24s ease}.release-list{display:grid;gap:10px}.release-item{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px;border:1px solid rgba(116,216,255,.18);border-radius:16px;background:rgba(255,255,255,.035)}@keyframes toastIn{from{transform:translateY(-12px);opacity:0}to{transform:none;opacity:1}}.admin-kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.admin-kpi .card b{font-size:28px;color:var(--accent)}@media(max-width:850px){.hero-card,.grid,.grid2,.game-card,.split{grid-template-columns:1fr}.hero-copy{padding:26px}.nav-inner{height:auto;padding:12px 0;align-items:flex-start}.nav-actions{justify-content:flex-end}.hero-art{min-height:240px}.top{display:block}}
  </style></head><body><header class="nav"><div class="wrap nav-inner"><a class="brand" href="/"><span class="logo">OSM</span><span>OSM Simulator</span></a><nav class="nav-actions">${logged}${renderLangSwitch(lang)}</nav></div></header>${body}${renderAdminDock(req || { headers: {} }, user, db)}</body></html>`;
}

function homePage(req = null, user = null, db = readDb()) {
  if (req && !req.headers) { user = req; req = null; }
  const lang = getLang(req || {});
  const L = (key) => ui(lang, key);
  const hasFull = userHasGame(user, db);
  return pageShell("OSM Simulator", `<main class="wrap hero"><section class="hero-card"><div class="hero-copy"><div class="eyebrow">${L("portal")}</div><h1 class="title">${L("heroTitle")}</h1><p class="lead">${L("heroLead")}</p><div class="actions"><a class="button primary" href="${hasFull ? "/library" : "/demo/"}">${hasFull ? L("openLibrary") : L("playDemo")}</a><a class="button ghost" href="${user ? "/library" : "/register"}">${user ? L("myLibrary") : L("createAccount")}</a></div>${!hasFull ? `<p class="notice" style="margin-top:22px">${L("noLicenseNotice")}</p>` : ""}</div><div class="hero-art"></div></section><section class="grid" style="margin-top:16px"><div class="card"><h3>${L("demoNoKey")}</h3><p class="muted">${L("demoNoKeyBody")}</p></div><div class="card"><h3>${L("accountLicense")}</h3><p class="muted">${L("accountLicenseBody")}</p></div><div class="card"><h3>${L("adminDrawer")}</h3><p class="muted">${L("adminDrawerBody")}</p></div></section></main><footer class="footer">${L("footer")}</footer>`, req, user, db);
}

function authPage(type, message = "", req = null) {
  const lang = getLang(req || {});
  const L = (key) => ui(lang, key);
  const isReg = type === "register";
  return pageShell(isReg ? L("register") : L("login"), `<main class="wrap hero"><section class="panel" style="max-width:620px;margin:auto"><h1 style="margin-top:0">${isReg ? L("createAccount") : L("enterAccount")}</h1>${message ? `<div class="notice bad">${escapeHtml(message)}</div>` : ""}<form class="form" method="post" action="/${isReg ? "register" : "login"}"><div><label>${L("username")}</label><input name="login" autocomplete="username" required></div><div><label>${L("password")}</label><input name="password" type="password" autocomplete="${isReg ? "new-password" : "current-password"}" required></div><button class="primary" type="submit">${isReg ? L("register") : L("login")}</button></form><p class="muted">${isReg ? L("alreadyAccount") : L("noAccount")} <a href="/${isReg ? "login" : "register"}">${isReg ? L("login") : L("createShort")}</a></p></section></main>`, req);
}

function libraryPage(user, db, message = "", req = null) {
  const lang = getLang(req || {});
  const L = (key) => ui(lang, key);
  const licenses = db.licenses.filter((l) => user.licenseKeys?.includes(l.key));
  const activeLicense = licenses.find((l) => isLicenseActive(l));
  const hasActive = Boolean(activeLicense);
  const email = user.settings?.email || "";
  const emailVerified = Boolean(user.emailVerifiedAt && email);
  const pendingEmail = user.pendingEmail || "";
  const list = licenses.map((l) => `<div class="card"><h3><code>${escapeHtml(l.key)}</code></h3><p class="${isLicenseActive(l) ? "ok" : "bad"}">${isLicenseActive(l) ? L("active") : L("blocked")}</p><p class="muted">${L("licenseTime")}: <b class="gold">${formatLicenseTime(l)}</b></p></div>`).join("");
  const licensePanel = hasActive
    ? `<div class="panel"><h2>${L("fullAccess")}</h2><p class="notice ok">${L("licenseSaved")}</p><div class="card"><h3>${L("licenseStatus")}</h3><p class="muted">${L("time")}: <b class="gold">${formatLicenseTime(activeLicense)}</b></p><p class="muted">${L("key")}: <code>${escapeHtml(activeLicense.key)}</code></p></div></div>`
    : `<div class="panel"><h2>${L("addLicense")}</h2>${message ? `<div class="notice">${escapeHtml(message)}</div>` : ""}<form class="form" method="post" action="/claim"><div><label>${L("licenseKey")}</label><input name="license" placeholder="OSM-XXXX-XXXX-XXXX" required></div><button type="submit">${L("saveToAccount")}</button></form><p class="muted">${L("noLicenseDemo")}</p></div>`;
  const pendingBox = pendingEmail ? `<form class="form" method="post" action="/account/email/verify"><p class="notice">${L("emailPending")}: <b>${escapeHtml(pendingEmail)}</b></p><div><label>${L("verificationCode")}</label><input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="123456" required></div><button type="submit">${L("verifyEmail")}</button></form>` : "";
  const profilePanel = `<div class="panel"><h2>${L("profile")}</h2><div class="profile-line"><span class="muted">${escapeHtml(user.login)}</span><span class="chip ${emailVerified ? "" : "warn"}">${emailVerified ? L("emailVerified") : (pendingEmail ? L("emailPending") : L("emailMissing"))}</span></div>${pendingBox}<form class="form" method="post" action="/account/email"><div><label>${L("emailAddress")}</label><input name="email" type="email" value="${escapeHtml(pendingEmail || email)}" placeholder="player@example.com" required></div><button type="submit">${emailVerified ? L("updateEmail") : L("sendCode")}</button></form><p class="muted">${L("emailHelp")}</p></div>`;
  const cloudFull = user.cloudSaves?.full;
  const stats = user.onlineStats || { matches: 0, wins: 0, losses: 0 };
  const accountPanel = `<div class="panel"><h2>Аккаунт</h2><div class="card"><h3>Облачное сохранение</h3><p class="muted">Full: <b class="gold">${cloudFull?.updatedAt ? new Date(cloudFull.updatedAt).toLocaleString("ru-RU") : "ещё нет"}</b></p><p class="muted">Сторона: ${escapeHtml(cloudFull?.summary?.side || "-")} · День: ${escapeHtml(String(cloudFull?.summary?.day || "-"))}</p></div><div class="card" style="margin-top:10px"><h3>Онлайн 1 на 1</h3><p class="muted">Матчи: <b class="gold">${Number(stats.matches || 0)}</b> · Победы: ${Number(stats.wins || 0)} · Поражения: ${Number(stats.losses || 0)}</p></div></div>`;
  return pageShell(L("library"), `<main class="wrap hero"><h1>${L("library")}</h1><section class="grid2"><article class="game-card"><div class="cover"></div><div><div class="eyebrow">${L("fullVersion")}</div><h2>OSM Simulator</h2><p class="muted">${L("fullBrowser")}</p><p class="muted">${L("licenseTime")}: <b class="gold">${hasActive ? formatLicenseTime(activeLicense) : L("noLicense")}</b></p><div class="actions">${hasActive ? `<a class="button primary" href="/license-check?next=/play/">${L("playFull")}</a>` : `<button disabled>${L("noLicense")}</button>`}</div></div></article><article class="game-card"><div class="cover"></div><div><div class="eyebrow">${L("demo")}</div><h2>OSM Simulator Demo</h2><p class="muted">${L("demoBody")}</p><div class="actions"><a class="button primary" href="/demo/">${L("playDemo")}</a></div></div></article></section><section class="grid2" style="margin-top:16px">${licensePanel}${profilePanel}</section><section class="grid2" style="margin-top:16px">${accountPanel}<div class="panel"><h2>${L("myLicenses")}</h2>${list || `<p class="muted">${L("noLinkedKeys")}</p>`}</div></section></main>`, req, user, db);
}

function settingsPage(user, db, message = "", req = null) {
  const lang = getLang(req || {});
  const L = (key) => ui(lang, key);
  return pageShell(L("settings"), `<main class="wrap hero"><section class="panel" style="max-width:720px;margin:auto"><h1 style="margin-top:0">${L("accountSettings")}</h1>${message ? `<div class="notice ok">${escapeHtml(message)}</div>` : ""}<form class="form" method="post" action="/settings"><div><label>${L("nickname")}</label><input name="nickname" value="${escapeHtml(user.settings?.nickname || user.login)}"></div><button class="primary" type="submit">${L("save")}</button></form><hr style="border-color:rgba(116,216,255,.18);margin:22px 0"><form class="form" method="post" action="/settings/password"><div><label>${L("newPassword")}</label><input name="password" type="password" minlength="4"></div><button type="submit">${L("changePassword")}</button></form></section></main>`, req, user, db);
}

function adminLogin(message = "") {
  return pageShell("Админка", `<main class="wrap hero"><section class="panel" style="max-width:620px;margin:auto"><h1 style="margin-top:0">Админ-панель</h1>${message ? `<div class="notice bad">${escapeHtml(message)}</div>` : ""}<form class="form" method="post" action="/admin/login"><div><label>Админ токен</label><input name="token" type="password" required></div><button class="primary" type="submit">Войти</button></form></section></main>`);
}

function isAdmin(req) {
  return parseCookies(req).osm_admin === ADMIN_TOKEN;
}

function adminPage(db, notice = "") {
  const pending = db.pendingUpdates || [];
  const releases = db.releases || [];
  const licenseRows = db.licenses.slice().reverse().map((l) => `<tr><td><code>${escapeHtml(l.key)}</code></td><td>${escapeHtml(l.owner || "-")}</td><td class="${l.active ? "ok" : "bad"}">${l.active ? "active" : "blocked"}</td><td>${l.uses || 0}/${l.maxUses || 1}</td><td><form method="post" action="/admin/toggle"><input type="hidden" name="key" value="${escapeHtml(l.key)}"><button class="${l.active ? "danger" : ""}" type="submit">${l.active ? "Block" : "Enable"}</button></form></td></tr>`).join("");
  const userRows = db.users.slice().reverse().map((u) => `<tr><td>${escapeHtml(u.login)}</td><td>${escapeHtml(u.settings?.email || "-")}</td><td>${(u.licenseKeys || []).length}</td><td>${escapeHtml(u.role || "player")}</td></tr>`).join("");
  const pendingRows = pending.slice().reverse().map((u) => `<div class="release-item"><div><b>${escapeHtml(u.target)}</b><p class="muted">${escapeHtml(u.scope)} - ${escapeHtml(u.name)} - ${Math.round((u.size || 0) / 1024)} KB</p></div><code>draft</code></div>`).join("");
  const releaseRows = releases.slice().reverse().slice(0, 8).map((r) => `<div class="release-item"><div><b>${escapeHtml(r.version || r.id)}</b><p class="muted">${new Date(r.createdAt).toLocaleString("ru-RU")} - ${r.files || 0} files</p></div><code>live</code></div>`).join("");
  return pageShell("OSM Admin", `<main class="wrap admin-layout"><div class="top"><div><div class="eyebrow">Developer workspace</div><h1>OSM release control</h1></div><div class="actions"><a class="button" href="/">Site</a><a class="button danger" href="/admin/logout">Logout</a></div></div>${notice ? `<div class="notice ok toast">${escapeHtml(notice)}</div>` : ""}<section class="admin-kpi"><div class="card"><b>${pending.length}</b><p class="muted">draft files</p></div><div class="card"><b>${db.users.length}</b><p class="muted">accounts</p></div><div class="card"><b>${db.licenses.length}</b><p class="muted">licenses</p></div></section><section class="grid2"><div class="panel"><h2>Upload complete game folder</h2><p class="muted">Choose the exported game folder. The site finds index.html and keeps all asset paths automatically.</p><form class="form" method="post" action="/admin/upload-folder" enctype="multipart/form-data" data-folder-upload><div><label>Version</label><input name="version" placeholder="Patch v1.40"></div><div><label>Build target</label><select name="scope"><option value="full">Full version</option><option value="demo">Demo version</option></select></div><div><label>Game folder</label><input name="files" type="file" webkitdirectory directory multiple required></div><button class="primary" type="submit">Upload folder and publish</button></form><p class="muted">No manual paths. Pick the folder that contains index.html.</p></div><div class="panel"><h2>Advanced single-file draft</h2><p class="muted">Files stay in draft and will not replace the live game until release.</p><form class="form" method="post" action="/admin/upload" enctype="multipart/form-data"><div><label>Version</label><input name="version" placeholder="Patch v1.38"></div><div><label>Build target</label><select name="scope"><option value="full">Full version</option><option value="demo">Demo version</option></select></div><div><label>File inside game</label><input name="target" placeholder="index.html or assets/app.js"></div><div><label>File</label><input name="file" type="file" required></div><button type="submit">Upload to draft</button></form></div><div class="panel"><h2>Publish update</h2><p class="muted">After publishing, players get the new game files.</p><form class="form" method="post" action="/admin/publish"><div><label>Release note</label><input name="note" placeholder="Small fixes and new build"></div><button class="primary" type="submit" ${pending.length ? "" : "disabled"}>Publish ${pending.length} draft files</button></form><hr style="border-color:rgba(116,216,255,.18);margin:18px 0"><div class="release-list">${pendingRows || `<p class="muted">No draft files waiting.</p>`}</div></div></section><section class="grid2"><div class="panel"><h2>Create license</h2><form class="form" method="post" action="/admin/create"><div><label>Owner note</label><input name="owner" placeholder="@username"></div><div><label>Devices</label><input name="maxUses" type="number" min="1" max="20" value="1"></div><button class="primary" type="submit">Create key</button></form></div><div class="panel"><h2>Recent releases</h2><div class="release-list">${releaseRows || `<p class="muted">No releases yet.</p>`}</div></div></section><section class="panel"><h2>Licenses</h2><table><thead><tr><th>Key</th><th>Owner</th><th>Status</th><th>Uses</th><th></th></tr></thead><tbody>${licenseRows || `<tr><td colspan="5">Empty.</td></tr>`}</tbody></table></section><section class="panel"><h2>Accounts</h2><table><thead><tr><th>Login</th><th>Email</th><th>Keys</th><th>Role</th></tr></thead><tbody>${userRows || `<tr><td colspan="4">No accounts yet.</td></tr>`}</tbody></table></section><script>document.addEventListener("submit",async function(event){const form=event.target;if(!form.matches("[data-folder-upload]"))return;const input=form.querySelector("input[type=file]");if(!input||!input.files.length||!input.files[0].webkitRelativePath)return;event.preventDefault();const data=new FormData();data.append("version",form.elements.version.value||"");data.append("scope",form.elements.scope.value||"full");for(const file of input.files)data.append("files",file,file.webkitRelativePath||file.name);const res=await fetch(form.action,{method:"POST",body:data});document.open();document.write(await res.text());document.close();});</script></main>`, null, null, db);
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:(?:"([^"]+)")|([^;]+))/i.exec(contentType || "");
  if (!match) return { fields: {}, files: {}, fileList: [] };
  const boundary = "--" + (match[1] || match[2]);
  const raw = buffer.toString("latin1");
  const parts = raw.split(boundary).slice(1, -1);
  const fields = {};
  const files = {};
  const fileList = [];
  for (const part of parts) {
    const clean = part.replace(/^\r\n/, "");
    const idx = clean.indexOf("\r\n\r\n");
    if (idx < 0) continue;
    const header = clean.slice(0, idx);
    let content = clean.slice(idx + 4);
    if (content.endsWith("\r\n")) content = content.slice(0, -2);
    const name = /name="([^"]+)"/.exec(header)?.[1];
    const filename = /filename="([^"]*)"/.exec(header)?.[1];
    if (!name) continue;
    if (filename !== undefined && filename !== "") {
      const file = { field: name, filename, basename: path.basename(filename), data: Buffer.from(content, "latin1") };
      if (!files[name]) files[name] = file;
      fileList.push(file);
    } else fields[name] = Buffer.from(content, "latin1").toString("utf8").trim();
  }
  return { fields, files, fileList };
}

function safeGameTarget(input, fallbackName) {
  const raw = String(input || fallbackName || "file.bin").replaceAll("\\", "/").replace(/^\/+/, "");
  const normalized = path.posix.normalize(raw);
  if (normalized.startsWith("../") || normalized === "..") return path.basename(fallbackName || "file.bin");
  return normalized;
}

function cleanUploadPath(rawName) {
  return String(rawName || "")
    .replaceAll("\\", "/")
    .replace(/^[a-z]:/i, "")
    .replace(/^\/+/, "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== "." && part !== "..")
    .join("/");
}

function shouldSkipUploadPath(rel) {
  const lowered = String(rel || "").toLowerCase();
  return (
    !lowered ||
    lowered === ".ds_store" ||
    lowered.endsWith("/.ds_store") ||
    lowered === "thumbs.db" ||
    lowered.endsWith("/thumbs.db") ||
    lowered === "desktop.ini" ||
    lowered.endsWith("/desktop.ini") ||
    lowered.startsWith(".git/") ||
    lowered.includes("/.git/") ||
    lowered.startsWith("__macosx/") ||
    lowered.includes("/__macosx/")
  );
}

function stripCommonUploadRoot(uploadPaths) {
  const cleaned = uploadPaths.map(cleanUploadPath);
  const safe = cleaned.filter((rel) => !shouldSkipUploadPath(rel));
  if (!safe.length) return cleaned.map(() => "");
  const commonRoot = safe[0].split("/").length > 1 ? safe[0].split("/")[0] : "";
  const canStrip =
    commonRoot &&
    safe.every((rel) => rel.split("/")[0] === commonRoot) &&
    safe.some((rel) => rel.toLowerCase() === `${commonRoot.toLowerCase()}/index.html`);
  return cleaned.map((rel) => {
    if (shouldSkipUploadPath(rel)) return "";
    return canStrip ? rel.split("/").slice(1).join("/") : rel;
  });
}

function clearLiveGameRoot(scope) {
  const root = scopeLiveRoot(scope);
  fs.mkdirSync(root, { recursive: true });
  for (const entry of fs.readdirSync(root)) {
    fs.rmSync(path.join(root, entry), { recursive: true, force: true });
  }
}

function writeLiveGameFile(scope, target, data) {
  const root = scopeLiveRoot(scope);
  const safeTarget = cleanUploadPath(target);
  if (!safeTarget || shouldSkipUploadPath(safeTarget)) return false;
  const dest = path.resolve(root, safeTarget);
  if (!dest.startsWith(path.resolve(root) + path.sep) && dest !== path.resolve(root)) {
    throw new Error("Unsafe game upload path");
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, data);
  return true;
}

function scopeLiveRoot(scope) {
  return scope === "demo" ? PORTAL_DEMO_DIR : PORTAL_GAME_DIR;
}

function scopePendingRoot(scope) {
  return path.join(PENDING_UPDATE_DIR, scope === "demo" ? "demo" : "full");
}

function pendingUpdatePath(scope, target) {
  return path.join(scopePendingRoot(scope), target);
}

function publishPendingUpdates(db, note = "") {
  const pending = db.pendingUpdates || [];
  if (!pending.length) return null;
  const releaseId = `rel-${Date.now()}`;
  for (const item of pending) {
    const src = pendingUpdatePath(item.scope, item.target);
    const dest = path.join(scopeLiveRoot(item.scope), item.target);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
  db.releases ||= [];
  db.uploads ||= [];
  db.releases.push({ id: releaseId, version: pending[pending.length - 1]?.version || releaseId, note, files: pending.length, createdAt: new Date().toISOString() });
  db.uploads.push(...pending.map((item) => ({ ...item, releasedAt: new Date().toISOString(), releaseId })));
  db.pendingUpdates = [];
  return releaseId;
}

function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").split(",")[0].trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}


function makeEmailCode() {
  return String(crypto.randomInt(100000, 1000000));
}

function hashEmailCode(code) {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

function smtpRead(socket) {
  return new Promise((resolve, reject) => {
    let data = "";
    const onData = (chunk) => {
      data += chunk.toString("utf8");
      if (/\r\n\d{3} /.test("\r\n" + data)) {
        socket.off("data", onData);
        socket.off("error", reject);
        resolve(data);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
  });
}

async function smtpExpect(socket, allowed) {
  const text = await smtpRead(socket);
  const code = Number(text.slice(0, 3));
  if (!allowed.includes(code)) throw new Error(`SMTP error ${text.trim()}`);
  return text;
}

function smtpWrite(socket, line) {
  socket.write(`${line}\r\n`);
}

async function sendMailSmtp(to, subject, text) {
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) throw new Error("SMTP is not configured");
  const socket = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST });
  await new Promise((resolve, reject) => { socket.once("secureConnect", resolve); socket.once("error", reject); });
  await smtpExpect(socket, [220]);
  smtpWrite(socket, `EHLO ${SMTP_HOST}`);
  await smtpExpect(socket, [250]);
  smtpWrite(socket, "AUTH LOGIN");
  await smtpExpect(socket, [334]);
  smtpWrite(socket, Buffer.from(SMTP_USER).toString("base64"));
  await smtpExpect(socket, [334]);
  smtpWrite(socket, Buffer.from(SMTP_PASS).toString("base64"));
  await smtpExpect(socket, [235]);
  smtpWrite(socket, `MAIL FROM:<${SMTP_FROM}>`);
  await smtpExpect(socket, [250]);
  smtpWrite(socket, `RCPT TO:<${to}>`);
  await smtpExpect(socket, [250, 251]);
  smtpWrite(socket, "DATA");
  await smtpExpect(socket, [354]);
  const safeSubject = String(subject).replace(/[\r\n]/g, " ");
  const body = [
    `From: ${SMTP_FROM}`,
    `To: ${to}`,
    `Subject: ${safeSubject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    String(text).replace(/^\./gm, ".."),
  ].join("\r\n");
  socket.write(`${body}\r\n.\r\n`);
  await smtpExpect(socket, [250]);
  smtpWrite(socket, "QUIT");
  socket.end();
}

function writeOutboxEmail(to, subject, text) {
  if (!fs.existsSync(EMAIL_OUTBOX_DIR)) fs.mkdirSync(EMAIL_OUTBOX_DIR, { recursive: true });
  const name = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(3).toString("hex")}.txt`;
  fs.writeFileSync(path.join(EMAIL_OUTBOX_DIR, name), [`To: ${to}`, `Subject: ${subject}`, "", text].join("\n"), "utf8");
  return name;
}

async function deliverEmailCode(to, code) {
  const subject = "OSM Simulator email verification";
  const text = `Your OSM Simulator verification code: ${code}\n\nThe code expires in 15 minutes.`;
  if (SMTP_HOST && SMTP_USER && SMTP_PASS && SMTP_FROM) {
    try {
      await sendMailSmtp(to, subject, text);
      return { sent: true, local: false };
    } catch (error) {
      const file = writeOutboxEmail(to, subject, `${text}\n\nSMTP delivery failed: ${error.message}`);
      return { sent: true, local: true, file, error: error.message };
    }
  }
  return { sent: true, local: true, file: writeOutboxEmail(to, subject, text) };
}

async function startEmailVerification(db, user, email) {
  const code = makeEmailCode();
  db.emailCodes = (db.emailCodes || []).filter((item) => item.userId !== user.id);
  db.emailCodes.push({ userId: user.id, email, codeHash: hashEmailCode(code), expiresAt: Date.now() + 15 * 60 * 1000, createdAt: new Date().toISOString() });
  user.pendingEmail = email;
  return deliverEmailCode(email, code);
}

function completeEmailVerification(db, user, code) {
  const now = Date.now();
  const found = (db.emailCodes || []).find((item) => item.userId === user.id && item.expiresAt > now && item.codeHash === hashEmailCode(code));
  if (!found) return false;
  user.settings ||= { nickname: user.login, email: "" };
  user.settings.email = found.email;
  user.pendingEmail = "";
  user.emailVerifiedAt = new Date().toISOString();
  db.emailCodes = (db.emailCodes || []).filter((item) => item.userId !== user.id);
  return true;
}
function claimLicense(req, res, user, key) {
  const db = readDb();
  const freshUser = db.users.find((u) => u.id === user.id);
  const license = findLicense(db, key);
  if (!license || !license.active) return send(res, 403, libraryPage(freshUser, db, "Ключ не найден или заблокирован.", req));
  freshUser.licenseKeys ||= [];
  if (!freshUser.licenseKeys.includes(license.key)) freshUser.licenseKeys.push(license.key);
  license.owner ||= freshUser.login;
  const fingerprint = crypto.createHash("sha256").update(`${clientIp(req)}|${req.headers["user-agent"] || ""}`).digest("hex").slice(0, 16);
  const known = db.activations.filter((a) => a.key === license.key);
  const already = known.some((a) => a.fingerprint === fingerprint || a.userId === freshUser.id);
  if (!already && known.length >= Number(license.maxUses || 1)) return send(res, 403, libraryPage(freshUser, db, "Лимит устройств для этого ключа уже исчерпан.", req));
  if (!already) db.activations.push({ key: license.key, userId: freshUser.id, fingerprint, ip: clientIp(req), createdAt: new Date().toISOString() });
  license.uses = db.activations.filter((a) => a.key === license.key).length;
  writeDb(db);
  send(res, 200, libraryPage(freshUser, db, "Лицензия сохранена на аккаунт.", req));
}

function userHasGame(user, db) {
  if (!user) return false;
  return (user.licenseKeys || []).some((key) => db.licenses.some((l) => l.key === key && isLicenseActive(l)));
}


function activeLicenseForUser(user, db) {
  if (!user) return null;
  return (user.licenseKeys || []).map((key) => findLicense(db, key)).find((license) => isLicenseActive(license)) || null;
}

function licenseCheckBucket() {
  return Math.floor(Date.now() / (5 * 60 * 1000));
}

function licenseCheckSig(userId, key, bucket) {
  return crypto.createHash("sha256").update(`${userId}|${key}|${bucket}|${ADMIN_TOKEN}`).digest("hex");
}

function makeLicenseCheckCookie(user, license) {
  const bucket = licenseCheckBucket();
  return `${user.id}:${license.key}:${bucket}:${licenseCheckSig(user.id, license.key, bucket)}`;
}

function hasFreshLicenseCheck(req, user, license) {
  const raw = parseCookies(req).osm_license_check || "";
  const [userId, key, bucketText, sig] = raw.split(":");
  const bucket = Number(bucketText);
  if (!user || !license || userId !== user.id || key !== license.key || !Number.isFinite(bucket)) return false;
  if (Math.abs(licenseCheckBucket() - bucket) > 1) return false;
  return sig === licenseCheckSig(user.id, license.key, bucket);
}

function handleLicenseCheck(req, res, url) {
  const db = readDb();
  const user = getUser(req, db);
  if (!user) return redirect(res, "/login");
  const license = activeLicenseForUser(user, db);
  if (!license) return redirect(res, "/library");
  const next = url.searchParams.get("next") || "/play/";
  const safeNext = next.startsWith("/play") ? next : "/play/";
  const token = makeLicenseCheckCookie(user, license);
  res.writeHead(302, { Location: safeNext, "Set-Cookie": `osm_license_check=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=300` });
  return res.end();
}
function getGameRoot() {
  return fs.existsSync(path.join(PORTAL_GAME_DIR, "index.html")) ? PORTAL_GAME_DIR : GAME_DIR;
}

function getDemoRoot() {
  if (fs.existsSync(path.join(PORTAL_DEMO_DIR, "index.html"))) return PORTAL_DEMO_DIR;
  if (fs.existsSync(path.join(DEFAULT_DEMO_DIR, "index.html"))) return DEFAULT_DEMO_DIR;
  return null;
}

function serveStaticRoot(root, req, res, url, prefix) {
  if (!root) return send(res, 404, pageShell("Demo not loaded", `<main class="wrap hero"><section class="panel"><h1>Demo not loaded</h1><p class="muted">Upload demo files through admin panel.</p><a class="button" href="/">Home</a></section></main>`, req));
  let rel = decodeURIComponent(url.pathname.replace(new RegExp(`^/${prefix}/?`), ""));
  if (!rel) rel = "index.html";
  rel = rel.replaceAll("\\", "/");
  const filePath = path.resolve(root, rel);
  if (!filePath.startsWith(root)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return send(res, 404, "Not found", "text/plain; charset=utf-8");
  res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "private, max-age=60" });
  fs.createReadStream(filePath).pipe(res);
}

function serveDemo(req, res, url) {
  return serveStaticRoot(getDemoRoot(), req, res, url, "demo");
}

function makeFullLicenseForUser(db, user) {
  let key = makeLicense();
  while (db.licenses.some((l) => l.key === key)) key = makeLicense();
  db.licenses.push({ key, owner: user.login, active: true, maxUses: 1, uses: 0, createdAt: new Date().toISOString(), source: "admin-grant" });
  user.licenseKeys ||= [];
  user.licenseKeys.push(key);
  return key;
}

function serveGame(req, res, url) {
  const db = readDb();
  const user = getUser(req, db);
  const license = activeLicenseForUser(user, db);
  if (!license) return redirect(res, "/library");
  if (!hasFreshLicenseCheck(req, user, license)) return redirect(res, `/license-check?next=${encodeURIComponent(url.pathname + url.search)}`);
  return serveStaticRoot(getGameRoot(), req, res, url, "play");
}

function serveAsset(req, res, url) {
  const rel = path.basename(decodeURIComponent(url.pathname.replace(/^\/assets\//, "")));
  const filePath = path.join(ASSETS_DIR, rel);
  if (!fs.existsSync(filePath)) return send(res, 404, "Not found", "text/plain; charset=utf-8");
  res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream", "Cache-Control": "public, max-age=3600" });
  fs.createReadStream(filePath).pipe(res);
}

function publicUserProfile(user, db) {
  if (!user) return null;
  const activeLicense = activeLicenseForUser(user, db);
  return {
    id: user.id,
    login: user.login,
    role: user.role || "player",
    nickname: user.settings?.nickname || user.login,
    email: user.settings?.email || "",
    emailVerified: Boolean(user.emailVerifiedAt),
    hasFull: Boolean(activeLicense),
    licenseTime: activeLicense ? formatLicenseTime(activeLicense) : "",
    onlineStats: user.onlineStats || { matches: 0, wins: 0, losses: 0 },
    cloudSaves: Object.fromEntries(Object.entries(user.cloudSaves || {}).map(([scope, save]) => [scope, {
      updatedAt: save?.updatedAt || "",
      day: save?.summary?.day || 1,
      side: save?.summary?.side || "ukraine",
    }])),
  };
}

function getSaveScope(url) {
  return url.searchParams.get("scope") === "demo" ? "demo" : "full";
}

function makeSaveSummary(snapshot) {
  return {
    day: Number(snapshot?.botDay || 1),
    side: String(snapshot?.playerSide || "ukraine"),
    score: `${Number(snapshot?.rfScore || 0)}:${Number(snapshot?.uaScore || 0)}`,
    simMs: Number(snapshot?.simMs || 0),
  };
}

function onlineId(size = 8) {
  return crypto.randomBytes(size).toString("hex");
}

function makeOnlineRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) code += alphabet[crypto.randomInt(alphabet.length)];
  return onlineRooms.has(code) ? makeOnlineRoomCode() : code;
}

function wsSend(ws, payload) {
  if (!ws || ws.closed) return;
  const data = Buffer.from(JSON.stringify(payload));
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x81, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  ws.write(Buffer.concat([header, data]));
}

function wsClose(ws, code = 1000, reason = "") {
  if (!ws || ws.closed) return;
  ws.closed = true;
  const reasonBuffer = Buffer.from(String(reason).slice(0, 120));
  const payload = Buffer.alloc(2 + reasonBuffer.length);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  try {
    ws.write(Buffer.concat([Buffer.from([0x88, payload.length]), payload]));
    ws.end();
  } catch (_) {
    try { ws.destroy(); } catch (_) {}
  }
}

function normalizeOnlineSettings(settings = {}) {
  const rawDifficulty = settings.difficulty === "medium" ? "normal" : settings.difficulty;
  const difficulty = ["easy", "normal", "hard"].includes(rawDifficulty) ? rawDifficulty : "hard";
  const duration = Number(settings.gameDurationMin || settings.duration || 30);
  const hostSide = "ukraine";
  return {
    difficulty,
    gameDurationMin: [30, 60, 120].includes(duration) ? duration : 30,
    hostSide,
    startSpeed: 25,
    startMoney: Math.max(500, Math.min(10000, Math.floor(Number(settings.startMoney || (difficulty === "easy" ? 5000 : difficulty === "normal" ? 3500 : 1500))))),
    lobbyName: String(settings.lobbyName || "OSM Lobby").replace(/[<>]/g, "").trim().slice(0, 32) || "OSM Lobby",
    public: settings.public !== false,
  };
}

function onlineRoomSnapshot(room) {
  return {
    code: room.code,
    roomId: room.code,
    roomCode: room.code,
    hostId: room.hostId,
    playerCount: room.clients.size,
    playersCount: room.clients.size,
    count: room.clients.size,
    started: room.started,
    settings: normalizeOnlineSettings(room.settings),
    lobbyName: room.lobbyName || normalizeOnlineSettings(room.settings).lobbyName,
    public: room.public !== false,
    hasPassword: Boolean(room.password),
    players: [...room.clients.values()].map((client) => ({
      id: client.id,
      name: client.name,
      side: client.side,
      host: client.id === room.hostId,
      account: client.login || "",
      ready: Boolean(client.ready),
    })),
  };
}

function onlineBroadcast(room, payload, exceptClientId = null) {
  for (const client of room.clients.values()) {
    if (client.id === exceptClientId) continue;
    wsSend(client.ws, payload);
  }
}

function onlineClientDisplayName(client, requestedName = "") {
  const accountName = client?.login ? (client.name || client.login) : "";
  return String(accountName || requestedName || client?.name || "Itch Player").replace(/[<>]/g, "").trim().slice(0, 24) || "Itch Player";
}

function onlineSyncRoom(room) {
  onlineBroadcast(room, { type: "room", room: onlineRoomSnapshot(room) });
}

function onlineAssignSides(room) {
  const clients = [...room.clients.values()];
  const hostSide = normalizeOnlineSettings(room.settings).hostSide;
  const peerSide = hostSide === "rf" ? "ukraine" : "rf";
  clients.forEach((client, index) => {
    client.side = client.id === room.hostId ? hostSide : (index === 0 && !room.hostId ? hostSide : peerSide);
  });
}

function onlineLeaveRoom(client) {
  if (!client.roomCode) return;
  const room = onlineRooms.get(client.roomCode);
  client.roomCode = null;
  if (!room) return;
  room.clients.delete(client.id);
  if (room.clients.size <= 0) {
    onlineRooms.delete(room.code);
    return;
  }
  if (!room.clients.has(room.hostId)) room.hostId = room.clients.keys().next().value;
  onlineAssignSides(room);
  onlineSyncRoom(room);
}

function onlineJoinRoom(client, room, name) {
  if (room.clients.size >= 2 && !room.clients.has(client.id)) {
    wsSend(client.ws, { type: "error", message: "Комната уже заполнена" });
    return;
  }
  onlineLeaveRoom(client);
  if (room.password && String(room.password) !== String(arguments[3] || "")) { wsSend(client.ws, { type: "error", message: "\u041d\u0435\u0432\u0435\u0440\u043d\u044b\u0439 \u043f\u0430\u0440\u043e\u043b\u044c \u043b\u043e\u0431\u0431\u0438" }); return; }
  client.name = onlineClientDisplayName(client, name);
  client.ready = false;
  client.roomCode = room.code;
  room.clients.set(client.id, client);
  room.updatedAt = Date.now();
  if (!room.hostId) room.hostId = client.id;
  onlineAssignSides(room);
  const snapshot = onlineRoomSnapshot(room);
  wsSend(client.ws, { type: "joined", clientId: client.id, room: snapshot, ...snapshot });
  wsSend(client.ws, { type: room.clients.size === 1 ? "room-created" : "room-joined", clientId: client.id, room: snapshot, ...snapshot });
  onlineSyncRoom(room);
}

function recordOnlineMatchStart(room) {
  const db = readDb();
  let changed = false;
  for (const client of room.clients.values()) {
    if (!client.userId) continue;
    const user = db.users.find((entry) => entry.id === client.userId);
    if (!user) continue;
    user.onlineStats ||= { matches: 0, wins: 0, losses: 0 };
    user.onlineStats.matches = Number(user.onlineStats.matches || 0) + 1;
    user.lastOnlineMatchAt = new Date().toISOString();
    changed = true;
  }
  if (changed) writeDb(db);
}

function handleOnlineMessage(client, message) {
  if (!message || typeof message !== "object") return;
  const type = String(message.type || "").toLowerCase();
  if (type === "ping") return wsSend(client.ws, { type: "pong", at: Date.now() });
  if (["create", "create-room", "createroom", "create_room", "room:create", "host"].includes(type)) {
    const code = makeOnlineRoomCode();
    const normalizedSettings = normalizeOnlineSettings({ ...(message.settings || {}), lobbyName: message.lobbyName, public: message.public !== false });
    const room = { code, hostId: client.id, clients: new Map(), started: false, settings: normalizedSettings, lobbyName: normalizedSettings.lobbyName, public: normalizedSettings.public, password: String(message.password || "").slice(0, 32), createdAt: Date.now(), updatedAt: Date.now() };
    onlineRooms.set(code, room);
    return onlineJoinRoom(client, room, message.name, message.password);
  }
  if (["list", "list-rooms", "rooms", "room:list"].includes(type)) {
    const rooms = [...onlineRooms.values()].filter((room) => room.public !== false).map((room) => onlineRoomSnapshot(room));
    return wsSend(client.ws, { type: "rooms", rooms });
  }
  if (["leave", "leave-room", "leaveroom", "leave_room", "room:leave"].includes(type)) {
    onlineLeaveRoom(client);
    return wsSend(client.ws, { type: "left", room: null });
  }
  if (["join", "join-room", "joinroom", "join_room", "room:join"].includes(type)) {
    const roomCode = String(message.room || message.roomId || message.roomCode || message.code || "").trim().toUpperCase();
    const room = onlineRooms.get(roomCode);
    if (!room) return wsSend(client.ws, { type: "error", message: "Комната не найдена" });
    return onlineJoinRoom(client, room, message.name, message.password);
  }
  const explicitRoomCode = String(message.room || message.roomId || message.roomCode || message.code || client.roomCode || "").trim().toUpperCase();
  const room = onlineRooms.get(explicitRoomCode) || onlineRooms.get(client.roomCode);
  if (!room) {
    client.roomCode = null;
    return wsSend(client.ws, { type: "error", message: "Комната не найдена. Создай новую комнату." });
  }
  if (!room.clients.has(client.id)) {
    if (room.clients.size >= 2) return wsSend(client.ws, { type: "error", message: "Комната уже заполнена" });
    client.roomCode = room.code;
    room.clients.set(client.id, client);
    onlineAssignSides(room);
    onlineSyncRoom(room);
  }
  room.updatedAt = Date.now();
  if (["ready", "player-ready"].includes(type)) {
    client.ready = Boolean(message.ready);
    room.updatedAt = Date.now();
    onlineSyncRoom(room);
    return;
  }
  if (["room-settings", "settings", "update-settings"].includes(type)) {
    if (room.hostId !== client.id) return wsSend(client.ws, { type: "error", message: "\u041d\u0430\u0441\u0442\u0440\u043e\u0439\u043a\u0438 \u043c\u0435\u043d\u044f\u0435\u0442 \u0442\u043e\u043b\u044c\u043a\u043e \u0445\u043e\u0441\u0442" });
    if (room.started) return wsSend(client.ws, { type: "error", message: "\u041c\u0430\u0442\u0447 \u0443\u0436\u0435 \u0437\u0430\u043f\u0443\u0449\u0435\u043d" });
    room.settings = normalizeOnlineSettings(message.settings || {});
    onlineAssignSides(room);
    onlineSyncRoom(room);
    return;
  }
  if (["chat", "chat-message", "message", "online-chat"].includes(type)) {
    const text = String(message.text || message.message || "").trim().slice(0, 220);
    if (!text) return;
    return onlineBroadcast(room, {
      type: "chat",
      room: room.code,
      roomCode: room.code,
      id: message.id || message.messageId || `chat-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      from: client.id,
      name: onlineClientDisplayName(client, message.name),
      side: client.side || null,
      text,
      at: Date.now(),
    });
  }
  if (["start", "start-match", "match-start"].includes(type)) {
    if (room.hostId !== client.id) return wsSend(client.ws, { type: "error", message: "Стартовать матч может только хост" });
    if (room.clients.size < 2) return wsSend(client.ws, { type: "error", message: "\u041d\u0443\u0436\u0435\u043d \u0432\u0442\u043e\u0440\u043e\u0439 \u0438\u0433\u0440\u043e\u043a" });
    if (![...room.clients.values()].every((entry) => Boolean(entry.ready))) return wsSend(client.ws, { type: "error", message: "\u041e\u0431\u0430 \u0438\u0433\u0440\u043e\u043a\u0430 \u0434\u043e\u043b\u0436\u043d\u044b \u0431\u044b\u0442\u044c \u0433\u043e\u0442\u043e\u0432\u044b" });
    if (room.started) return wsSend(client.ws, { type: "room", room: onlineRoomSnapshot(room) });
    room.settings = normalizeOnlineSettings({ ...(room.settings || {}), ...(message.settings || {}) });
    onlineAssignSides(room);
    room.started = true;
    recordOnlineMatchStart(room);
    return onlineBroadcast(room, { type: "match-start", room: onlineRoomSnapshot(room), settings: normalizeOnlineSettings(room.settings) });
  }
  if (type === "action") {
    return onlineBroadcast(room, {
      type: "action",
      room: room.code,
      roomCode: room.code,
      from: client.id,
      side: client.side,
      action: message.action || "unknown",
      payload: message.payload || {},
      seq: Number(message.seq || 0),
      at: Date.now(),
    }, client.id);
  }
}

function parseOnlineFrame(ws, chunk) {
  ws.buffer = ws.buffer ? Buffer.concat([ws.buffer, chunk]) : chunk;
  while (ws.buffer.length >= 2) {
    const opcode = ws.buffer[0] & 0x0f;
    const masked = (ws.buffer[1] & 0x80) !== 0;
    let length = ws.buffer[1] & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (ws.buffer.length < offset + 2) return;
      length = ws.buffer.readUInt16BE(offset);
      offset += 2;
    } else if (length === 127) {
      if (ws.buffer.length < offset + 8) return;
      const big = ws.buffer.readBigUInt64BE(offset);
      if (big > BigInt(ONLINE_MAX_MESSAGE_BYTES)) return wsClose(ws, 1009, "Message too large");
      length = Number(big);
      offset += 8;
    }
    const maskOffset = offset;
    if (masked) offset += 4;
    if (length > ONLINE_MAX_MESSAGE_BYTES) return wsClose(ws, 1009, "Message too large");
    if (ws.buffer.length < offset + length) return;
    const mask = masked ? ws.buffer.subarray(maskOffset, maskOffset + 4) : null;
    const payload = ws.buffer.subarray(offset, offset + length);
    ws.buffer = ws.buffer.subarray(offset + length);
    if (opcode === 0x8) return wsClose(ws);
    if (opcode === 0x9) {
      ws.write(Buffer.from([0x8a, 0x00]));
      continue;
    }
    if (opcode !== 0x1) continue;
    let data = payload;
    if (masked) {
      data = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i += 1) data[i] = payload[i] ^ mask[i % 4];
    }
    try {
      handleOnlineMessage(ws.client, JSON.parse(data.toString("utf8")));
    } catch (_) {
      wsSend(ws, { type: "error", message: "Некорректное сообщение" });
    }
  }
}

function handleOnlineUpgrade(req, socket) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== "/online") return socket.destroy();
  const key = req.headers["sec-websocket-key"];
  if (!key) return socket.destroy();
  const db = readDb();
  const user = getUser(req, db);
  const accept = crypto.createHash("sha1").update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    "",
  ].join("\r\n"));
  const client = {
    id: onlineId(6),
    userId: user?.id || null,
    login: user?.login || "",
    name: user?.settings?.nickname || user?.login || "Игрок",
    side: null,
    roomCode: null,
    ws: socket,
  };
  socket.client = client;
  socket.closed = false;
  wsSend(socket, { type: "welcome", clientId: client.id, account: client.login || "", name: client.name || client.login || "Itch Player" });
  socket.on("data", (chunk) => parseOnlineFrame(socket, chunk));
  socket.on("close", () => { socket.closed = true; onlineLeaveRoom(client); });
  socket.on("error", () => { socket.closed = true; onlineLeaveRoom(client); });
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/lang") {
    const lang = url.searchParams.get("set") === "uk" ? "uk" : "en";
    res.writeHead(302, { Location: req.headers.referer || "/", "Set-Cookie": `osm_lang=${lang}; SameSite=Lax; Path=/; Max-Age=31536000` });
    return res.end();
  }
  if (url.pathname.startsWith("/assets/")) return serveAsset(req, res, url);
  if (req.method === "GET" && url.pathname === "/license-check") return handleLicenseCheck(req, res, url);
  if (url.pathname.startsWith("/play")) return serveGame(req, res, url);
  if (url.pathname.startsWith("/demo")) return serveDemo(req, res, url);

  const db = readDb();
  const user = getUser(req, db);

  if (req.method === "GET" && url.pathname === "/online/health") {
    return sendJson(res, 200, { ok: true, rooms: onlineRooms.size, path: "/online" });
  }

  if (req.method === "GET" && url.pathname === "/api/profile") {
    return sendJson(res, user ? 200 : 401, { ok: Boolean(user), user: publicUserProfile(user, db) });
  }

  if (req.method === "GET" && url.pathname === "/api/cloud-save") {
    if (!user) return sendJson(res, 401, { ok: false, error: "login_required" });
    const scope = getSaveScope(url);
    return sendJson(res, 200, { ok: true, scope, save: user.cloudSaves?.[scope] || null });
  }

  if (req.method === "POST" && url.pathname === "/api/cloud-save") {
    if (!user) return sendJson(res, 401, { ok: false, error: "login_required" });
    const scope = getSaveScope(url);
    const body = await getPostBody(req, 1024 * 1024);
    let snapshot = null;
    try {
      snapshot = JSON.parse(body.toString("utf8")).snapshot;
    } catch (_) {
      return sendJson(res, 400, { ok: false, error: "bad_json" });
    }
    const fresh = readDb();
    const found = fresh.users.find((entry) => entry.id === user.id);
    if (!found) return sendJson(res, 401, { ok: false, error: "login_required" });
    found.cloudSaves ||= {};
    found.cloudSaves[scope] = {
      updatedAt: new Date().toISOString(),
      summary: makeSaveSummary(snapshot),
      snapshot,
    };
    writeDb(fresh);
    return sendJson(res, 200, { ok: true, scope, updatedAt: found.cloudSaves[scope].updatedAt });
  }

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, homePage(req, user, db));
  if (req.method === "GET" && url.pathname === "/register") return send(res, 200, authPage("register", "", req));
  if (req.method === "GET" && url.pathname === "/login") return send(res, 200, authPage("login", "", req));
  if (req.method === "GET" && url.pathname === "/logout") { res.writeHead(302, { Location: "/", "Set-Cookie": "osm_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" }); return res.end(); }

  if (req.method === "POST" && url.pathname === "/register") {
    const body = await getPostBody(req);
    const login = formValue(body, "login").toLowerCase();
    const password = formValue(body, "password");
    const fresh = readDb();
    if (!/^[a-z0-9_\-.]{3,24}$/i.test(login)) return send(res, 400, authPage("register", "Логин: 3-24 символа, латиница/цифры/_/-."));
    if (password.length < 4) return send(res, 400, authPage("register", "Пароль слишком короткий."));
    if (fresh.users.some((u) => u.login === login)) return send(res, 409, authPage("register", "Такой логин уже занят."));
    const newUser = { id: crypto.randomUUID(), login, passwordHash: hashPassword(password), role: "player", licenseKeys: [], settings: { nickname: login, email: "" }, createdAt: new Date().toISOString() };
    fresh.users.push(newUser);
    writeDb(fresh);
    createUserSession(res, newUser);
    return redirect(res, "/library");
  }

  if (req.method === "POST" && url.pathname === "/login") {
    const body = await getPostBody(req);
    const login = formValue(body, "login").toLowerCase();
    const password = formValue(body, "password");
    const fresh = readDb();
    const found = fresh.users.find((u) => u.login === login);
    if (!found || !verifyPassword(password, found.passwordHash)) return send(res, 403, authPage("login", "Неверный логин или пароль."));
    createUserSession(res, found);
    return redirect(res, "/library");
  }

  if (req.method === "GET" && url.pathname === "/library") {
    if (!user) return redirect(res, "/login");
    return send(res, 200, libraryPage(user, db, "", req));
  }

  if (req.method === "POST" && url.pathname === "/claim") {
    if (!user) return redirect(res, "/login");
    const body = await getPostBody(req);
    return claimLicense(req, res, user, formValue(body, "license"));
  }


  if (req.method === "POST" && url.pathname === "/account/email") {
    if (!user) return redirect(res, "/login");
    const body = await getPostBody(req);
    const email = formValue(body, "email").toLowerCase();
    if (!isValidEmail(email)) return send(res, 400, libraryPage(user, db, "Invalid email address.", req));
    const fresh = readDb();
    const found = fresh.users.find((u) => u.id === user.id);
    const result = await startEmailVerification(fresh, found, email);
    writeDb(fresh);
    const msg = result.local ? ui(getLang(req), "emailCodeLocal") : ui(getLang(req), "emailCodeSent");
    return send(res, 200, libraryPage(found, fresh, msg, req));
  }

  if (req.method === "POST" && url.pathname === "/account/email/verify") {
    if (!user) return redirect(res, "/login");
    const body = await getPostBody(req);
    const fresh = readDb();
    const found = fresh.users.find((u) => u.id === user.id);
    if (!completeEmailVerification(fresh, found, formValue(body, "code"))) {
      return send(res, 400, libraryPage(found, fresh, ui(getLang(req), "invalidCode"), req));
    }
    writeDb(fresh);
    return send(res, 200, libraryPage(found, fresh, ui(getLang(req), "emailVerified"), req));
  }
  if (req.method === "GET" && url.pathname === "/settings") {
    if (!user) return redirect(res, "/login");
    return send(res, 200, settingsPage(user, db, "", req));
  }

  if (req.method === "POST" && url.pathname === "/settings") {
    if (!user) return redirect(res, "/login");
    const body = await getPostBody(req);
    const fresh = readDb();
    const found = fresh.users.find((u) => u.id === user.id);
    found.settings = { nickname: found.settings?.nickname || found.login, email: found.settings?.email || "" };
    writeDb(fresh);
    return send(res, 200, settingsPage(found, fresh, ui(getLang(req), "settingsSaved"), req));
  }

  if (req.method === "POST" && url.pathname === "/settings/password") {
    if (!user) return redirect(res, "/login");
    const body = await getPostBody(req);
    const password = formValue(body, "password");
    if (password.length < 4) return send(res, 400, settingsPage(user, db, "Password is too short.", req));
    const fresh = readDb();
    const found = fresh.users.find((u) => u.id === user.id);
    found.passwordHash = hashPassword(password);
    writeDb(fresh);
    return send(res, 200, settingsPage(found, fresh, ui(getLang(req), "passwordChanged"), req));
  }

  if (req.method === "GET" && url.pathname === "/admin") {
    if (!canAdmin(req, user)) return send(res, 200, adminLogin());
    return send(res, 200, adminPage(db));
  }

  if (req.method === "POST" && url.pathname === "/admin/login") {
    const body = await getPostBody(req);
    if (formValue(body, "token") !== ADMIN_TOKEN) return send(res, 403, adminLogin("Неверный токен."));
    res.writeHead(302, { Location: "/", "Set-Cookie": `osm_admin=${encodeURIComponent(ADMIN_TOKEN)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800` });
    return res.end();
  }

  if (req.method === "GET" && url.pathname === "/admin/logout") {
    res.writeHead(302, { Location: "/", "Set-Cookie": "osm_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0" });
    return res.end();
  }

  if (url.pathname.startsWith("/admin/") && !canAdmin(req, user)) return redirect(res, "/admin");

  if (req.method === "POST" && url.pathname === "/admin/create") {
    const body = await getPostBody(req);
    const fresh = readDb();
    let key = makeLicense();
    while (fresh.licenses.some((l) => l.key === key)) key = makeLicense();
    fresh.licenses.push({ key, owner: formValue(body, "owner"), active: true, maxUses: Math.max(1, Math.min(20, Number(formValue(body, "maxUses") || 1))), uses: 0, createdAt: new Date().toISOString() });
    writeDb(fresh);
    return send(res, 200, adminPage(fresh, `Создан ключ: ${key}`));
  }

  if (req.method === "POST" && url.pathname === "/admin/toggle") {
    const body = await getPostBody(req);
    const fresh = readDb();
    const license = findLicense(fresh, formValue(body, "key"));
    if (license) { license.active = !license.active; writeDb(fresh); }
    return redirect(res, "/admin");
  }

  if (req.method === "POST" && url.pathname === "/admin/user-rights") {
    const body = await getPostBody(req);
    const fresh = readDb();
    const target = fresh.users.find((u) => u.id === formValue(body, "userId"));
    const role = formValue(body, "role");
    if (target && ["player", "moderator", "admin"].includes(role)) target.role = role;
    writeDb(fresh);
    return redirect(res, "/");
  }

  if (req.method === "POST" && url.pathname === "/admin/grant-full") {
    const body = await getPostBody(req);
    const fresh = readDb();
    const target = fresh.users.find((u) => u.id === formValue(body, "userId"));
    if (target) makeFullLicenseForUser(fresh, target);
    writeDb(fresh);
    return redirect(res, "/");
  }

  if (req.method === "POST" && url.pathname === "/admin/upload-folder") {
    const body = await getPostBody(req, 700 * 1024 * 1024);
    const parsed = parseMultipart(body, req.headers["content-type"]);
    const scope = parsed.fields.scope === "demo" ? "demo" : "full";
    const files = (parsed.fileList || []).filter((file) => file.field === "files");
    if (!files.length) return send(res, 400, adminPage(readDb(), "Выбери папку сборки игры."));
    const targets = stripCommonUploadRoot(files.map((file) => file.filename));
    let written = 0;
    let skipped = 0;
    let hasIndex = false;
    clearLiveGameRoot(scope);
    files.forEach((file, index) => {
      const target = targets[index];
      if (!target || shouldSkipUploadPath(target)) {
        skipped += 1;
        return;
      }
      if (target.toLowerCase() === "index.html") hasIndex = true;
      if (writeLiveGameFile(scope, target, file.data)) written += 1;
    });
    const fresh = readDb();
    fresh.releases ||= [];
    fresh.uploads ||= [];
    fresh.releases.push({
      id: `folder-${Date.now()}`,
      version: parsed.fields.version || `${scope === "demo" ? "Demo" : "Full"} folder upload`,
      note: "Uploaded as a complete game folder",
      files: written,
      createdAt: new Date().toISOString(),
    });
    fresh.uploads.push({ scope, target: "[folder]", files: written, skipped, releasedAt: new Date().toISOString() });
    writeDb(fresh);
    const label = scope === "demo" ? "Demo" : "Full";
    const message = hasIndex
      ? `${label} загружен папкой: ${written} файлов, пропущено ${skipped}. Можно запускать игру.`
      : `${label}: загружено ${written} файлов, но index.html не найден. Проверь, что выбрана папка сборки.`;
    return send(res, 200, adminPage(fresh, message));
  }

  if (req.method === "POST" && url.pathname === "/admin/upload") {
    const body = await getPostBody(req, 250 * 1024 * 1024);
    const parsed = parseMultipart(body, req.headers["content-type"]);
    const file = parsed.files.file;
    if (!file) return send(res, 400, adminPage(readDb(), "No file selected."));
    const scope = parsed.fields.scope === "demo" ? "demo" : "full";
    const target = safeGameTarget(parsed.fields.target, file.filename);
    const dest = pendingUpdatePath(scope, target);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, file.data);
    const fresh = readDb();
    fresh.pendingUpdates ||= [];
    fresh.pendingUpdates = fresh.pendingUpdates.filter((item) => !(item.scope === scope && item.target === target));
    fresh.pendingUpdates.push({ scope, name: file.filename, target, size: file.data.length, version: parsed.fields.version || "Draft update", createdAt: new Date().toISOString() });
    writeDb(fresh);
    return send(res, 200, adminPage(fresh, `Draft uploaded: ${target}. Publish it when ready.`));
  }

  if (req.method === "POST" && url.pathname === "/admin/publish") {
    const body = await getPostBody(req);
    const fresh = readDb();
    const releaseId = publishPendingUpdates(fresh, formValue(body, "note"));
    writeDb(fresh);
    return send(res, 200, adminPage(fresh, releaseId ? `Update published: ${releaseId}` : "No draft files to publish."));
  }

  if (req.method === "GET" && url.pathname === "/admin/export-db") {
    const dbText = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, "utf8") : JSON.stringify(starterDb(), null, 2);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"osm-licenses-backup.json\"",
      "Cache-Control": "no-store",
    });
    return res.end(dbText);
  }

  return send(res, 404, "Not found", "text/plain; charset=utf-8");
}

ensureDirs();
const server = http.createServer((req, res) => router(req, res).catch((error) => { console.error(error); send(res, 500, "Internal server error", "text/plain; charset=utf-8"); }));
server.on("upgrade", handleOnlineUpgrade);
setInterval(() => {
  const cutoff = Date.now() - ONLINE_ROOM_TTL_MS;
  for (const [code, room] of onlineRooms.entries()) {
    if (room.clients.size <= 0 || room.updatedAt < cutoff) {
      for (const client of room.clients.values()) wsClose(client.ws, 1000, "Room expired");
      onlineRooms.delete(code);
    }
  }
}, 60000).unref();
server.listen(PORT, "0.0.0.0", () => {
  console.log(`OSM portal: http://localhost:${PORT}`);
  console.log(`Admin: http://localhost:${PORT}/admin`);
  console.log(`Online 1v1: ws://localhost:${PORT}/online`);
  console.log(`Admin token: ${ADMIN_TOKEN}`);
  console.log(`Data dir: ${DATA_DIR}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log(`Full game root: ${getGameRoot()}`);
  console.log(`Demo root: ${getDemoRoot() || "not loaded"}`);
});


