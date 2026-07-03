const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3050);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const REQUESTED_DB_FILE = process.env.OAV_DB_FILE || path.join(ROOT, "data", "db.json");
let activeDbFile = REQUESTED_DB_FILE;
const SEED_FILE = path.join(ROOT, "data", "db.json");

function ensureDbFile() {
  try {
    const dbDir = path.dirname(activeDbFile);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    if (!fs.existsSync(activeDbFile)) fs.copyFileSync(SEED_FILE, activeDbFile);
  } catch (error) {
    if (activeDbFile === REQUESTED_DB_FILE) {
      activeDbFile = path.join("/tmp", "oav-badi-db.json");
      console.warn(`Unable to use ${REQUESTED_DB_FILE}: ${error.message}. Falling back to ${activeDbFile}`);
      ensureDbFile();
      return;
    }
    throw error;
  }
}

function readDb() {
  ensureDbFile();
  return JSON.parse(fs.readFileSync(activeDbFile, "utf8"));
}

function writeDb(db) {
  ensureDbFile();
  fs.writeFileSync(activeDbFile, JSON.stringify(db, null, 2));
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function json(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) req.destroy();
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

function classKey(item) {
  return `${item.className}-${item.section}`;
}

function parseCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }

  cells.push(cell.trim());
  return cells;
}

function parseCsvRows(text, columns) {
  return String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => parseCsvLine(line).slice(0, columns));
}

function upsertById(items, incoming) {
  const index = items.findIndex(item => item.id === incoming.id);
  if (index >= 0) items[index] = { ...items[index], ...incoming };
  else items.push(incoming);
  return incoming;
}

function sendStatic(req, res) {
  const requestPath = req.url === "/" ? "/index.html" : decodeURIComponent(req.url.split("?")[0]);
  const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "Forbidden" });
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return json(res, 404, { error: "Not found" });
  const ext = path.extname(filePath).toLowerCase();
  const type = ext === ".css" ? "text/css" : ext === ".js" ? "text/javascript" : "text/html";
  res.writeHead(200, {
    "content-type": `${type}; charset=utf-8`,
    "cache-control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    "pragma": "no-cache",
    "expires": "0"
  });
  fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const db = readDb();
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return json(res, 200, db);
  }

  if (req.method === "POST" && url.pathname === "/api/students") {
    const body = await readBody(req);
    const student = {
      id: body.id || id("stu"),
      roll: String(body.roll || "").padStart(2, "0"),
      name: body.name || "",
      className: body.className || "VI",
      section: body.section || "A",
      guardian: body.guardian || "",
      phone: body.phone || "",
      hostel: Boolean(body.hostel),
      category: body.category || ""
    };
    if (!student.name || !student.roll) return json(res, 400, { error: "Name and roll are required." });
    const duplicate = db.students.find(item => item.id !== student.id && classKey(item) === classKey(student) && item.roll === student.roll);
    if (duplicate) return json(res, 409, { error: "Duplicate roll in this class." });
    upsertById(db.students, student);
    writeDb(db);
    return json(res, 200, student);
  }

  if (req.method === "POST" && url.pathname === "/api/students/bulk") {
    const body = await readBody(req);
    const rows = parseCsvRows(body.text, 6);
    let added = 0;
    rows.forEach(row => {
      const student = {
        id: id("stu"),
        roll: String(row[0] || "").padStart(2, "0"),
        name: row[1] || "",
        className: body.className || "VI",
        section: body.section || "A",
        guardian: row[2] || "",
        phone: row[3] || "",
        hostel: /^yes|true|hostel$/i.test(row[4] || ""),
        category: row[5] || ""
      };
      if (!student.name || !student.roll) return;
      if (db.students.some(item => classKey(item) === classKey(student) && item.roll === student.roll)) return;
      db.students.push(student);
      added += 1;
    });
    writeDb(db);
    return json(res, 200, { added });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/students/")) {
    const studentId = decodeURIComponent(url.pathname.split("/").pop());
    const student = db.students.find(item => item.id === studentId);
    if (!student) return json(res, 404, { error: "Student not found." });
    db.students = db.students.filter(item => item.id !== studentId);
    db.attendance = db.attendance.filter(item => item.studentId !== studentId);
    db.messageLogs = db.messageLogs.filter(item => !String(item.target || "").includes(student.name));
    writeDb(db);
    return json(res, 200, { deleted: true, id: studentId, name: student.name });
  }

  if (req.method === "POST" && url.pathname === "/api/teachers/bulk") {
    const body = await readBody(req);
    let added = 0;
    parseCsvRows(body.text, 4).forEach(row => {
      if (!row[0] || db.teachers.some(item => item.name.toLowerCase() === row[0].toLowerCase())) return;
      db.teachers.push({
        id: id("tch"),
        name: row[0],
        role: row[1] || "Teacher",
        phone: row[2] || "",
        assignedClass: row[3] || "",
        status: "Present"
      });
      added += 1;
    });
    writeDb(db);
    return json(res, 200, { added });
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/teachers/")) {
    const teacherId = decodeURIComponent(url.pathname.split("/").pop());
    const teacher = db.teachers.find(item => item.id === teacherId);
    if (!teacher) return json(res, 404, { error: "Teacher not found." });
    db.teachers = db.teachers.filter(item => item.id !== teacherId);
    db.staffAttendance = db.staffAttendance.filter(item => item.teacherId !== teacherId);
    writeDb(db);
    return json(res, 200, { deleted: true, id: teacherId, name: teacher.name });
  }

  if (req.method === "POST" && url.pathname === "/api/attendance") {
    const body = await readBody(req);
    const sessionKey = `${body.date}|${body.className}|${body.section}`;
    db.attendance = db.attendance.filter(item => `${item.date}|${item.className}|${item.section}` !== sessionKey);
    body.records.forEach(record => {
      db.attendance.push({
        id: id("att"),
        date: body.date,
        className: body.className,
        section: body.section,
        studentId: record.studentId,
        status: record.status,
        timeIn: record.timeIn || "",
        remarks: record.remarks || ""
      });
    });
    writeDb(db);
    return json(res, 200, { saved: body.records.length });
  }

  if (req.method === "POST" && url.pathname === "/api/settings/month") {
    const body = await readBody(req);
    db.settings.workingMonths[body.month] = {
      workingDays: Math.max(1, Math.min(31, Number(body.workingDays) || 1)),
      holidays: Array.isArray(body.holidays) ? body.holidays : []
    };
    writeDb(db);
    return json(res, 200, db.settings.workingMonths[body.month]);
  }

  if (req.method === "POST" && url.pathname === "/api/mdm") {
    const body = await readBody(req);
    const key = `${body.date}|${body.className}|${body.section}`;
    db.mdmEntries = db.mdmEntries.filter(item => `${item.date}|${item.className}|${item.section}` !== key);
    const entry = { id: id("mdm"), ...body, createdAt: new Date().toISOString() };
    db.mdmEntries.unshift(entry);
    writeDb(db);
    return json(res, 200, entry);
  }

  if (req.method === "POST" && url.pathname === "/api/messages") {
    const body = await readBody(req);
    const log = {
      id: id("msg"),
      sentAt: new Date().toISOString(),
      targetType: body.targetType || "class_group",
      target: body.target || "",
      message: body.message || "",
      status: "Prepared"
    };
    db.messageLogs.unshift(log);
    writeDb(db);
    return json(res, 200, log);
  }

  return json(res, 404, { error: "API route not found." });
}

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/")) {
    handleApi(req, res).catch(error => json(res, 500, { error: error.message }));
    return;
  }
  sendStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`OAV BADI ERP running at http://localhost:${PORT}`);
  console.log(`Requested data file: ${REQUESTED_DB_FILE}`);
  console.log(`Active data file: ${activeDbFile}`);
});
