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

function cleanHeader(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeRoll(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^\d+$/.test(text) ? text.padStart(2, "0") : text;
}

function parseStudentImport(text) {
  const rows = String(text || "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(parseCsvLine);
  if (!rows.length) return [];

  const headers = rows[0].map(cleanHeader);
  const hasHeader = headers.some(header => ["rollno", "roll", "studentname", "name", "class", "section"].includes(header));
  const indexOf = (...names) => headers.findIndex(header => names.includes(header));
  const dataRows = hasHeader ? rows.slice(1) : rows;

  if (hasHeader) {
    const indexes = {
      roll: indexOf("rollno", "roll", "rollnumber"),
      name: indexOf("studentname", "name", "student"),
      className: indexOf("class", "classname"),
      section: indexOf("section", "sec"),
      guardian: indexOf("guardianname", "guardian", "fathername", "parentname"),
      phone: indexOf("mobile", "phone", "contact", "mobileno", "phonenumber"),
      hostel: indexOf("hostel", "hosteller"),
      category: indexOf("category", "caste")
    };
    return dataRows.map(row => ({
      roll: row[indexes.roll] || "",
      name: row[indexes.name] || "",
      className: row[indexes.className] || "",
      section: row[indexes.section] || "",
      guardian: row[indexes.guardian] || "",
      phone: row[indexes.phone] || "",
      hostel: row[indexes.hostel] || "",
      category: row[indexes.category] || ""
    }));
  }

  return dataRows.map(row => ({
    roll: row[0] || "",
    name: row[1] || "",
    className: row[2] || "",
    section: row[3] || "",
    guardian: row[4] || "",
    phone: row[5] || "",
    hostel: row[6] || "",
    category: row[7] || ""
  }));
}

function upsertById(items, incoming) {
  const index = items.findIndex(item => item.id === incoming.id);
  if (index >= 0) items[index] = { ...items[index], ...incoming };
  else items.push(incoming);
  return incoming;
}

// Baki code bahut lamba hai. Easy way:
// GitHub me server.js pura replace karne ke liye updated file use karo:
// C:\Users\DIVYAM\Documents\Codex\2026-07-03\kya-a-2\outputs\oav-badi-erp-app-deploy\server.js
