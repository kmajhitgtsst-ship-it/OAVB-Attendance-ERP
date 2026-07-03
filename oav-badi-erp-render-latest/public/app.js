const classes = ["VI", "VII", "VIII", "IX", "X", "XI-SCIENCE", "XII-SCIENCE"];
const sections = ["A", "B"];
const statuses = ["Present", "Absent", "Leave", "Holiday", "Late"];
let db = {};
let workingAttendance = new Map();
let activeTeacherId = localStorage.getItem("oavActiveTeacherId") || "principal";
let editingStudentId = null;

const $ = id => document.getElementById(id);
const today = localDateKey();

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#039;");
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
  select.innerHTML = values.map(value => `<option>${escapeHtml(value)}</option>`).join("");
}

function classKey(item) {
  return `${item.className}-${item.section}`;
}

function parseAssignedClass(value) {
  const assigned = String(value || "").trim();
  const matchedClass = [...classes].sort((a, b) => b.length - a.length).find(className => assigned === className || assigned.startsWith(`${className}-`));
  if (!matchedClass) return null;
  const section = assigned === matchedClass ? "A" : assigned.slice(matchedClass.length + 1);
  return { className: matchedClass, section: section || "A" };
}

function activeTeacher() {
  if (activeTeacherId === "principal") return null;
  return (db.teachers || []).find(teacher => teacher.id === activeTeacherId) || null;
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
  return { className: $(`${page}Class`).value, section: $(`${page}Section`).value };
}

function selectedStudents(page = "attendance") {
  const picked = currentClass(page);
  return (db.students || [])
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
  return (db.attendance || []).find(record => record.date === date && record.studentId === student.id) || { studentId: student.id, status: "Absent", timeIn: "", remarks: "" };
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

function attendanceSummary(date = today, students = db.students || []) {
  const summary = { Present: 0, Absent: 0, Leave: 0, Holiday: 0, Late: 0 };
  students.forEach(student => {
    const saved = (db.attendance || []).find(record => record.date === date && record.studentId === student.id);
    summary[saved ? saved.status : "Absent"] += 1;
  });
  return summary;
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
    if (!range || Number(range[1]) > Number(range[2])) {
      invalid.push(part);
      return;
    }
    for (let roll = Number(range[1]); roll <= Number(range[2]); roll += 1) rolls.add(String(roll).padStart(2, "0"));
  });
  const selected = [...rolls].map(roll => students.find(student => student.roll === roll)).filter(Boolean);
  const missing = [...rolls].filter(roll => !students.some(student => student.roll === roll));
  return { selected, missing, invalid };
}

function renderDashboard() {
  const visible = scopedStudents();
  const summary = attendanceSummary(today, visible);
  $("metricStudents").textContent = visible.length;
  $("metricPresent").textContent = summary.Present + summary.Late;
  $("metricAbsent").textContent = summary.Absent + summary.Leave;
  $("metricMdm").textContent = (db.mdmEntries || []).filter(entry => entry.date === today).reduce((sum, entry) => sum + Number(entry.servedCount || 0), 0);

  const keys = [...new Set(visible.map(classKey))].sort();
  $("classSnapshot").innerHTML = keys.length ? keys.map(key => {
    const students = visible.filter(student => classKey(student) === key);
    const present = students.filter(student => {
      const record = (db.attendance || []).find(item => item.date === today && item.studentId === student.id);
      return record && (record.status === "Present" || record.status === "Late");
    }).length;
    return `<tr><td>${escapeHtml(key)}</td><td>${students.length}</td><td>${present}</td><td>${students.length - present}</td></tr>`;
  }).join("") : `<tr><td colspan="4">No students imported yet.</td></tr>`;

  const recent = [
    ...(db.messageLogs || []).map(item => ({ title: `Message: ${item.target}`, text: item.message, time: item.sentAt })),
    ...(db.mdmEntries || []).map(item => ({ title: `MDM: ${item.className}-${item.section}`, text: `${item.date}: ${item.servedCount} served`, time: item.createdAt }))
  ].sort((a, b) => String(b.time).localeCompare(String(a.time))).slice(0, 6);
  $("recentActivity").innerHTML = recent.length ? recent.map(item => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.text)}</span></li>`).join("") : `<li><strong>No activity yet</strong><span>Saved work appears here.</span></li>`;
}

function renderTeacherSession() {
  const select = $("activeTeacher");
  select.innerHTML = [`<option value="principal">Principal / Admin</option>`, ...(db.teachers || []).filter(teacher => teacher.assignedClass).map(teacher => `<option value="${escapeHtml(teacher.id)}">${escapeHtml(teacher.name)} - ${escapeHtml(teacher.assignedClass)}</option>`)].join("");
  if (![...select.options].some(option => option.value === activeTeacherId)) activeTeacherId = "principal";
  select.value = activeTeacherId;

  const teacher = activeTeacher();
  const scope = activeScope();
  document.body.classList.toggle("teacher-mode", Boolean(teacher));
  $("sessionName").textContent = teacher ? teacher.name : "Principal Login";
  $("sessionScope").textContent = teacher ? scope ? `Class locked: ${scope.className}-${scope.section}` : "No assigned class." : "Full school access.";
  ["student", "attendance", "mdm"].forEach(page => {
    if (!$(`${page}Class`)) return;
    if (scope) {
      $(`${page}Class`).value = scope.className;
      $(`${page}Section`).value = scope.section;
    }
    $(`${page}Class`).disabled = Boolean(scope);
    $(`${page}Section`).disabled = Boolean(scope);
  });
  document.querySelectorAll(".admin-only").forEach(item => item.classList.toggle("hidden", Boolean(teacher)));
}

function renderStudents() {
  const rows = selectedStudents("student");
  $("studentRows").innerHTML = rows.length ? rows.map(student => `
    <tr>
      <td>${escapeHtml(student.roll)}</td>
      <td><strong>${escapeHtml(student.name)}</strong><span>${escapeHtml(student.admissionNo || "")}</span></td>
      <td>${escapeHtml(classKey(student))}</td>
      <td>${escapeHtml(student.guardian || student.fatherName || "")}</td>
      <td>${escapeHtml(student.phone || "")}</td>
      <td>${escapeHtml(student.category || "")}</td>
      <td>${isTeacherMode() ? "" : `<div class="row-actions"><button class="secondary edit-student" data-student="${escapeHtml(student.id)}">Edit</button><button class="danger delete-student" data-student="${escapeHtml(student.id)}">Delete</button></div>`}</td>
    </tr>
  `).join("") : `<tr><td colspan="7">No students in selected class.</td></tr>`;
}

function renderAttendance() {
  const rows = selectedStudents("attendance");
  $("attendanceRows").innerHTML = rows.map(student => {
    const record = attendanceFor(student);
    return `<tr>
      <td>${escapeHtml(student.roll)}</td><td>${escapeHtml(student.name)}</td>
      <td><button class="status ${escapeHtml(record.status)}" data-student="${escapeHtml(student.id)}">${escapeHtml(record.status)}</button></td>
      <td>${escapeHtml(record.timeIn || "-")}</td><td>${escapeHtml(record.remarks || "")}</td>
      <td><button class="secondary send-parent" data-student="${escapeHtml(student.id)}">Prepare</button></td>
    </tr>`;
  }).join("");
  $("attendanceStatus").textContent = `${$("attendanceClass").value}-${$("attendanceSection").value}: ${rows.length} student(s) loaded.`;
  renderMdm();
}

function renderTeachers() {
  $("teacherRows").innerHTML = (db.teachers || []).map(teacher => `<tr><td>${escapeHtml(teacher.name)}</td><td>${escapeHtml(teacher.role)}</td><td>${escapeHtml(teacher.phone || "")}</td><td>${escapeHtml(teacher.assignedClass || "")}</td><td>${escapeHtml(teacher.status || "Present")}</td><td><button class="danger delete-teacher" data-teacher="${escapeHtml(teacher.id)}">Delete</button></td></tr>`).join("");
}

function renderMdm() {
  const rows = selectedStudents("mdm");
  let served = 0;
  $("mdmRows").innerHTML = rows.map(student => {
    const record = attendanceFor(student, $("mdmDate").value);
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
  $("messageLog").innerHTML = (db.messageLogs || []).length ? db.messageLogs.map(log => `<li><strong>${escapeHtml(log.target)} - ${escapeHtml(log.status)}</strong><span>${escapeHtml(log.message)}</span></li>`).join("") : `<li><strong>No message prepared yet</strong><span>Parent messages appear here.</span></li>`;
  $("mdmLog").innerHTML = (db.mdmEntries || []).length ? db.mdmEntries.map(entry => `<li><strong>${escapeHtml(entry.className)}-${escapeHtml(entry.section)}: ${Number(entry.servedCount || 0)} meals</strong><span>${escapeHtml(entry.date)}: ${escapeHtml(entry.menu)}</span></li>`).join("") : `<li><strong>No MDM entry saved yet</strong><span>Saved entries appear here.</span></li>`;
}

function renderSettings() {
  const month = $("workingMonth").value;
  const setting = db.settings?.workingMonths?.[month] || { workingDays: 24, holidays: [] };
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

function studentPayload() {
  const scope = activeScope();
  return {
    id: editingStudentId || undefined,
    admissionNo: $("studentAdmissionNo").value,
    roll: $("studentRoll").value,
    name: $("studentName").value,
    className: scope ? scope.className : $("studentClass").value,
    section: scope ? scope.section : $("studentSection").value,
    gender: $("studentGender").value,
    dob: $("studentDob").value,
    guardian: $("studentGuardian").value,
    fatherName: $("studentFather").value,
    motherName: $("studentMother").value,
    phone: $("studentPhone").value,
    category: $("studentCategory").value,
    address: $("studentAddress").value
  };
}

function clearStudentForm() {
  editingStudentId = null;
  ["studentAdmissionNo", "studentRoll", "studentName", "studentGuardian", "studentPhone", "studentDob", "studentFather", "studentMother", "studentCategory", "studentAddress"].forEach(id => $(id).value = "");
  $("studentGender").value = "";
  $("addStudent").textContent = "Add Student";
  $("cancelStudentEdit").classList.add("hidden");
}

async function addStudent() {
  const payload = studentPayload();
  await api("/api/students", { method: "POST", body: payload });
  $("studentStatus").textContent = editingStudentId ? `${payload.name} updated.` : `${payload.name} saved.`;
  clearStudentForm();
  await load();
}

function editStudent(studentId) {
  const student = (db.students || []).find(item => item.id === studentId);
  if (!student) return;
  editingStudentId = student.id;
  $("studentClass").value = student.className;
  $("studentSection").value = student.section;
  $("studentAdmissionNo").value = student.admissionNo || "";
  $("studentRoll").value = student.roll;
  $("studentName").value = student.name;
  $("studentGuardian").value = student.guardian || "";
  $("studentPhone").value = student.phone || "";
  $("studentGender").value = student.gender || "";
  $("studentDob").value = student.dob || "";
  $("studentFather").value = student.fatherName || "";
  $("studentMother").value = student.motherName || "";
  $("studentCategory").value = student.category || "";
  $("studentAddress").value = student.address || "";
  $("addStudent").textContent = "Update Student";
  $("cancelStudentEdit").classList.remove("hidden");
  $("studentStatus").textContent = `${student.name} editing.`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function importStudents() {
  const scope = activeScope();
  const result = await api("/api/students/bulk", { method: "POST", body: { text: $("studentBulk").value, className: scope ? scope.className : $("studentClass").value, section: scope ? scope.section : $("studentSection").value } });
  $("studentStatus").textContent = `${result.added} student(s) imported.`;
  $("studentBulk").value = "";
  await load();
}

async function importWholeSchoolStudents() {
  if (!$("studentBulk").value.trim()) {
    $("studentStatus").textContent = "CSV/Excel file first load karo.";
    return;
  }
  const result = await api("/api/students/whole-school", { method: "POST", body: { text: $("studentBulk").value } });
  $("studentStatus").textContent = `${result.added} added, ${result.updated} updated, ${result.skipped} skipped.`;
  $("studentBulk").value = "";
  await load();
}

function loadStudentFile() {
  const file = $("studentImportFile").files[0];
  if (!file) {
    $("studentStatus").textContent = "Pehle CSV/Excel file choose karo.";
    return;
  }
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "xlsx" || extension === "xls") {
    if (!window.XLSX) {
      $("studentStatus").textContent = "Excel support load nahi hua. CSV file choose karo.";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const workbook = XLSX.read(reader.result, { type: "array" });
      $("studentBulk").value = XLSX.utils.sheet_to_csv(workbook.Sheets[workbook.SheetNames[0]]);
      $("studentStatus").textContent = `${file.name} loaded. Ab Import Whole School CSV click karo.`;
    };
    reader.readAsArrayBuffer(file);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    $("studentBulk").value = String(reader.result || "");
    $("studentStatus").textContent = `${file.name} loaded. Ab Import Whole School CSV click karo.`;
  };
  reader.readAsText(file);
}

async function deleteStudent(studentId) {
  const student = db.students.find(item => item.id === studentId);
  if (!student || !confirm(`Delete student ${student.name}?`)) return;
  await api(`/api/students/${encodeURIComponent(studentId)}`, { method: "DELETE" });
  workingAttendance.clear();
  $("studentStatus").textContent = `${student.name} deleted.`;
  await load();
}

async function importTeachers() {
  const result = await api("/api/teachers/bulk", { method: "POST", body: { text: $("teacherBulk").value } });
  $("teacherStatus").textContent = `${result.added} teacher(s) imported.`;
  $("teacherBulk").value = "";
  await load();
}

async function deleteTeacher(teacherId) {
  const teacher = db.teachers.find(item => item.id === teacherId);
  if (!teacher || !confirm(`Delete teacher ${teacher.name}?`)) return;
  await api(`/api/teachers/${encodeURIComponent(teacherId)}`, { method: "DELETE" });
  $("teacherStatus").textContent = `${teacher.name} deleted.`;
  await load();
}

function previewBulk() {
  const result = parseRollSelection($("bulkRolls").value, selectedStudents("attendance"));
  $("bulkPreview").innerHTML = result.selected.map(student => `<span class="chip">Roll ${Number(student.roll)}: ${escapeHtml(student.name)}</span>`).join("");
  const check = [...result.invalid, ...result.missing.map(roll => Number(roll))];
  $("attendanceStatus").textContent = result.selected.length ? `${result.selected.length} student(s) selected.${check.length ? ` Check: ${check.join(", ")}.` : ""}` : "No valid student found.";
  return result.selected;
}

function applyBulk() {
  previewBulk().forEach(student => setAttendance(student, $("bulkStatus").value, "", `Bulk marked ${$("bulkStatus").value}`));
  renderAttendance();
}

async function saveAttendance() {
  const picked = currentClass("attendance");
  const records = selectedStudents("attendance").map(student => attendanceFor(student));
  const result = await api("/api/attendance", { method: "POST", body: { date: $("attendanceDate").value, ...picked, records } });
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
  const setting = await api("/api/settings/month", { method: "POST", body: { month: $("workingMonth").value, workingDays: $("workingDays").value, holidays } });
  $("settingsStatus").textContent = `${$("workingMonth").value} saved with ${setting.workingDays} working days.`;
  await load();
}

async function prepareParentMessage(studentId) {
  const student = db.students.find(item => item.id === studentId);
  const record = attendanceFor(student);
  const message = `Dear Parent,\n\nYour ward ${student.name} of Class ${classKey(student)} is marked ${record.status} today.\n\nRegards,\nOAV Badi`;
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
  $("cancelStudentEdit").addEventListener("click", clearStudentForm);
  $("importStudents").addEventListener("click", importStudents);
  $("loadStudentFile").addEventListener("click", loadStudentFile);
  $("importWholeSchoolStudents").addEventListener("click", importWholeSchoolStudents);
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
    if (event.target.matches(".send-parent")) prepareParentMessage(event.target.dataset.student);
    if (event.target.matches(".edit-student")) editStudent(event.target.dataset.student);
    if (event.target.matches(".delete-student")) deleteStudent(event.target.dataset.student);
    if (event.target.matches(".delete-teacher")) deleteTeacher(event.target.dataset.teacher);
  });
}

bind();
load().catch(error => {
  document.body.innerHTML = `<main class="panel"><h1>Unable to load ERP</h1><p>${escapeHtml(error.message)}</p></main>`;
});
