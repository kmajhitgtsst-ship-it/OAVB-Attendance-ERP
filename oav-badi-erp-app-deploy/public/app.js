const classes = ["VI", "VII", "VIII", "IX", "X", "XI-SCIENCE", "XII-SCIENCE"];
const sections = ["A", "B"];
const statuses = ["Present", "Absent", "Leave", "Holiday", "Late"];
let db = {};
let workingAttendance = new Map();
let activeTeacherId = localStorage.getItem("oavActiveTeacherId") || "principal";

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const today = localDateKey();
const $ = id => document.getElementById(id);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function fillSelect(select, values) {
  select.innerHTML = values.map(value => `<option>${value}</option>`).join("");
}

function parseAssignedClass(value) {
  const assigned = String(value || "").trim();
  const matchedClass = [...classes].sort((a, b) => b.length - a.length).find(className => assigned === className || assigned.startsWith(`${className}-`));
  if (!matchedClass) return null;
  const suffix = assigned === matchedClass ? "A" : assigned.slice(matchedClass.length + 1);
  return { className: matchedClass, section: suffix || "A" };
}

function activeTeacher() {
  if (activeTeacherId === "principal") return null;
  return db.teachers?.find(teacher => teacher.id === activeTeacherId) || null;
}

function activeScope() {
  const teacher = activeTeacher();
  return teacher ? parseAssignedClass(teacher.assignedClass) : null;
}

function isTeacherMode() {
  return Boolean(activeTeacher());
}

function currentClass(page) {
  const scope = activeScope();
  if (scope && ["student", "attendance", "mdm"].includes(page)) return scope;
  return {
    className: $(`${page}Class`).value,
    section: $(`${page}Section`).value
  };
}

function classKey(item) {
  return `${item.className}-${item.section}`;
}

function selectedStudents(page = "attendance") {
  const picked = currentClass(page);
  return db.students
    .filter(student => student.className === picked.className && student.section === picked.section)
    .sort((a, b) => Number(a.roll) - Number(b.roll));
}

function scopedStudents() {
  const scope = activeScope();
  if (!scope) return db.students || [];
  return (db.students || []).filter(student => student.className === scope.className && student.section === scope.section);
}

function attendanceFor(student, date = $("attendanceDate").value) {
  const key = `${date}|${student.id}`;
  if (workingAttendance.has(key)) return workingAttendance.get(key);
  const saved = db.attendance.find(record => record.date === date && record.studentId === student.id);
  return saved || { studentId: student.id, status: "Absent", timeIn: "", remarks: "" };
}

function setAttendance(student, status, timeIn = "", remarks = "") {
  const date = $("attendanceDate").value;
  workingAttendance.set(`${date}|${student.id}`, {
    studentId: student.id,
    status,
    timeIn: timeIn || (status === "Present" || status === "Late" ? "08:55" : ""),
    remarks
  });
}

function parseRollSelection(input, students) {
  const rolls = new Set();
  const invalid = [];
  String(input || "").split(",").map(part => part.trim()).filter(Boolean).forEach(part => {
    if (/^\d+$/.test(part)) {
      rolls.add(String(Number(part)).padStart(2, "0"));
      return;
    }
    const range = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (!range) {
      invalid.push(part);
      return;
    }
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (start > end) {
      invalid.push(part);
      return;
    }
    for (let roll = start; roll <= end; roll += 1) rolls.add(String(roll).padStart(2, "0"));
  });
  const selected = [...rolls].map(roll => students.find(student => student.roll === roll)).filter(Boolean);
  const missing = [...rolls].filter(roll => !students.some(student => student.roll === roll));
  return { selected, missing, invalid };
}

function attendanceSummary(date = today, students = db.students) {
  const summary = { Present: 0, Absent: 0, Leave: 0, Holiday: 0, Late: 0 };
  students.forEach(student => {
    const saved = db.attendance.find(record => record.date === date && record.studentId === student.id);
    summary[saved ? saved.status : "Absent"] += 1;
  });
  return summary;
}

function renderDashboard() {
  const visibleStudents = scopedStudents();
  const summary = attendanceSummary(today, visibleStudents);
  const scope = activeScope();
  $("metricStudents").textContent = visibleStudents.length;
  $("metricPresent").textContent = summary.Present + summary.Late;
  $("metricAbsent").textContent = summary.Absent + summary.Leave;
  $("metricMdm").textContent = db.mdmEntries
    .filter(entry => entry.date === today)
    .filter(entry => !scope || (entry.className === scope.className && entry.section === scope.section))
    .reduce((sum, entry) => sum + Number(entry.servedCount || 0), 0);

  const keys = [...new Set(visibleStudents.map(classKey))].sort();
  $("classSnapshot").innerHTML = keys.map(key => {
    const students = visibleStudents.filter(student => classKey(student) === key);
    const present = students.filter(student => {
      const record = db.attendance.find(item => item.date === today && item.studentId === student.id);
      return record && (record.status === "Present" || record.status === "Late");
    }).length;
    return `<tr><td>${escapeHtml(key)}</td><td>${students.length}</td><td>${present}</td><td>${students.length - present}</td></tr>`;
  }).join("");

  const recent = [
    ...db.messageLogs.map(item => ({ title: `Message: ${item.target}`, text: item.message, time: item.sentAt })),
    ...db.mdmEntries.map(item => ({ title: `MDM: ${item.className}-${item.section}`, text: `${item.date}: ${item.servedCount} served`, time: item.createdAt }))
  ]
    .filter(item => !scope || item.title.includes(`${scope.className}-${scope.section}`) || item.text.includes(`${scope.className}-${scope.section}`))
    .sort((a, b) => String(b.time).localeCompare(String(a.time)))
    .slice(0, 6);
  $("recentActivity").innerHTML = recent.length ? recent.map(item => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></li>`).join("") : "<li><strong>No activity yet</strong><span>Saved work appears here.</span></li>";
}

function renderTeacherSession() {
  const select = $("activeTeacher");
  const options = [
    `<option value="principal">Principal / Admin</option>`,
    ...(db.teachers || []).map(teacher => {
      const label = `${teacher.name}${teacher.assignedClass ? ` - ${teacher.assignedClass}` : ""}`;
      return `<option value="${escapeHtml(teacher.id)}">${escapeHtml(label)}</option>`;
    })
  ];
  select.innerHTML = options.join("");
  if (![...select.options].some(option => option.value === activeTeacherId)) {
    activeTeacherId = "principal";
    localStorage.setItem("oavActiveTeacherId", activeTeacherId);
  }
  select.value = activeTeacherId;

  const teacher = activeTeacher();
  const scope = activeScope();
  document.body.classList.toggle("teacher-mode", Boolean(teacher));
  $("sessionName").textContent = teacher ? teacher.name : "Principal Login";
  $("sessionScope").textContent = teacher
    ? scope ? `Class locked: ${scope.className}-${scope.section}` : "No assigned class. Ask admin to set Assigned Class."
    : "Full school access. API persistence is active.";

  ["student", "attendance", "mdm"].forEach(page => {
    const classSelect = $(`${page}Class`);
    const sectionSelect = $(`${page}Section`);
    if (!classSelect || !sectionSelect) return;
    if (scope) {
      classSelect.value = scope.className;
      sectionSelect.value = scope.section;
    }
    classSelect.disabled = Boolean(scope);
    sectionSelect.disabled = Boolean(scope);
  });

  document.querySelectorAll(".admin-only").forEach(item => item.classList.toggle("hidden", Boolean(teacher)));
  if (teacher && document.querySelector(".nav.active.admin-only")) {
    document.querySelector('[data-page="attendance"]').click();
  }
}

function renderStudents() {
  const rows = selectedStudents("student");
  $("studentRows").innerHTML = rows.map(student => `
    <tr>
      <td>${escapeHtml(student.roll)}</td><td>${escapeHtml(student.name)}</td><td>${escapeHtml(classKey(student))}</td>
      <td>${escapeHtml(student.guardian || "")}</td><td>${escapeHtml(student.phone || "")}</td><td>${student.hostel ? "Yes" : "No"}</td>
      <td>${isTeacherMode() ? "" : `<button class="danger delete-student" data-student="${escapeHtml(student.id)}">Delete</button>`}</td>
    </tr>
  `).join("");
}

function renderAttendance() {
  const rows = selectedStudents("attendance");
  $("attendanceRows").innerHTML = rows.map(student => {
    const record = attendanceFor(student);
    return `
      <tr>
        <td>${escapeHtml(student.roll)}</td>
        <td>${escapeHtml(student.name)}</td>
        <td><button class="status ${escapeHtml(record.status)}" data-student="${escapeHtml(student.id)}">${escapeHtml(record.status)}</button></td>
        <td>${escapeHtml(record.timeIn || "-")}</td>
        <td>${escapeHtml(record.remarks || "")}</td>
        <td><button class="secondary send-parent" data-student="${escapeHtml(student.id)}">Prepare</button></td>
      </tr>
    `;
  }).join("");
  const count = rows.length;
  $("attendanceStatus").textContent = `${$("attendanceClass").value}-${$("attendanceSection").value}: ${count} student(s) loaded.`;
  renderMdm();
}

function renderTeachers() {
  $("teacherRows").innerHTML = db.teachers.map(teacher => `
    <tr>
      <td>${escapeHtml(teacher.name)}</td><td>${escapeHtml(teacher.role)}</td><td>${escapeHtml(teacher.phone || "")}</td><td>${escapeHtml(teacher.assignedClass || "")}</td><td>${escapeHtml(teacher.status || "Present")}</td>
      <td><button class="danger delete-teacher" data-teacher="${escapeHtml(teacher.id)}">Delete</button></td>
    </tr>
  `).join("");
}

function renderMdm() {
  const rows = selectedStudents("mdm");
  let served = 0;
  $("mdmRows").innerHTML = rows.map(student => {
    const date = $("mdmDate").value;
    const record = db.attendance.find(item => item.date === date && item.studentId === student.id) || attendanceFor(student, date);
    const meal = record.status === "Present" || record.status === "Late";
    if (meal) served += 1;
    return `<tr><td>${escapeHtml(student.roll)}</td><td>${escapeHtml(student.name)}</td><td>${escapeHtml(record.status)}</td><td>${meal ? "Served" : "Not served"}</td></tr>`;
  }).join("");
  $("mdmEligible").textContent = rows.length;
  $("mdmServed").textContent = served;
  $("mdmAbsent").textContent = rows.length - served;
  $("mdmRiceUsed").textContent = `${Number($("mdmRice").value || 0)} kg`;
  $("mdmStatus").textContent = `${$("mdmClass").value}-${$("mdmSection").value}: ${served} meal(s) from ${rows.length} students.`;
}

function renderLogs() {
  $("messageLog").innerHTML = db.messageLogs.length ? db.messageLogs.map(log => `
    <li><strong>${escapeHtml(log.target)} - ${escapeHtml(log.status)}</strong><span>${escapeHtml(new Date(log.sentAt).toLocaleString())}\n${escapeHtml(log.message)}</span></li>
  `).join("") : "<li><strong>No message prepared yet</strong><span>Parent or group messages appear here.</span></li>";
  $("mdmLog").innerHTML = db.mdmEntries.length ? db.mdmEntries.map(entry => `
    <li><strong>${escapeHtml(entry.className)}-${escapeHtml(entry.section)}: ${Number(entry.servedCount || 0)} meals</strong><span>${escapeHtml(entry.date)}: ${escapeHtml(entry.menu)}. Rice ${Number(entry.riceKg || 0)} kg, dal/veg ${Number(entry.dalKg || 0)} kg, egg/fruit ${Number(entry.eggFruitCount || 0)}.</span></li>
  `).join("") : "<li><strong>No MDM entry saved yet</strong><span>Saved entries appear here.</span></li>";
}

function renderSettings() {
  const month = $("workingMonth").value;
  const setting = db.settings.workingMonths[month] || { workingDays: 24, holidays: [] };
  $("workingDays").value = setting.workingDays;
  $("holidayDates").value = setting.holidays.join(", ");
  $("settingsStatus").textContent = `${month}: ${setting.workingDays} working days.`;
}

function renderAll() {
  renderTeacherSession();
  renderDashboard();
  renderStudents();
  renderAttendance();
  renderTeachers();
  renderMdm();
  renderLogs();
  renderSettings();
}

async function load() {
  db = await api("/api/bootstrap");
  renderAll();
}

async function addStudent() {
  const scope = activeScope();
  const payload = {
    roll: $("studentRoll").value,
    name: $("studentName").value,
    className: scope ? scope.className : $("studentClass").value,
    section: scope ? scope.section : $("studentSection").value,
    guardian: $("studentGuardian").value,
    phone: $("studentPhone").value
  };
  await api("/api/students", { method: "POST", body: payload });
  $("studentStatus").textContent = `${payload.name} saved.`;
  $("studentName").value = "";
  $("studentRoll").value = "";
  await load();
}

async function importStudents() {
  const scope = activeScope();
  const result = await api("/api/students/bulk", {
    method: "POST",
    body: {
      text: $("studentBulk").value,
      className: scope ? scope.className : $("studentClass").value,
      section: scope ? scope.section : $("studentSection").value
    }
  });
  $("studentStatus").textContent = `${result.added} student(s) imported.`;
  $("studentBulk").value = "";
  await load();
}

async function importTeachers() {
  const result = await api("/api/teachers/bulk", { method: "POST", body: { text: $("teacherBulk").value } });
  $("teacherStatus").textContent = `${result.added} teacher(s) imported.`;
  $("teacherBulk").value = "";
  await load();
}

async function deleteStudent(studentId) {
  const student = db.students.find(item => item.id === studentId);
  if (!student) return;
  const ok = confirm(`Delete student ${student.name} (${classKey(student)}, Roll ${student.roll})? Attendance records for this student will also be removed.`);
  if (!ok) return;
  await api(`/api/students/${encodeURIComponent(studentId)}`, { method: "DELETE" });
  workingAttendance.clear();
  $("studentStatus").textContent = `${student.name} deleted.`;
  await load();
}

async function deleteTeacher(teacherId) {
  const teacher = db.teachers.find(item => item.id === teacherId);
  if (!teacher) return;
  const ok = confirm(`Delete teacher ${teacher.name}? Staff attendance records for this teacher will also be removed.`);
  if (!ok) return;
  await api(`/api/teachers/${encodeURIComponent(teacherId)}`, { method: "DELETE" });
  $("teacherStatus").textContent = `${teacher.name} deleted.`;
  await load();
}

function previewBulk() {
  const result = parseRollSelection($("bulkRolls").value, selectedStudents("attendance"));
  $("bulkPreview").innerHTML = result.selected.map(student => `<span class="chip">Roll ${Number(student.roll)}: ${escapeHtml(student.name)}</span>`).join("");
  const check = [...result.invalid, ...result.missing.map(roll => Number(roll))];
  $("attendanceStatus").textContent = result.selected.length
    ? `${result.selected.length} student(s) selected for ${$("bulkStatus").value}.${check.length ? ` Check: ${check.join(", ")}.` : ""}`
    : "No valid student found for that roll selection.";
  return result.selected;
}

function applyBulk() {
  const selected = previewBulk();
  selected.forEach(student => setAttendance(student, $("bulkStatus").value, "", `Bulk marked ${$("bulkStatus").value}`));
  renderAttendance();
}

async function saveAttendance() {
  const picked = currentClass("attendance");
  const records = selectedStudents("attendance").map(student => attendanceFor(student));
  const result = await api("/api/attendance", {
    method: "POST",
    body: { date: $("attendanceDate").value, ...picked, records }
  });
  $("attendanceStatus").textContent = `${result.saved} attendance record(s) saved.`;
  workingAttendance.clear();
  await load();
}

async function saveMdm() {
  const picked = currentClass("mdm");
  const entry = await api("/api/mdm", {
    method: "POST",
    body: {
      date: $("mdmDate").value,
      ...picked,
      menu: $("mdmMenu").value,
      eligibleCount: Number($("mdmEligible").textContent),
      servedCount: Number($("mdmServed").textContent),
      riceKg: Number($("mdmRice").value || 0),
      dalKg: Number($("mdmDal").value || 0),
      eggFruitCount: Number($("mdmEgg").value || 0)
    }
  });
  $("mdmStatus").textContent = `${entry.className}-${entry.section}: MDM entry saved.`;
  await load();
}

async function saveSettings() {
  const holidays = $("holidayDates").value.split(",").map(item => item.trim()).filter(Boolean);
  const setting = await api("/api/settings/month", {
    method: "POST",
    body: { month: $("workingMonth").value, workingDays: $("workingDays").value, holidays }
  });
  $("settingsStatus").textContent = `${$("workingMonth").value} saved with ${setting.workingDays} working days.`;
  await load();
}

function monthlyStats(student) {
  const month = $("workingMonth").value || today.slice(0, 7);
  const setting = db.settings.workingMonths[month] || { workingDays: 24, holidays: [] };
  const records = db.attendance.filter(record => record.studentId === student.id && record.date.startsWith(month));
  const present = records.filter(record => record.status === "Present" || record.status === "Late").length;
  const leave = records.filter(record => record.status === "Leave").length;
  const absent = Math.max(0, Number(setting.workingDays) - present - leave - setting.holidays.length);
  const percent = setting.workingDays ? Math.round((present / setting.workingDays) * 1000) / 10 : 0;
  return { present, absent, leave, holidays: setting.holidays.length, percent };
}

async function prepareParentMessage(studentId) {
  const student = db.students.find(item => item.id === studentId);
  const record = attendanceFor(student);
  const stats = monthlyStats(student);
  const message = `Dear Parent,\n\nThis is to inform you that your ward ${student.name.toUpperCase()} of Class ${classKey(student)} was ${record.status.toLowerCase()} from school today.\n\nAttendance Summary:\nPresent Days: ${stats.present}\nAbsent Days: ${stats.absent}\nLeave Days: ${stats.leave}\nHolidays: ${stats.holidays}\nAttendance Percentage: ${stats.percent}%\n\nRegards,\nClass Teacher,\nOAV Badi`;
  await api("/api/messages", { method: "POST", body: { targetType: "parent", target: `${student.name} parent`, message } });
  await load();
  document.querySelector('[data-page="logs"]').click();
}

function bind() {
  document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => {
    document.querySelectorAll(".nav").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".page").forEach(page => page.classList.add("hidden"));
    button.classList.add("active");
    $(button.dataset.page).classList.remove("hidden");
  }));
  ["studentClass", "attendanceClass", "mdmClass"].forEach(id => fillSelect($(id), classes));
  ["studentSection", "attendanceSection", "mdmSection"].forEach(id => fillSelect($(id), sections));
  ["attendanceDate", "mdmDate"].forEach(id => $(id).value = today);
  $("workingMonth").value = today.slice(0, 7);
  $("reloadData").addEventListener("click", load);
  $("activeTeacher").addEventListener("change", event => {
    activeTeacherId = event.target.value;
    localStorage.setItem("oavActiveTeacherId", activeTeacherId);
    workingAttendance.clear();
    renderAll();
  });
  $("addStudent").addEventListener("click", addStudent);
  $("importStudents").addEventListener("click", importStudents);
  $("importTeachers").addEventListener("click", importTeachers);
  $("previewBulk").addEventListener("click", previewBulk);
  $("applyBulk").addEventListener("click", applyBulk);
  $("saveAttendance").addEventListener("click", saveAttendance);
  $("saveMdm").addEventListener("click", saveMdm);
  $("saveSettings").addEventListener("click", saveSettings);
  $("markAllPresent").addEventListener("click", () => {
    selectedStudents("attendance").forEach(student => setAttendance(student, "Present"));
    renderAttendance();
  });
  ["studentClass", "studentSection"].forEach(id => $(id).addEventListener("change", renderStudents));
  ["attendanceClass", "attendanceSection", "attendanceDate"].forEach(id => $(id).addEventListener("change", renderAttendance));
  ["mdmClass", "mdmSection", "mdmDate", "mdmRice", "mdmDal", "mdmEgg", "mdmMenu"].forEach(id => $(id).addEventListener("change", renderMdm));
  $("workingMonth").addEventListener("change", renderSettings);
  document.addEventListener("click", event => {
    if (event.target.matches(".status")) {
      const student = db.students.find(item => item.id === event.target.dataset.student);
      const current = attendanceFor(student).status;
      setAttendance(student, statuses[(statuses.indexOf(current) + 1) % statuses.length], "", "Manual status change");
      renderAttendance();
    }
    if (event.target.matches(".send-parent")) {
      prepareParentMessage(event.target.dataset.student);
    }
    if (event.target.matches(".delete-student")) {
      deleteStudent(event.target.dataset.student);
    }
    if (event.target.matches(".delete-teacher")) {
      deleteTeacher(event.target.dataset.teacher);
    }
  });
}

bind();
load().catch(error => {
  document.body.innerHTML = `<main class="panel"><h1>Unable to load ERP</h1><p>${error.message}</p></main>`;
});
