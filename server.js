const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.OAVB_DATA_DIR || (process.env.RENDER ? path.join(os.tmpdir(), "oav-badi-erp-data") : path.join(ROOT, "data"));
const STATE_FILE = path.join(DATA_DIR, "cloud-state.json");

function ensureDataFile() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ updatedAt: 0, state: {} }, null, 2));
  }
}

process.on("uncaughtException", error => {
  console.error("Uncaught server error:", error);
  process.exit(1);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled server rejection:", error);
  process.exit(1);
});

function readState() {
  ensureDataFile();
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function writeState(payload) {
  ensureDataFile();
  fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2));
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 10_000_000) req.destroy();
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html";
  if (ext === ".css") return "text/css";
  if (ext === ".js") return "text/javascript";
  if (ext === ".json") return "application/json";
  if (ext === ".csv") return "text/csv";
  return "application/octet-stream";
}

function sendFile(req, res) {
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  const cleanPath = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(ROOT, cleanPath));
  if (!filePath.startsWith(ROOT)) return sendJson(res, 403, { error: "Forbidden" });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendJson(res, 404, { error: "Not found" });
  }
  res.writeHead(200, {
    "content-type": `${contentType(filePath)}; charset=utf-8`,
    "cache-control": "no-store, no-cache, must-revalidate, max-age=0"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  if (req.method === "GET" && req.url.startsWith("/api/health")) {
    return sendJson(res, 200, { ok: true, app: "OAV BADI ERP", time: new Date().toISOString() });
  }

  if (req.method === "GET" && req.url.startsWith("/api/cloud-state")) {
    return sendJson(res, 200, readState());
  }

  if (req.method === "POST" && req.url.startsWith("/api/cloud-state")) {
    const body = await readBody(req);
    const current = readState();
    const incomingUpdatedAt = Number(body.updatedAt || Date.now());
    if (current.updatedAt && incomingUpdatedAt < current.updatedAt) {
      return sendJson(res, 409, { error: "Server has newer data.", current });
    }
    const payload = {
      updatedAt: incomingUpdatedAt,
      savedAt: new Date().toISOString(),
      state: body.state || {}
    };
    writeState(payload);
    return sendJson(res, 200, { ok: true, updatedAt: payload.updatedAt, savedAt: payload.savedAt });
  }

  return sendJson(res, 404, { error: "API route not found." });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(error => sendJson(res, 500, { error: error.message }));
    return;
  }
  sendFile(req, res);
});

server.listen(PORT, () => {
  ensureDataFile();
  console.log(`OAV BADI ERP running on http://0.0.0.0:${PORT}`);
  console.log(`Cloud sync data file: ${STATE_FILE}`);
});
