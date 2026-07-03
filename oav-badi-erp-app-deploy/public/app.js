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

async function importWholeSchoolStudents() {
  const text = $("studentBulk").value.trim();
  if (!text) {
    $("studentStatus").textContent = "CSV file/text first load or paste karo.";
    return;
  }
  const result = await api("/api/students/whole-school", {
    method: "POST",
    body: { text }
  });
  $("studentStatus").textContent = `${result.added} added, ${result.updated} updated, ${result.skipped} skipped.`;
  $("studentBulk").value = "";
  await load();
}

function loadStudentFile() {
  const file = $("studentImportFile").files[0];
  if (!file) {
    $("studentStatus").textContent = "Pehle CSV file choose karo.";
    return;
  }
  const extension = file.name.split(".").pop().toLowerCase();
  if (extension === "xlsx" || extension === "xls") {
    if (!window.XLSX) {
      $("studentStatus").textContent = "Excel support load nahi hua. Excel me file ko CSV me save karke choose karo.";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const workbook = XLSX.read(reader.result, { type: "array" });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      $("studentBulk").value = XLSX.utils.sheet_to_csv(firstSheet);
      $("studentStatus").textContent = `${file.name} loaded. Ab Import Whole School CSV click karo.`;
    };
    reader.onerror = () => {
      $("studentStatus").textContent = "Excel file read nahi ho pa raha hai.";
    };
    reader.readAsArrayBuffer(file);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    $("studentBulk").value = String(reader.result || "");
    $("studentStatus").textContent = `${file.name} loaded. Ab Import Whole School CSV click karo.`;
  };
  reader.onerror = () => {
    $("studentStatus").textContent = "File read nahi ho pa raha hai.";
  };
  reader.readAsText(file);
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
    if (event.target.matches(".send-parent")) {
      prepareParentMessage(event.target.dataset.student);
    }
    if (event.target.matches(".delete-student")) {
      deleteStudent(event.target.dataset.student);
    }
    if (event.target.matches(".edit-student")) {
      editStudent(event.target.dataset.student);
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
