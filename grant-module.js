(() => {
  "use strict";

  const STORAGE_KEY = "oavBadiGrantModule";
  const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
  let state = loadState();
  let activeTab = "dashboard";
  let editingReceiptId = "";
  let editingExpenseId = "";

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        profile: { institutionName: "Odisha Adarsha Vidyalaya, Badi", institutionCode: "", address: "", district: "", block: "", state: "Odisha", ddoCode: "", treasuryCode: "", principalName: "", principalDesignation: "Principal", accountName: "", place: "", ucDate: "", currentFinancialYear: "", ...(saved.profile || {}) },
        schemes: Array.isArray(saved.schemes) ? saved.schemes : [],
        receipts: Array.isArray(saved.receipts) ? saved.receipts : [],
        expenses: Array.isArray(saved.expenses) ? saved.expenses : [],
        physical: saved.physical || {},
        previousUcs: Array.isArray(saved.previousUcs) ? saved.previousUcs : [],
        form24: saved.form24 || {},
        activeFinancialYear: text(saved.activeFinancialYear),
        ucRequests: Array.isArray(saved.ucRequests) ? saved.ucRequests : [],
        audit: Array.isArray(saved.audit) ? saved.audit : []
      };
    } catch (error) {
      return { profile: { institutionName: "Odisha Adarsha Vidyalaya, Badi", state: "Odisha", principalDesignation: "Principal", currentFinancialYear: "" }, schemes: [], receipts: [], expenses: [], physical: {}, previousUcs: [], form24: {}, activeFinancialYear: "", ucRequests: [], audit: [] };
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (typeof saveLocalData === "function") saveLocalData();
  }

  function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
  function text(value) { return String(value ?? "").trim(); }
  function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
  function money(value) { return number(value).toLocaleString("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }); }
  function esc(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function financialYear(dateValue) {
    const date = new Date(`${dateValue || today()}T00:00:00`);
    const year = date.getFullYear() - (date.getMonth() < 3 ? 1 : 0);
    return `${year}-${String(year + 1).slice(-2)}`;
  }
  function activeFinancialYear() { return /^\d{4}-\d{2}$/.test(text(state.activeFinancialYear)) ? state.activeFinancialYear : financialYear(today()); }
  function statusBadge(status) { return `<span class="grant-status ${esc(String(status || "draft").toLowerCase())}">${esc(status || "Draft")}</span>`; }
  function isPrincipal() { return Boolean(window.adminSession || ["principal", "admin"].includes(String(window.activeUser?.role || "").toLowerCase())); }
  function actor() { return window.currentAuditUser ? (window.currentAuditUser().teacher || window.currentAuditUser().loginId || "Account In-Charge") : "Account In-Charge"; }
  function log(action, details, recordId = "") {
    state.audit.unshift({ id: uid("GAUD"), time: new Date().toISOString(), user: actor(), action, details, recordId });
    state.audit.splice(500);
    if (typeof addAuditLog === "function") addAuditLog(action, details, { page: "Grant & UC" });
  }
  function approvedReceipts(schemeId = "") { return state.receipts.filter(item => item.status === "Approved" && (!schemeId || item.schemeId === schemeId)); }
  function approvedExpenses(schemeId = "") { return state.expenses.filter(item => item.status === "Approved" && (!schemeId || item.schemeId === schemeId)); }
  function schemeById(id) { return state.schemes.find(item => item.id === id); }
  function receiptById(id) { return state.receipts.find(item => item.id === id); }
  function schemeLabel(id) { return schemeById(id)?.name || "-"; }
  function receiptAvailable(receiptId, excludeExpenseId = "") {
    const receipt = receiptById(receiptId);
    if (!receipt) return 0;
    const used = state.expenses
      .filter(expense => expense.status === "Approved" && expense.id !== excludeExpenseId)
      .flatMap(expense => expense.allocations || [])
      .filter(allocation => allocation.receiptId === receiptId)
      .reduce((sum, allocation) => sum + number(allocation.amount), 0);
    return number(receipt.amountReceived) + number(receipt.interest) + number(receipt.otherReceipt) - used;
  }
  function schemeSummary(schemeId) {
    const receipts = approvedReceipts(schemeId);
    const expenses = approvedExpenses(schemeId);
    const grant = receipts.reduce((sum, item) => sum + number(item.amountReceived), 0);
    const interest = receipts.reduce((sum, item) => sum + number(item.interest), 0);
    const other = receipts.reduce((sum, item) => sum + number(item.otherReceipt), 0);
    const opening = receipts.reduce((sum, item) => sum + number(item.openingBalance), 0);
    const available = grant + interest + other + opening;
    const utilized = expenses.reduce((sum, item) => sum + number(item.amount), 0);
    const balance = available - utilized;
    const physical = state.physical[schemeId] || {};
    const target = number(physical.targetQuantity);
    const achieved = number(physical.achievementQuantity);
    return { grant, interest, other, opening, available, utilized, balance, utilizationPct: available ? utilized / available * 100 : 0, status: utilized === 0 ? "Not Utilized" : Math.abs(balance) < 0.005 ? "Fully Utilized" : "Partially Utilized", physical, physicalPct: target ? achieved / target * 100 : 0 };
  }
  function groupedByYear(records, dateField, amountField) {
    const rows = {};
    records.forEach(record => {
      const year = record.financialYear || financialYear(record[dateField]);
      rows[year] = (rows[year] || 0) + number(record[amountField]);
    });
    return Object.entries(rows).sort(([first], [second]) => first.localeCompare(second));
  }
  function yearLines(rows) { return rows.length ? rows.map(([year, amount]) => `${esc(year)}: ${money(amount)}`).join("<br>") + `<br><strong>Total: ${money(rows.reduce((sum, [, amount]) => sum + amount, 0))}</strong>` : "Nil"; }
  function form24Key(schemeId, financialYear) { return `${schemeId}::${financialYear}`; }
  function toYearRows(rows) { return rows.map(([year, amount]) => ({ year, amount: number(amount) })); }
  function form24YearLines(rows) { return yearLines((rows || []).filter(row => text(row.year)).map(row => [row.year, number(row.amount)])); }
  function defaultForm24(data, financialYear) {
    const targetDescription = data.physical.targetDescription || "";
    const targetQuantity = data.physical.targetQuantity ? `${data.physical.targetQuantity} ${data.physical.targetUnit || "Nos."}` : "";
    const achievement = data.physical.achievementDescription || (data.physical.achievementQuantity ? `${data.physical.achievementQuantity} ${data.physical.achievementUnit || "Nos."}` : "");
    const remarks = data.summary.status === "Fully Utilized" && data.physical.completionStatus === "Completed" ? "Nil" : [data.summary.balance > 0 ? `Unspent balance of ${money(data.summary.balance)} remains.` : "", data.physical.shortfallReason || ""].filter(Boolean).join(" ") || "Grant not utilized during the reporting period.";
    return {
      financialYear,
      granteeOrganisation: state.profile.institutionName || "",
      schemeSector: [data.scheme.name, data.scheme.sector].filter(Boolean).join(" - "),
      financialTarget: number(data.physical.financialTarget),
      grantYears: toYearRows(groupedByYear(data.receipts, "receiptDate", "amountReceived")),
      physicalTarget: [targetDescription, targetQuantity].filter(Boolean).join(" "),
      utilizationYears: toYearRows(groupedByYear(data.expenses, "expenseDate", "amount")),
      previousUcAmount: data.previous.noPrevious ? "Nil" : money(data.previous.amount),
      previousAchievement: data.previous.noPrevious ? "Nil" : data.previous.achievement || "",
      presentAchievement: achievement,
      remarks
    };
  }
  function effectiveForm24(data, financialYear) {
    const defaults = defaultForm24(data, financialYear);
    const saved = state.form24[form24Key(data.scheme.id, financialYear)];
    return saved ? { ...defaults, ...saved, grantYears: saved.grantYears || defaults.grantYears, utilizationYears: saved.utilizationYears || defaults.utilizationYears } : defaults;
  }
  function mount() {
    const section = document.getElementById("utilisation");
    if (!section) return;
    section.innerHTML = `
      <header><div><h1>Grant, OGFR & Utilization Certificate</h1><p class="subtle">Approved grant receipts and expenditure allocations automatically prepare OGFR Form-23, Form-24 and the Utilization Certificate.</p></div></header>
      <div id="grantModuleRoot" class="grant-module"></div>`;
    render();
  }
  window.renderAdvancedGrantModule = () => { state = loadState(); if (!document.getElementById("grantModuleRoot")) mount(); else render(); };

  function tabs() {
    const items = [["dashboard", "Dashboard"], ["master", "Scheme & Grant Master"], ["receipts", "Grant Receipt Entry"], ["expenses", "Daily Expenditure"], ["physical", "Physical Target"], ["previous", "Previous UC"], ["forms", "OGFR & UC"], ["approval", "Approval"], ["audit", "Audit History"]];
    return `<div class="grant-tabs">${items.map(([id, label]) => `<button type="button" class="${activeTab === id ? "active" : ""}" data-grant-tab="${id}">${label}</button>`).join("")}</div>`;
  }
  function render() {
    const root = document.getElementById("grantModuleRoot");
    if (!root) return;
    root.innerHTML = `${tabs()}${dashboardPanel()}${masterPanel()}${receiptPanel()}${expensePanel()}${physicalPanel()}${previousPanel()}${formsPanel()}${approvalPanel()}${auditPanel()}`;
    bindEvents(root);
  }
  function panel(id, content) { return `<section class="grant-panel ${activeTab === id ? "active" : ""}" data-grant-panel="${id}">${content}</section>`; }
  function schemeOptions(selected = "", includeBlank = true) { return `${includeBlank ? `<option value="">Select scheme</option>` : ""}${state.schemes.map(item => `<option value="${esc(item.id)}" ${item.id === selected ? "selected" : ""}>${esc(item.name)}</option>`).join("")}`; }
  function dashboardPanel() {
    const cards = state.schemes.map(scheme => {
      const summary = schemeSummary(scheme.id);
      return `<tr><td>${esc(scheme.name)}</td><td>${money(summary.grant)}</td><td>${money(summary.utilized)}</td><td>${money(summary.balance)}</td><td>${summary.utilizationPct.toFixed(1)}%</td><td>${statusBadge(summary.status)}</td><td>${esc(summary.physical.completionStatus || "Not Started")}</td></tr>`;
    }).join("") || `<tr><td colspan="7">No schemes created yet.</td></tr>`;
    const total = state.schemes.reduce((result, scheme) => { const value = schemeSummary(scheme.id); result.grant += value.grant; result.utilized += value.utilized; result.balance += value.balance; return result; }, { grant: 0, utilized: 0, balance: 0 });
    return panel("dashboard", `<div class="grant-stats"><div class="grant-stat"><span>Total Approved Grant</span><strong>${money(total.grant)}</strong></div><div class="grant-stat"><span>Approved Expenditure</span><strong>${money(total.utilized)}</strong></div><div class="grant-stat"><span>Available Balance</span><strong>${money(total.balance)}</strong></div><div class="grant-stat"><span>Awaiting Principal</span><strong>${state.receipts.filter(item => item.status === "Submitted").length + state.expenses.filter(item => item.status === "Submitted").length}</strong></div></div><div class="card"><h2>Scheme-wise position</h2><div class="grant-table-wrap"><table class="grant-table"><thead><tr><th>Scheme</th><th>Grant received</th><th>Approved expenditure</th><th>Balance</th><th>Utilization</th><th>Status</th><th>Physical progress</th></tr></thead><tbody>${cards}</tbody></table></div></div>`);
  }
  function masterPanel() {
    const profile = state.profile;
    return panel("master", `<div class="card"><h2>Institution details</h2><div class="grant-grid"><label class="wide">Institution Name<input id="gm-institution" value="${esc(profile.institutionName)}"></label><label>Institution Code<input id="gm-institution-code" value="${esc(profile.institutionCode)}"></label><label>District<input id="gm-district" value="${esc(profile.district)}"></label><label>Block<input id="gm-block" value="${esc(profile.block)}"></label><label>State<input id="gm-state" value="${esc(profile.state)}"></label><label>DDO Code<input id="gm-ddo" value="${esc(profile.ddoCode)}"></label><label>Treasury Code<input id="gm-treasury" value="${esc(profile.treasuryCode)}"></label><label>Principal Name<input id="gm-principal" value="${esc(profile.principalName)}"></label><label>Account In-Charge<input id="gm-account" value="${esc(profile.accountName)}"></label><label class="wide">Institution Address<textarea id="gm-address">${esc(profile.address)}</textarea></label><label>Place<input id="gm-place" value="${esc(profile.place)}"></label><label>UC Date<input id="gm-uc-date" type="date" value="${esc(profile.ucDate)}"></label></div><div class="grant-actions"><button type="button" class="primary" data-action="save-profile">Save Institution Details</button></div></div><div class="card"><h2>Scheme and grant master</h2><div class="grant-grid"><label class="wide">Scheme Name<input id="gm-scheme-name" placeholder="Example: AC Installation"></label><label>Scheme Sector<input id="gm-scheme-sector" placeholder="Example: Gender and Equity"></label><label class="wide">Purpose of Grant<textarea id="gm-scheme-purpose" placeholder="Purpose for which the grant was sanctioned"></textarea></label></div><div class="grant-actions"><button type="button" class="primary" data-action="add-scheme">Add Scheme</button></div><div class="grant-table-wrap"><table class="grant-table"><thead><tr><th>Scheme</th><th>Sector</th><th>Purpose</th><th>Action</th></tr></thead><tbody>${state.schemes.map(item => `<tr><td>${esc(item.name)}</td><td>${esc(item.sector)}</td><td>${esc(item.purpose)}</td><td><button type="button" data-action="delete-scheme" data-id="${item.id}">Delete</button></td></tr>`).join("") || `<tr><td colspan="4">No scheme created.</td></tr>`}</tbody></table></div></div>`);
  }
  function receiptPanel() {
    const rows = state.receipts.slice().reverse().map(item => `<tr><td>${esc(item.entryNo)}</td><td>${esc(schemeLabel(item.schemeId))}</td><td>${esc(item.financialYear)}</td><td>${esc(item.sanctionNo || "-")}</td><td>${money(item.amountReceived)}</td><td>${money(item.interest + item.otherReceipt)}</td><td>${statusBadge(item.status)}</td><td>${esc(item.remarks || "-")}</td><td>${item.status === "Draft" || item.status === "Returned" ? `<button type="button" data-action="edit-receipt" data-id="${item.id}">Edit</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="9">No receipt entered.</td></tr>`;
    const edit = state.receipts.find(item => item.id === editingReceiptId) || {};
    return panel("receipts", `<div class="card"><h2>${editingReceiptId ? "Edit" : "Add"} Grant Receipt</h2><p class="grant-note">Every financial year and sanction order is saved separately. Only approved receipts are available for expenditure and final UC calculations.</p><div class="grant-grid"><label>Scheme<select id="gr-scheme">${schemeOptions(edit.schemeId)}</select></label><label>Receipt Financial Year<input id="gr-fy" value="${esc(edit.financialYear || financialYear(today()))}" placeholder="2025-26"></label><label>Sanction Order Number<input id="gr-sanction-no" value="${esc(edit.sanctionNo)}"></label><label>Sanction Order Date<input id="gr-sanction-date" type="date" value="${esc(edit.sanctionDate)}"></label><label>Amount Sanctioned<input id="gr-sanctioned" type="number" min="0" step="0.01" value="${number(edit.amountSanctioned)}"></label><label>Amount Received<input id="gr-received" type="number" min="0" step="0.01" value="${number(edit.amountReceived)}"></label><label>Date of Receipt<input id="gr-date" type="date" value="${esc(edit.receiptDate || today())}"></label><label>Interest Earned<input id="gr-interest" type="number" min="0" step="0.01" value="${number(edit.interest)}"></label><label>Other Receipt<input id="gr-other" type="number" min="0" step="0.01" value="${number(edit.otherReceipt)}"></label><label>Opening Balance<input id="gr-opening" type="number" min="0" step="0.01" value="${number(edit.openingBalance)}"></label><label class="wide">Purpose<textarea id="gr-purpose">${esc(edit.purpose)}</textarea></label><label class="wide">Remarks<textarea id="gr-remarks">${esc(edit.remarks)}</textarea></label><label>Sanction Order File<input id="gr-file" type="file" accept=".pdf,.jpg,.jpeg,.png"></label></div><p class="grant-note" id="gr-file-note">${edit.attachments?.map(item => esc(item.name)).join(", ") || "No attachment selected."}</p><div class="grant-actions"><button type="button" class="primary" data-action="save-receipt" data-status="Draft">Save Draft</button><button type="button" data-action="save-receipt" data-status="Submitted">Submit to Principal</button>${editingReceiptId ? `<button type="button" data-action="cancel-receipt-edit">Cancel</button>` : ""}</div></div><div class="card"><h2>Grant receipt register</h2><div class="grant-table-wrap"><table class="grant-table"><thead><tr><th>Entry</th><th>Scheme</th><th>FY</th><th>Sanction</th><th>Received</th><th>Interest/Other</th><th>Status</th><th>Remarks</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
  }
  function allocationRows(allocations = []) {
    const selectable = approvedReceipts();
    return allocations.map(allocation => `<div class="grant-allocation-row"><label>Grant Receipt<select data-allocation-receipt><option value="">Select approved receipt</option>${selectable.map(receipt => `<option value="${receipt.id}" ${receipt.id === allocation.receiptId ? "selected" : ""}>${esc(receipt.entryNo)} | ${esc(schemeLabel(receipt.schemeId))} | Available ${money(receiptAvailable(receipt.id, editingExpenseId))}</option>`).join("")}</select></label><label>Allocated Amount<input data-allocation-amount type="number" min="0" step="0.01" value="${number(allocation.amount)}"></label><button type="button" data-action="remove-allocation">Remove</button></div>`).join("");
  }
  function expensePanel() {
    const edit = state.expenses.find(item => item.id === editingExpenseId) || { expenseDate: today(), financialYear: financialYear(today()), allocations: [] };
    const rows = state.expenses.slice().reverse().map(item => `<tr><td>${esc(item.entryNo)}</td><td>${esc(item.expenseDate)}</td><td>${esc(item.financialYear)}</td><td>${esc(schemeLabel(item.schemeId))}</td><td>${esc(item.billNo || "-")}</td><td>${esc(item.voucherNo || "-")}</td><td>${esc(item.vendor || "-")}</td><td>${money(item.amount)}</td><td>${statusBadge(item.status)}</td><td>${item.status === "Draft" || item.status === "Returned" ? `<button type="button" data-action="edit-expense" data-id="${item.id}">Edit</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="10">No expenditure entered.</td></tr>`;
    return panel("expenses", `<div class="card"><h2>${editingExpenseId ? "Edit" : "Add"} Daily Expenditure</h2><p class="grant-note">Manual split allocation is required. The total allocated value must equal the expenditure amount, and no allocation can exceed the available approved grant balance.</p><div class="grant-grid"><label>Date of Expenditure<input id="ge-date" type="date" value="${esc(edit.expenseDate)}"></label><label>Financial Year<input id="ge-fy" value="${esc(edit.financialYear)}"></label><label>Scheme<select id="ge-scheme">${schemeOptions(edit.schemeId)}</select></label><label>Expenditure Head<input id="ge-head" value="${esc(edit.head)}"></label><label class="wide">Purpose / Description<textarea id="ge-description">${esc(edit.description)}</textarea></label><label>Bill Number<input id="ge-bill" value="${esc(edit.billNo)}"></label><label>Bill Date<input id="ge-bill-date" type="date" value="${esc(edit.billDate)}"></label><label>Voucher Number<input id="ge-voucher" value="${esc(edit.voucherNo)}"></label><label>Voucher Date<input id="ge-voucher-date" type="date" value="${esc(edit.voucherDate)}"></label><label>Vendor / Payee<input id="ge-vendor" value="${esc(edit.vendor)}"></label><label>Payment Mode<select id="ge-payment"><option>${esc(edit.paymentMode || "Bank Transfer")}</option><option>Cash</option><option>Cheque</option><option>Bank Transfer</option><option>PFMS</option><option>Other</option></select></label><label>Transaction / Cheque Ref.<input id="ge-reference" value="${esc(edit.reference)}"></label><label>Amount Utilized<input id="ge-amount" type="number" min="0.01" step="0.01" value="${number(edit.amount)}"></label><label>Quantity<input id="ge-quantity" type="number" min="0" step="0.01" value="${number(edit.quantity)}"></label><label>Unit<select id="ge-unit"><option>${esc(edit.unit || "Nos.")}</option><option>Nos.</option><option>Set</option><option>Piece</option><option>Job</option><option>Lot</option><option>Other</option></select></label><label>Asset / Item Location<input id="ge-location" value="${esc(edit.location)}"></label><label>Stock Register Page<input id="ge-stock-page" value="${esc(edit.stockPage)}"></label><label>Asset Register Page<input id="ge-asset-page" value="${esc(edit.assetPage)}"></label><label class="wide">Remarks<textarea id="ge-remarks">${esc(edit.remarks)}</textarea></label><label class="wide">Bill, Voucher, Supporting Files<input id="ge-files" type="file" accept=".pdf,.jpg,.jpeg,.png" multiple></label></div><p class="grant-note" id="ge-file-note">${edit.attachments?.map(item => esc(item.name)).join(", ") || "No attachment selected."}</p><h3>Split grant allocation</h3><div id="ge-allocations">${allocationRows(edit.allocations)}</div><div class="grant-actions"><button type="button" data-action="add-allocation">Add Grant Allocation</button><button type="button" data-action="check-allocation">Check Balance</button></div><p class="grant-note" id="ge-balance-note"></p><div class="grant-actions"><button type="button" class="primary" data-action="save-expense" data-status="Draft">Save Draft</button><button type="button" data-action="save-expense" data-status="Submitted">Submit to Principal</button>${editingExpenseId ? `<button type="button" data-action="cancel-expense-edit">Cancel</button>` : ""}</div></div><div class="card"><h2>Daily Expenditure Register</h2><div class="grant-actions"><button type="button" data-action="export-register">Export Excel</button></div><div class="grant-table-wrap"><table class="grant-table"><thead><tr><th>Entry</th><th>Date</th><th>FY</th><th>Scheme</th><th>Bill</th><th>Voucher</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
  }
  function physicalPanel() {
    const selected = state.schemes[0]?.id || "";
    return panel("physical", `<div class="card"><h2>Physical Target and Achievement</h2><div class="grant-grid"><label>Scheme<select id="gp-scheme">${schemeOptions(selected)}</select></label><label>Financial Target Fixed<input id="gp-financial" type="number" min="0" step="0.01"></label><label class="wide">Physical Target Description<textarea id="gp-description"></textarea></label><label>Target Quantity<input id="gp-target-quantity" type="number" min="0" step="0.01"></label><label>Target Unit<input id="gp-target-unit" placeholder="Nos."></label><label>Achievement Quantity<input id="gp-achievement-quantity" type="number" min="0" step="0.01"></label><label>Achievement Unit<input id="gp-achievement-unit" placeholder="Nos."></label><label>Completion Status<select id="gp-status"><option>Not Started</option><option>Partially Completed</option><option>Completed</option></select></label><label class="wide">Achievement Description<textarea id="gp-achievement-description"></textarea></label><label class="wide">Shortfall Reason<textarea id="gp-shortfall"></textarea></label><label class="wide">Remarks<textarea id="gp-remarks"></textarea></label></div><div class="grant-actions"><button type="button" class="primary" data-action="load-physical">Load Scheme Details</button><button type="button" data-action="save-physical">Save Physical Details</button></div></div>`);
  }
  function previousPanel() {
    const rows = state.previousUcs.slice().reverse().map(item => `<tr><td>${esc(schemeLabel(item.schemeId))}</td><td>${esc(item.financialYear)}</td><td>${esc(item.ucNo || "Nil")}</td><td>${money(item.amount)}</td><td>${esc(item.achievement || "Nil")}</td></tr>`).join("") || `<tr><td colspan="5">No previous UC saved.</td></tr>`;
    return panel("previous", `<div class="card"><h2>Previous UC Details</h2><div class="grant-grid"><label>Scheme<select id="gu-scheme">${schemeOptions()}</select></label><label>Previous UC Number<input id="gu-number"></label><label>Previous UC Date<input id="gu-date" type="date"></label><label>Financial Year<input id="gu-fy" value="${financialYear(today())}"></label><label>Amount Already Furnished<input id="gu-amount" type="number" min="0" step="0.01"></label><label class="wide">Physical Achievement<textarea id="gu-achievement"></textarea></label><label class="wide">Remarks<textarea id="gu-remarks"></textarea></label><label>No previous UC furnished<input id="gu-none" type="checkbox"></label><label>Previous UC File<input id="gu-file" type="file" accept=".pdf,.jpg,.jpeg,.png"></label></div><div class="grant-actions"><button type="button" class="primary" data-action="save-previous">Save Previous UC Detail</button></div></div><div class="card"><h2>Saved Previous UC Details</h2><div class="grant-table-wrap"><table class="grant-table"><thead><tr><th>Scheme</th><th>FY</th><th>UC Number</th><th>Amount</th><th>Physical Achievement</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
  }
  function selectedFormScheme() { return document.getElementById("gf-scheme")?.value || state.schemes[0]?.id || ""; }
  function selectedFormFinancialYear() { return text(document.getElementById("gf-fy")?.value) || financialYear(today()); }
  function form24YearEditorRows(rows, group) {
    return (rows || []).map(row => `<div class="grant-allocation-row" data-form24-year-row><label>Financial Year<input data-form24-year value="${esc(row.year)}" placeholder="2025-26"></label><label>Amount<input data-form24-amount type="number" min="0" step="0.01" value="${number(row.amount)}"></label><button type="button" data-action="remove-form24-year">Remove</button></div>`).join("");
  }
  function form24EditorHtml(data) {
    const form24 = data.form24;
    return `<div class="card"><h2>Editable Form-24 Data Entry</h2><p class="grant-note">All ten Form-24 columns are editable. Approved receipt and expenditure data is loaded as the default; add or edit year-wise rows where the official statement requires a different presentation.</p><div class="grant-grid"><label class="wide">(1) Name of Grantee Organisation<input id="f24-grantee" value="${esc(form24.granteeOrganisation)}"></label><label class="wide">(2) Scheme Name and Sector (Editable)<input id="f24-scheme-sector" value="${esc(form24.schemeSector)}"></label><label>(3) Financial Target Fixed<input id="f24-financial-target" type="number" min="0" step="0.01" value="${number(form24.financialTarget)}"></label><label class="wide">(5) Physical Target Fixed<textarea id="f24-physical-target">${esc(form24.physicalTarget)}</textarea></label><label class="wide">(7) Amount for which U.C. furnished previously<input id="f24-previous-amount" value="${esc(form24.previousUcAmount)}"></label><label class="wide">(8) Physical Target achieved against previous U.C.<textarea id="f24-previous-achievement">${esc(form24.previousAchievement)}</textarea></label><label class="wide">(9) Physical Target achieved as per present U.C.<textarea id="f24-present-achievement">${esc(form24.presentAchievement)}</textarea></label><label class="wide">(10) Remarks<textarea id="f24-remarks">${esc(form24.remarks)}</textarea></label></div><h3>(4) Amount of Grant-in-Aid Received - Year-wise</h3><div id="f24-grant-years">${form24YearEditorRows(form24.grantYears, "grant")}</div><div class="grant-actions"><button type="button" data-action="add-form24-year" data-group="grant">Add Grant Year</button></div><h3>(6) Amount Utilized - Year-wise</h3><div id="f24-utilization-years">${form24YearEditorRows(form24.utilizationYears, "utilization")}</div><div class="grant-actions"><button type="button" data-action="add-form24-year" data-group="utilization">Add Utilization Year</button><button type="button" class="primary" data-action="save-form24">Save Editable Form-24</button><button type="button" data-action="reset-form24">Restore Approved Data Default</button></div></div>`;
  }
  function collectForm24Years(containerId) { return [...document.querySelectorAll(`#${containerId} [data-form24-year-row]`)].map(row => ({ year: text(row.querySelector("[data-form24-year]")?.value), amount: number(row.querySelector("[data-form24-amount]")?.value) })).filter(row => row.year || row.amount); }
  function refreshForm24Editor() {
    const schemeId = selectedFormScheme();
    const financialYear = selectedFormFinancialYear();
    const data = formData(schemeId, { financialYear });
    const editor = document.getElementById("gf-form24-editor");
    if (editor) editor.innerHTML = form24EditorHtml(data);
  }
  function formsPanel() {
    const schemeId = state.schemes[0]?.id || "";
    return panel("forms", `<div class="card"><h2>OGFR Form-23, Form-24 and Utilization Certificate</h2><div class="grant-grid"><label>Scheme<select id="gf-scheme">${schemeOptions(schemeId)}</select></label><label>Reporting Financial Year<input id="gf-fy" value="${financialYear(today())}"></label><label>Report From<input id="gf-from" type="date"></label><label>Report To<input id="gf-to" type="date" value="${today()}"></label></div><div class="grant-actions"><button type="button" class="primary" data-action="refresh-forms">Refresh Approved Data</button><button type="button" data-action="submit-uc">Submit Draft UC to Principal</button><button type="button" data-action="download-docx" data-kind="form23">Download Form-23 Word</button><button type="button" data-action="download-docx" data-kind="form24">Download Form-24 Word</button><button type="button" data-action="download-docx" data-kind="uc">Download Combined Word</button><button type="button" data-action="print-pdf">Print / Save PDF</button></div><p class="grant-note">Final approval and record locking are available to the Principal in the Approval tab. Exports use approved records only.</p></div><div id="gf-summary"></div><div id="gf-form24-editor">${form24EditorHtml(formData(schemeId, { financialYear: financialYear(today()) }))}</div><div class="card"><h2>FORM OGFR-23 Preview</h2><div id="gf-form23" class="grant-preview"></div></div><div class="card"><h2>FORM OGFR-24 Preview</h2><div id="gf-form24" class="grant-preview"></div></div><div class="card"><h2>Utilization Certificate Preview</h2><div id="gf-uc" class="grant-preview"></div></div>`);
  }
  function approvalPanel() {
    const pending = [...state.receipts.map(item => ({ ...item, type: "Receipt" })), ...state.expenses.map(item => ({ ...item, type: "Expenditure" })), ...state.ucRequests.map(item => ({ ...item, type: "UC Request" }))].filter(item => item.status === "Submitted");
    return panel("approval", `<div class="card"><h2>Principal Approval</h2><p class="grant-note">${isPrincipal() ? "You can approve or return submitted records. Approval updates the balance and final documents automatically." : "Only Admin / Principal can approve or return these records."}</p><div class="grant-table-wrap"><table class="grant-table"><thead><tr><th>Type</th><th>Record</th><th>Scheme</th><th>Amount / Period</th><th>Submitted By</th><th>Action</th></tr></thead><tbody>${pending.map(item => `<tr><td>${item.type}</td><td>${esc(item.entryNo || item.id)}</td><td>${esc(schemeLabel(item.schemeId))}</td><td>${item.type === "UC Request" ? esc(item.financialYear) : money(item.amountReceived ?? item.amount)}</td><td>${esc(item.submittedBy || "-")}</td><td>${isPrincipal() ? `<button type="button" class="approve" data-action="approve" data-type="${item.type}" data-id="${item.id}">Approve</button> <button type="button" class="danger" data-action="return" data-type="${item.type}" data-id="${item.id}">Return</button>` : "Review only"}</td></tr>`).join("") || `<tr><td colspan="6">No records awaiting approval.</td></tr>`}</tbody></table></div></div><div class="card"><h2>Final UC Records</h2><div class="grant-table-wrap"><table class="grant-table"><thead><tr><th>Scheme</th><th>FY</th><th>Status</th><th>Approved By</th><th>Locked</th><th>Action</th></tr></thead><tbody>${state.ucRequests.slice().reverse().map(item => `<tr><td>${esc(schemeLabel(item.schemeId))}</td><td>${esc(item.financialYear)}</td><td>${statusBadge(item.status)}</td><td>${esc(item.approvedBy || "-")}</td><td>${item.locked ? "Yes" : "No"}</td><td>${isPrincipal() && item.status === "Approved" ? `<button type="button" data-action="lock-uc" data-id="${item.id}">${item.locked ? "Unlock for Correction" : "Lock Record"}</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6">No UC submitted.</td></tr>`}</tbody></table></div></div>`);
  }
  function auditPanel() { return panel("audit", `<div class="card"><h2>Grant Module Audit History</h2><div class="grant-table-wrap"><table class="grant-table"><thead><tr><th>Date & Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody>${state.audit.map(item => `<tr><td>${esc(new Date(item.time).toLocaleString("en-IN"))}</td><td>${esc(item.user)}</td><td>${esc(item.action)}</td><td>${esc(item.details)}</td></tr>`).join("") || `<tr><td colspan="4">No audit history recorded.</td></tr>`}</tbody></table></div></div>`); }

  function formData(schemeId, period = {}) {
    const scheme = schemeById(schemeId) || {};
    const matchesPeriod = item => (!period.from || item.expenseDate >= period.from) && (!period.to || item.expenseDate <= period.to);
    const receipts = approvedReceipts(schemeId);
    const expenses = approvedExpenses(schemeId).filter(matchesPeriod);
    const summary = schemeSummary(schemeId);
    const physical = summary.physical;
    const previous = state.previousUcs.filter(item => item.schemeId === schemeId).sort((first, second) => String(second.ucDate).localeCompare(String(first.ucDate)))[0] || {};
    const receiptRows = receipts.map((receipt, index) => ({ index: index + 1, receipt, utilized: expenses.flatMap(expense => expense.allocations || []).filter(allocation => allocation.receiptId === receipt.id).reduce((sum, allocation) => sum + number(allocation.amount), 0) }));
    const result = { scheme, receipts, expenses, summary, physical, previous, receiptRows };
    result.form24 = effectiveForm24(result, period.financialYear || financialYear(today()));
    return result;
  }
  function form23Html(data) {
    const rows = data.receiptRows.map(row => `<tr><td>${row.index}</td><td>${esc(row.receipt.financialYear)}</td><td>${esc(row.receipt.sanctionNo || "-")}<br>${esc(row.receipt.sanctionDate || "")}</td><td>${money(row.receipt.amountReceived)}</td><td>${money(row.utilized)}</td><td>${money(number(row.receipt.amountReceived) + number(row.receipt.interest) + number(row.receipt.otherReceipt) - row.utilized)}</td><td>${esc(row.receipt.remarks || "")}</td></tr>`).join("") || `<tr><td colspan="7">No approved grant receipt.</td></tr>`;
    return `<h2>FORM OGFR-23</h2><p style="text-align:center">[See Rule 306 (iii) (a)]</p><h3>Form of Utilization Certificate</h3><p><strong>Name of Department:</strong> ${esc(state.profile.institutionName || "-")}</p><table><thead><tr><th>Sl. No.</th><th>Financial Year</th><th>Sanction No. & Date</th><th>Amount Received</th><th>Amount Utilized against Grant</th><th>Unspent Balance</th><th>Remarks</th></tr></thead><tbody>${rows}<tr><th colspan="3">Total</th><th>${money(data.summary.grant)}</th><th>${money(data.summary.utilized)}</th><th>${money(data.summary.balance)}</th><th></th></tr></tbody></table><p><strong>Utilization Status:</strong> ${esc(data.summary.status)}. ${data.summary.balance > 0 ? `Unspent balance of <strong>${money(data.summary.balance)}</strong> remains subject to applicable sanction conditions.` : "Closing unspent balance is Nil."}</p>`;
  }
  function form24Html(data) {
    const form24 = data.form24;
    return `<h2>FORM OGFR-24</h2><p style="text-align:center">[See Rule 306 (iii) (b)]</p><h3>Proforma for Reporting Physical Target / Achievement made as per Utilization Certificate against the Grants-in-Aid received</h3><table><thead><tr><th>Name of the Grantee Organisation</th><th>Name of the Scheme and the Sector</th><th>Financial Target Fixed</th><th>Amount of Grant-in-Aid received (Year wise)</th><th>Physical Target Fixed</th><th>Amount Utilized (Year wise)</th><th>The amount for which U.C. furnished previously</th><th>Physical Target achieved against the U.C. already furnished</th><th>Physical Target achieved as per present U.C.</th><th>Remarks</th></tr><tr><th>(1)</th><th>(2)</th><th>(3)</th><th>(4)</th><th>(5)</th><th>(6)</th><th>(7)</th><th>(8)</th><th>(9)</th><th>(10)</th></tr></thead><tbody><tr><td>${esc(state.profile.institutionName || "-")}</td><td>${esc(data.scheme.name || "-")}<br>${esc(data.scheme.sector || "")}</td><td>${money(data.physical.financialTarget || 0)}</td><td>${yearLines(receiptYears)}</td><td>${esc(targetDescription)}<br>${targetQuantity}</td><td>${yearLines(utilizationYears)}</td><td>${previousAmount}</td><td>${previousAchievement}</td><td>${esc(achievementDescription)}</td><td>${esc(remarks)}</td></tr></tbody></table><p><em>Reasons for non-utilisation and shortfall in achieving the target in proportion to grant utilized are explained in the Remarks column.</em></p>`;
    return `<h2>FORM OGFR-24</h2><p style="text-align:center">[See Rule 306 (iii) (b)]</p><h3>Proforma for Reporting Physical Target / Achievement made as per Utilization Certificate against the Grants-in-Aid received</h3><table><thead><tr><th>Name of the Grantee Organisation</th><th>Name of the Scheme and the Sector</th><th>Financial Target Fixed</th><th>Amount of Grant-in-Aid received (Year wise)</th><th>Physical Target Fixed</th><th>Amount Utilized (Year wise)</th><th>The amount for which U.C. furnished previously</th><th>Physical Target achieved against the U.C. already furnished</th><th>Physical Target achieved as per present U.C.</th><th>Remarks</th></tr><tr><th>(1)</th><th>(2)</th><th>(3)</th><th>(4)</th><th>(5)</th><th>(6)</th><th>(7)</th><th>(8)</th><th>(9)</th><th>(10)</th></tr></thead><tbody><tr><td>${esc(form24.granteeOrganisation || "-")}</td><td>${esc(form24.schemeSector || "-")}</td><td>${money(form24.financialTarget)}</td><td>${form24YearLines(form24.grantYears)}</td><td>${esc(form24.physicalTarget || "-")}</td><td>${form24YearLines(form24.utilizationYears)}</td><td>${esc(form24.previousUcAmount || "Nil")}</td><td>${esc(form24.previousAchievement || "Nil")}</td><td>${esc(form24.presentAchievement || "-")}</td><td>${esc(form24.remarks || "-")}</td></tr></tbody></table><p><em>Reasons for non-utilisation and shortfall in achieving the target in proportion to grant utilized are explained in the Remarks column.</em></p>`;
  }
  function ucHtml(data) {
    const availableWords = amountWords(data.summary.available);
    const utilizedWords = amountWords(data.summary.utilized);
    const textBlock = data.summary.status === "Fully Utilized"
      ? `Certified that out of the total Grant-in-Aid available amounting to ${money(data.summary.available)} (${esc(availableWords)}), an amount of ${money(data.summary.utilized)} has been utilized for ${esc(data.scheme.purpose || data.scheme.name || "the sanctioned purpose")} in accordance with the terms and conditions of the sanction. The closing unspent balance is Nil.`
      : data.summary.status === "Partially Utilized"
        ? `Certified that out of the total Grant-in-Aid available amounting to ${money(data.summary.available)}, an amount of ${money(data.summary.utilized)} (${esc(utilizedWords)}) has been utilized for ${esc(data.scheme.purpose || data.scheme.name || "the sanctioned purpose")}. The unspent balance of ${money(data.summary.balance)} remains unutilized/carried forward, subject to the applicable sanction conditions.`
        : `Certified that the Grant-in-Aid amounting to ${money(data.summary.available)} has not been utilized during the reporting period. The entire amount remains unspent.`;
    return `<h2>UTILIZATION CERTIFICATE</h2><p>${textBlock}</p><p><strong>Scheme:</strong> ${esc(data.scheme.name || "-")}<br><strong>Financial target:</strong> ${money(data.physical.financialTarget || 0)}<br><strong>Physical target:</strong> ${esc(data.physical.targetDescription || "-")}<br><strong>Physical achievement:</strong> ${esc(data.physical.achievementDescription || "-")}</p><p>Certified that the conditions of the grant have been complied with and approved expenditure has been verified from bills, vouchers and supporting records.</p><div class="signature">Signature: ____________________<br>${esc(state.profile.principalName || "Principal")}<br>${esc(state.profile.principalDesignation || "Principal")}<br>Date: ${esc(state.profile.ucDate || today())}</div>`;
  }
  function refreshForms() {
    const schemeId = selectedFormScheme();
    const period = { from: document.getElementById("gf-from")?.value, to: document.getElementById("gf-to")?.value, financialYear: selectedFormFinancialYear() };
    const data = formData(schemeId, period);
    const summary = document.getElementById("gf-summary");
    if (!summary) return;
    summary.innerHTML = `<div class="grant-stats"><div class="grant-stat"><span>Total Grant Received</span><strong>${money(data.summary.grant)}</strong></div><div class="grant-stat"><span>Approved Expenditure</span><strong>${money(data.summary.utilized)}</strong></div><div class="grant-stat"><span>Available Funds</span><strong>${money(data.summary.available)}</strong></div><div class="grant-stat"><span>Closing Balance</span><strong>${money(data.summary.balance)}</strong></div><div class="grant-stat"><span>Utilization Status</span><strong>${esc(data.summary.status)}</strong></div></div>`;
    document.getElementById("gf-form23").innerHTML = form23Html(data);
    document.getElementById("gf-form24").innerHTML = form24Html(data);
    document.getElementById("gf-uc").innerHTML = ucHtml(data);
  }
  function saveForm24() {
    const schemeId = selectedFormScheme();
    const financialYear = selectedFormFinancialYear();
    if (!schemeId) throw new Error("Select a scheme before saving Form-24.");
    const grantYears = collectForm24Years("f24-grant-years");
    const utilizationYears = collectForm24Years("f24-utilization-years");
    if (grantYears.some(row => !/^\d{4}-\d{2}$/.test(row.year)) || utilizationYears.some(row => !/^\d{4}-\d{2}$/.test(row.year))) throw new Error("Enter every Form-24 financial year as YYYY-YY, for example 2025-26.");
    state.form24[form24Key(schemeId, financialYear)] = {
      financialYear,
      granteeOrganisation: text(document.getElementById("f24-grantee").value),
      schemeSector: text(document.getElementById("f24-scheme-sector").value),
      financialTarget: number(document.getElementById("f24-financial-target").value),
      grantYears,
      physicalTarget: text(document.getElementById("f24-physical-target").value),
      utilizationYears,
      previousUcAmount: text(document.getElementById("f24-previous-amount").value) || "Nil",
      previousAchievement: text(document.getElementById("f24-previous-achievement").value) || "Nil",
      presentAchievement: text(document.getElementById("f24-present-achievement").value),
      remarks: text(document.getElementById("f24-remarks").value)
    };
    log("Editable Form-24 saved", `${schemeLabel(schemeId)} Form-24 for ${financialYear} updated.`, schemeId);
    saveState(); refreshForms();
  }
  function resetForm24() {
    const schemeId = selectedFormScheme();
    const financialYear = selectedFormFinancialYear();
    delete state.form24[form24Key(schemeId, financialYear)];
    log("Form-24 restored", `${schemeLabel(schemeId)} Form-24 restored from approved records.`, schemeId);
    saveState(); refreshForm24Editor(); refreshForms();
  }
  function readFields(ids) { return Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, text(document.getElementById(id)?.value)])); }
  async function filesFrom(inputId) {
    const files = [...(document.getElementById(inputId)?.files || [])];
    for (const file of files) if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} exceeds the 2 MB browser storage limit.`);
    return Promise.all(files.map(file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, type: file.type, size: file.size, data: reader.result }); reader.onerror = () => reject(new Error(`Could not read ${file.name}.`)); reader.readAsDataURL(file); })));
  }
  async function saveReceipt(status) {
    const values = readFields({ schemeId: "gr-scheme", financialYear: "gr-fy", sanctionNo: "gr-sanction-no", sanctionDate: "gr-sanction-date", receiptDate: "gr-date", purpose: "gr-purpose", remarks: "gr-remarks" });
    const amountSanctioned = number(document.getElementById("gr-sanctioned").value);
    const amountReceived = number(document.getElementById("gr-received").value);
    if (!values.schemeId || amountReceived < 0 || amountSanctioned < 0) throw new Error("Select a scheme and enter non-negative receipt amounts.");
    if (state.ucRequests.some(item => item.schemeId === values.schemeId && item.locked)) throw new Error("This scheme has a locked final UC. Ask the Principal to unlock it before changing financial records.");
    if (!values.sanctionNo || !values.sanctionDate) alert("Sanction order number or date is blank. The receipt will be saved with a warning.");
    const duplicate = state.receipts.find(item => item.id !== editingReceiptId && values.sanctionNo && item.sanctionNo.toLowerCase() === values.sanctionNo.toLowerCase());
    if (duplicate && !confirm(`Sanction order ${values.sanctionNo} already exists. Save anyway?`)) return;
    const existing = state.receipts.find(item => item.id === editingReceiptId);
    const record = { ...existing, ...values, id: existing?.id || uid("REC"), entryNo: existing?.entryNo || `REC-${new Date().getFullYear()}-${String(state.receipts.length + 1).padStart(4, "0")}`, amountSanctioned, amountReceived, interest: number(document.getElementById("gr-interest").value), otherReceipt: number(document.getElementById("gr-other").value), openingBalance: number(document.getElementById("gr-opening").value), status, attachments: (await filesFrom("gr-file")).length ? await filesFrom("gr-file") : (existing?.attachments || []), updatedAt: new Date().toISOString(), enteredBy: existing?.enteredBy || actor(), submittedBy: status === "Submitted" ? actor() : existing?.submittedBy || "", submittedAt: status === "Submitted" ? new Date().toISOString() : existing?.submittedAt || "" };
    if (existing) Object.assign(existing, record); else state.receipts.push(record);
    log(existing ? "Grant receipt updated" : "Grant receipt created", `${record.entryNo} saved as ${status}.`, record.id);
    editingReceiptId = ""; saveState(); render();
  }
  function collectAllocations() { return [...document.querySelectorAll("#ge-allocations .grant-allocation-row")].map(row => ({ receiptId: row.querySelector("[data-allocation-receipt]")?.value || "", amount: number(row.querySelector("[data-allocation-amount]")?.value) })); }
  function validateExpense(showOnly = false) {
    const amount = number(document.getElementById("ge-amount")?.value);
    const allocations = collectAllocations();
    const total = allocations.reduce((sum, item) => sum + item.amount, 0);
    const errors = [];
    if (amount <= 0) errors.push("Amount utilized must be greater than zero.");
    if (!allocations.length || allocations.some(item => !item.receiptId || item.amount <= 0)) errors.push("Add a valid grant receipt and amount for every allocation.");
    if (Math.abs(total - amount) > 0.005) errors.push(`Allocated total ${money(total)} must equal expenditure amount ${money(amount)}.`);
    allocations.forEach(allocation => { if (allocation.amount > receiptAvailable(allocation.receiptId, editingExpenseId) + 0.005) errors.push(`Allocation exceeds available balance for ${receiptById(allocation.receiptId)?.entryNo || "the selected receipt"}.`); });
    const note = document.getElementById("ge-balance-note");
    if (note) { note.textContent = errors.length ? errors.join(" ") : `Allocation verified. ${money(amount)} will be booked against approved grant receipts.`; note.className = `grant-note ${errors.length ? "grant-warning" : ""}`; }
    if (!showOnly && errors.length) throw new Error(errors[0]);
    return allocations;
  }
  async function saveExpense(status) {
    const values = readFields({ expenseDate: "ge-date", financialYear: "ge-fy", schemeId: "ge-scheme", head: "ge-head", description: "ge-description", billNo: "ge-bill", billDate: "ge-bill-date", voucherNo: "ge-voucher", voucherDate: "ge-voucher-date", vendor: "ge-vendor", paymentMode: "ge-payment", reference: "ge-reference", location: "ge-location", stockPage: "ge-stock-page", assetPage: "ge-asset-page", remarks: "ge-remarks", unit: "ge-unit" });
    const amount = number(document.getElementById("ge-amount").value);
    if (!values.expenseDate || !values.schemeId) throw new Error("Expenditure date and scheme are mandatory.");
    if (state.ucRequests.some(item => item.schemeId === values.schemeId && item.locked)) throw new Error("This scheme has a locked final UC. Ask the Principal to unlock it before changing financial records.");
    if (values.financialYear !== financialYear(values.expenseDate) && !confirm(`The selected financial year differs from ${financialYear(values.expenseDate)}. Save with this exception?`)) return;
    const duplicateBill = state.expenses.find(item => item.id !== editingExpenseId && values.billNo && item.billNo.toLowerCase() === values.billNo.toLowerCase());
    const duplicateVoucher = state.expenses.find(item => item.id !== editingExpenseId && values.voucherNo && item.voucherNo.toLowerCase() === values.voucherNo.toLowerCase());
    if ((duplicateBill || duplicateVoucher) && !confirm("Duplicate bill or voucher number found. Save anyway?")) return;
    const allocations = validateExpense();
    if (allocations.some(item => receiptById(item.receiptId)?.schemeId !== values.schemeId)) throw new Error("Every allocated receipt must belong to the selected scheme.");
    const existing = state.expenses.find(item => item.id === editingExpenseId);
    const newFiles = await filesFrom("ge-files");
    const record = { ...existing, ...values, id: existing?.id || uid("EXP"), entryNo: existing?.entryNo || `EXP-${new Date().getFullYear()}-${String(state.expenses.length + 1).padStart(4, "0")}`, amount, quantity: number(document.getElementById("ge-quantity").value), allocations, status, attachments: newFiles.length ? newFiles : (existing?.attachments || []), enteredBy: existing?.enteredBy || actor(), submittedBy: status === "Submitted" ? actor() : existing?.submittedBy || "", submittedAt: status === "Submitted" ? new Date().toISOString() : existing?.submittedAt || "", updatedAt: new Date().toISOString() };
    if (existing) Object.assign(existing, record); else state.expenses.push(record);
    log(existing ? "Expenditure updated" : "Expenditure created", `${record.entryNo} saved as ${status}.`, record.id);
    editingExpenseId = ""; saveState(); render();
  }
  function savePhysical() {
    const schemeId = document.getElementById("gp-scheme").value;
    if (!schemeId) throw new Error("Select a scheme.");
    const value = { financialTarget: number(document.getElementById("gp-financial").value), targetDescription: text(document.getElementById("gp-description").value), targetQuantity: number(document.getElementById("gp-target-quantity").value), targetUnit: text(document.getElementById("gp-target-unit").value), achievementQuantity: number(document.getElementById("gp-achievement-quantity").value), achievementUnit: text(document.getElementById("gp-achievement-unit").value), completionStatus: document.getElementById("gp-status").value, achievementDescription: text(document.getElementById("gp-achievement-description").value), shortfallReason: text(document.getElementById("gp-shortfall").value), remarks: text(document.getElementById("gp-remarks").value) };
    if (value.targetQuantity && value.achievementQuantity < value.targetQuantity && !value.shortfallReason) throw new Error("Shortfall reason is mandatory when achievement is less than target.");
    state.physical[schemeId] = value; log("Physical target saved", `${schemeLabel(schemeId)} target and achievement updated.`, schemeId); saveState(); render();
  }
  function loadPhysical() {
    const value = state.physical[document.getElementById("gp-scheme").value] || {};
    const map = { "gp-financial": value.financialTarget, "gp-description": value.targetDescription, "gp-target-quantity": value.targetQuantity, "gp-target-unit": value.targetUnit, "gp-achievement-quantity": value.achievementQuantity, "gp-achievement-unit": value.achievementUnit, "gp-status": value.completionStatus || "Not Started", "gp-achievement-description": value.achievementDescription, "gp-shortfall": value.shortfallReason, "gp-remarks": value.remarks };
    Object.entries(map).forEach(([id, entry]) => { document.getElementById(id).value = entry ?? ""; });
  }
  async function savePrevious() {
    const schemeId = document.getElementById("gu-scheme").value;
    if (!schemeId) throw new Error("Select a scheme.");
    const noPrevious = document.getElementById("gu-none").checked;
    const attachments = await filesFrom("gu-file");
    state.previousUcs.push({ id: uid("PUC"), schemeId, ucNo: text(document.getElementById("gu-number").value), ucDate: document.getElementById("gu-date").value, financialYear: text(document.getElementById("gu-fy").value), amount: number(document.getElementById("gu-amount").value), achievement: text(document.getElementById("gu-achievement").value), remarks: text(document.getElementById("gu-remarks").value), noPrevious, attachments, enteredBy: actor() });
    log("Previous UC saved", `${schemeLabel(schemeId)} previous UC detail saved.`, schemeId); saveState(); render();
  }
  function submitUc() {
    const schemeId = selectedFormScheme();
    if (!schemeId) throw new Error("Select a scheme before submitting the UC.");
    const financialYear = text(document.getElementById("gf-fy").value);
    const existing = state.ucRequests.find(item => item.schemeId === schemeId && item.financialYear === financialYear && item.status !== "Returned");
    if (existing) throw new Error("A UC for this scheme and financial year is already submitted or approved.");
    state.ucRequests.push({ id: uid("UC"), schemeId, financialYear, from: document.getElementById("gf-from").value, to: document.getElementById("gf-to").value, status: "Submitted", submittedBy: actor(), submittedAt: new Date().toISOString(), locked: false });
    log("Draft UC submitted", `${schemeLabel(schemeId)} UC for ${financialYear} submitted to Principal.`, schemeId); saveState(); activeTab = "approval"; render();
  }
  function approveOrReturn(type, id, approved) {
    if (!isPrincipal()) throw new Error("Only Admin / Principal can approve or return records.");
    const collection = type === "Receipt" ? state.receipts : type === "Expenditure" ? state.expenses : state.ucRequests;
    const item = collection.find(record => record.id === id);
    if (!item) return;
    const remarks = approved ? "" : prompt("Return remarks for Account In-Charge:") || "Correction required.";
    if (type === "Expenditure" && approved) {
      const exceedsBalance = (item.allocations || []).some(allocation => allocation.amount > receiptAvailable(allocation.receiptId, item.id) + 0.005);
      if (exceedsBalance) throw new Error("Approval blocked: allocated amount exceeds the current approved receipt balance.");
    }
    item.status = approved ? "Approved" : "Returned";
    item.approvedBy = approved ? actor() : ""; item.approvedAt = approved ? new Date().toISOString() : ""; item.principalRemarks = remarks;
    log(approved ? `${type} approved` : `${type} returned`, `${item.entryNo || item.id}: ${remarks || "Approved"}.`, id); saveState(); render();
  }
  function toggleLock(id) {
    if (!isPrincipal()) throw new Error("Only Admin / Principal can lock or unlock records.");
    const item = state.ucRequests.find(record => record.id === id); if (!item) return;
    item.locked = !item.locked; item.status = item.locked ? "Locked" : "Approved"; item.lockedBy = actor(); item.lockedAt = new Date().toISOString();
    log(item.locked ? "UC record locked" : "UC record unlocked", `${schemeLabel(item.schemeId)} ${item.financialYear}.`, id); saveState(); render();
  }
  function exportRegister() {
    const rows = [["Entry Number", "Expenditure Date", "Financial Year", "Scheme", "Grant Source", "Bill Number", "Voucher Number", "Vendor", "Description", "Amount", "Status", "Entered By", "Submitted Date", "Approved By", "Approved Date"]].concat(state.expenses.map(item => [item.entryNo, item.expenseDate, item.financialYear, schemeLabel(item.schemeId), (item.allocations || []).map(allocation => receiptById(allocation.receiptId)?.entryNo || "").join("; "), item.billNo, item.voucherNo, item.vendor, item.description, item.amount, item.status, item.enteredBy, item.submittedAt, item.approvedBy, item.approvedAt]));
    if (window.XLSX) { const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Daily Expenditure Register"); XLSX.writeFile(workbook, "Daily_Expenditure_Register.xlsx"); return; }
    const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\n"); downloadBlob(new Blob([csv], { type: "text/csv" }), "Daily_Expenditure_Register.csv");
  }
  function amountWords(value) { const amount = Math.floor(number(value)); if (!amount) return "Zero Rupees Only"; const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"]; const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]; const underThousand = numberValue => { const chunks = []; if (numberValue >= 100) { chunks.push(`${ones[Math.floor(numberValue / 100)]} Hundred`); numberValue %= 100; } if (numberValue >= 20) { chunks.push(tens[Math.floor(numberValue / 10)]); numberValue %= 10; } if (numberValue) chunks.push(ones[numberValue]); return chunks.join(" "); }; const parts = []; let remaining = amount; [[10000000, "Crore"], [100000, "Lakh"], [1000, "Thousand"]].forEach(([unit, name]) => { if (remaining >= unit) { parts.push(`${underThousand(Math.floor(remaining / unit))} ${name}`); remaining %= unit; } }); if (remaining) parts.push(underThousand(remaining)); return `${parts.join(" ")} Rupees Only`; }
  function downloadBlob(blob, fileName) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function xml(value) { return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]); }
  function wordParagraph(value, center = false, bold = false, color = "000000", size = "24") { const title = center && bold; const fontColor = title && color === "000000" ? "1F4E79" : color; const fontSize = title && size === "24" ? "28" : size; return `<w:p><w:pPr>${center ? "<w:jc w:val=\"center\"/>" : ""}</w:pPr><w:r><w:rPr>${bold ? "<w:b/>" : ""}<w:color w:val="${fontColor}"/><w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/></w:rPr><w:t xml:space="preserve">${xml(value)}</w:t></w:r></w:p>`; }
  function wordTable(headers, rows) { const cell = (value, header = false) => `<w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/>${header ? "<w:shd w:val=\"clear\" w:fill=\"D9EAF7\"/>" : ""}</w:tcPr>${wordParagraph(value, false, header, header ? "1F4E79" : "000000", header ? "24" : "24")}</w:tc>`; return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid>${headers.map(() => "<w:gridCol w:w=\"1400\"/>").join("")}</w:tblGrid><w:tr>${headers.map(value => cell(value, true)).join("")}</w:tr>${rows.map(row => `<w:tr>${row.map(value => cell(value)).join("")}</w:tr>`).join("")}</w:tbl>`; }
  function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let index = 0; index < 8; index += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
  function zipStore(files) { const encoder = new TextEncoder(); const chunks = []; const entries = []; let offset = 0; const push16 = (array, value) => array.push(value & 255, (value >>> 8) & 255); const push32 = (array, value) => array.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); files.forEach(file => { const name = encoder.encode(file.name); const data = typeof file.data === "string" ? encoder.encode(file.data) : file.data; const crc = crc32(data); const header = []; push32(header, 0x04034b50); push16(header, 20); push16(header, 0); push16(header, 0); push16(header, 0); push16(header, 0); push32(header, crc); push32(header, data.length); push32(header, data.length); push16(header, name.length); push16(header, 0); chunks.push(new Uint8Array(header), name, data); entries.push({ name, crc, size: data.length, offset }); offset += header.length + name.length + data.length; }); const centralOffset = offset; entries.forEach(entry => { const header = []; push32(header, 0x02014b50); push16(header, 20); push16(header, 20); push16(header, 0); push16(header, 0); push16(header, 0); push16(header, 0); push32(header, entry.crc); push32(header, entry.size); push32(header, entry.size); push16(header, entry.name.length); push16(header, 0); push16(header, 0); push16(header, 0); push16(header, 0); push32(header, 0); push32(header, entry.offset); chunks.push(new Uint8Array(header), entry.name); offset += header.length + entry.name.length; }); const end = []; push32(end, 0x06054b50); push16(end, 0); push16(end, 0); push16(end, entries.length); push16(end, entries.length); push32(end, offset - centralOffset); push32(end, centralOffset); push16(end, 0); chunks.push(new Uint8Array(end)); return new Blob(chunks, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }); }
  function downloadDocx(kind) { const schemeId = selectedFormScheme(); const period = { from: document.getElementById("gf-from")?.value, to: document.getElementById("gf-to")?.value }; const data = formData(schemeId, period); if (!schemeId) throw new Error("Select a scheme first."); const form23Rows = data.receiptRows.map(row => [row.index, row.receipt.financialYear, `${row.receipt.sanctionNo || "-"} ${row.receipt.sanctionDate || ""}`, money(row.receipt.amountReceived), money(row.utilized), money(number(row.receipt.amountReceived) + number(row.receipt.interest) + number(row.receipt.otherReceipt) - row.utilized), row.receipt.remarks || ""]); const form24Rows = [[state.profile.institutionName, `${data.scheme.name || ""} ${data.scheme.sector || ""}`, money(data.physical.financialTarget), groupedByYear(data.receipts, "receiptDate", "amountReceived").map(([year, amount]) => `${year}: ${money(amount)}`).join("\n"), data.physical.targetDescription || "-", groupedByYear(data.expenses, "expenseDate", "amount").map(([year, amount]) => `${year}: ${money(amount)}`).join("\n"), data.previous.noPrevious ? "Nil" : money(data.previous.amount), data.previous.noPrevious ? "Nil" : data.previous.achievement || "-", data.physical.achievementDescription || "-", data.summary.balance ? `Unspent balance of ${money(data.summary.balance)} remains.` : "Nil"]]; let documentBody = ""; if (kind === "form23" || kind === "uc") documentBody += wordParagraph("FORM OGFR-23", true, true) + wordParagraph("[See Rule 306 (iii) (a)]", true) + wordParagraph("Form of Utilization Certificate", true, true) + wordParagraph(`Name of Department: ${state.profile.institutionName}`) + wordTable(["Sl. No.", "Financial Year", "Sanction No. & Date", "Amount Received", "Amount Utilized", "Unspent Balance", "Remarks"], form23Rows); if (kind === "form24" || kind === "uc") documentBody += wordParagraph("FORM OGFR-24", true, true) + wordParagraph("[See Rule 306 (iii) (b)]", true) + wordParagraph("Proforma for Reporting Physical Target / Achievement made as per Utilization Certificate against the Grants-in-Aid received", true, true) + wordTable(["Grantee", "Scheme & Sector", "Financial Target", "Grant received year wise", "Physical Target", "Amount utilized year wise", "Previous UC amount", "Previous achievement", "Present achievement", "Remarks"], form24Rows); if (kind === "uc") documentBody += wordParagraph("UTILIZATION CERTIFICATE", true, true) + wordParagraph(`${data.summary.status}: Total available ${money(data.summary.available)}. Total approved expenditure ${money(data.summary.utilized)}. Closing balance ${money(data.summary.balance)}.`) + wordParagraph(`Certified for ${data.scheme.purpose || data.scheme.name || "the sanctioned purpose"}.`) + wordParagraph(`Principal: ${state.profile.principalName || "Principal"}`); const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${documentBody}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`; const blob = zipStore([{ name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` }, { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` }, { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` }, { name: "word/styles.xml", data: `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>` }, { name: "docProps/core.xml", data: `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>OGFR Forms and Utilization Certificate</dc:title><dc:creator>OAV BADI ERP</dc:creator></cp:coreProperties>` }, { name: "docProps/app.xml", data: `<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OAV BADI ERP</Application></Properties>` }, { name: "word/document.xml", data: documentXml }]); const safe = (data.scheme.name || "Scheme").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, ""); const prefix = kind === "form23" ? "OGFR_Form_23" : kind === "form24" ? "OGFR_Form_24" : "UC"; downloadBlob(blob, `${prefix}_${state.profile.institutionCode || "OAVB"}_${safe}_${document.getElementById("gf-fy")?.value || "FY"}.docx`); }
  function printPdf() { const schemeId = selectedFormScheme(); const data = formData(schemeId, { from: document.getElementById("gf-from")?.value, to: document.getElementById("gf-to")?.value }); if (!schemeId) throw new Error("Select a scheme first."); const popup = window.open("", "_blank"); if (!popup) throw new Error("Allow pop-ups to print or save as PDF."); popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>OGFR Forms and UC</title><style>@page{size:A4 portrait;margin:12mm}body{font-family:Arial,sans-serif;color:#000;font-size:10pt}.page{break-after:page}.page:last-child{break-after:auto}table{border-collapse:collapse;width:100%;font-size:7.6pt}th,td{border:1px solid #000;padding:4px;vertical-align:top}h2,h3{text-align:center}p{line-height:1.35}.signature{width:230px;margin:35px 0 0 auto;text-align:center}</style></head><body><section class="page">${form23Html(data)}</section><section class="page">${form24Html(data)}</section><section class="page">${ucHtml(data)}</section><script>window.onload=()=>setTimeout(()=>window.print(),150);<\/script></body></html>`); popup.document.close(); }
  function bindEvents(root) {
    root.querySelectorAll("[data-grant-tab]").forEach(button => button.addEventListener("click", () => { activeTab = button.dataset.grantTab; render(); if (activeTab === "forms") refreshForms(); }));
    root.addEventListener("click", async event => { const button = event.target.closest("[data-action]"); if (!button) return; try { const action = button.dataset.action; if (action === "save-profile") { state.profile = { institutionName: text(document.getElementById("gm-institution").value), institutionCode: text(document.getElementById("gm-institution-code").value), address: text(document.getElementById("gm-address").value), district: text(document.getElementById("gm-district").value), block: text(document.getElementById("gm-block").value), state: text(document.getElementById("gm-state").value), ddoCode: text(document.getElementById("gm-ddo").value), treasuryCode: text(document.getElementById("gm-treasury").value), principalName: text(document.getElementById("gm-principal").value), principalDesignation: "Principal", accountName: text(document.getElementById("gm-account").value), place: text(document.getElementById("gm-place").value), ucDate: document.getElementById("gm-uc-date").value }; log("Institution details saved", "Institution profile updated."); saveState(); render(); } else if (action === "add-scheme") { const name = text(document.getElementById("gm-scheme-name").value); if (!name) throw new Error("Scheme name is mandatory."); if (state.schemes.some(item => item.name.toLowerCase() === name.toLowerCase())) throw new Error("This scheme already exists."); state.schemes.push({ id: uid("SCH"), name, sector: text(document.getElementById("gm-scheme-sector").value), purpose: text(document.getElementById("gm-scheme-purpose").value), createdBy: actor() }); log("Scheme created", name); saveState(); render(); } else if (action === "delete-scheme") { const id = button.dataset.id; if (state.receipts.some(item => item.schemeId === id) || state.expenses.some(item => item.schemeId === id)) throw new Error("A scheme with receipt or expenditure history cannot be deleted."); state.schemes = state.schemes.filter(item => item.id !== id); delete state.physical[id]; log("Scheme deleted", "Unused scheme deleted.", id); saveState(); render(); } else if (action === "save-receipt") await saveReceipt(button.dataset.status); else if (action === "edit-receipt") { editingReceiptId = button.dataset.id; activeTab = "receipts"; render(); } else if (action === "cancel-receipt-edit") { editingReceiptId = ""; render(); } else if (action === "add-allocation") { document.getElementById("ge-allocations").insertAdjacentHTML("beforeend", allocationRows([{ receiptId: "", amount: 0 }])); } else if (action === "remove-allocation") { button.closest(".grant-allocation-row").remove(); } else if (action === "check-allocation") validateExpense(true); else if (action === "save-expense") await saveExpense(button.dataset.status); else if (action === "edit-expense") { editingExpenseId = button.dataset.id; activeTab = "expenses"; render(); } else if (action === "cancel-expense-edit") { editingExpenseId = ""; render(); } else if (action === "export-register") exportRegister(); else if (action === "save-physical") savePhysical(); else if (action === "load-physical") loadPhysical(); else if (action === "save-previous") await savePrevious(); else if (action === "refresh-forms") refreshForms(); else if (action === "submit-uc") submitUc(); else if (action === "approve") approveOrReturn(button.dataset.type, button.dataset.id, true); else if (action === "return") approveOrReturn(button.dataset.type, button.dataset.id, false); else if (action === "lock-uc") toggleLock(button.dataset.id); else if (action === "download-docx") downloadDocx(button.dataset.kind); else if (action === "print-pdf") printPdf(); } catch (error) { alert(error.message || "The requested action could not be completed."); } });
    root.addEventListener("click", event => {
      const button = event.target.closest("[data-action]");
      if (!button || !["add-form24-year", "remove-form24-year", "save-form24", "reset-form24"].includes(button.dataset.action)) return;
      try {
        if (button.dataset.action === "add-form24-year") {
          const container = document.getElementById(button.dataset.group === "grant" ? "f24-grant-years" : "f24-utilization-years");
          container.insertAdjacentHTML("beforeend", form24YearEditorRows([{ year: "", amount: 0 }]));
        } else if (button.dataset.action === "remove-form24-year") {
          button.closest("[data-form24-year-row]").remove();
        } else if (button.dataset.action === "save-form24") {
          saveForm24();
        } else {
          resetForm24();
        }
      } catch (error) {
        alert(error.message || "Form-24 could not be saved.");
      }
    });
    root.addEventListener("click", event => {
      const button = event.target.closest("[data-action='add-scheme']");
      if (!button) return;
      const schemeName = document.getElementById("gm-scheme-name");
      if (schemeName && !text(schemeName.value)) schemeName.value = `Untitled Scheme ${state.schemes.length + 1}`;
    }, true);
    document.getElementById("ge-date")?.addEventListener("change", event => { document.getElementById("ge-fy").value = financialYear(event.target.value); });
    document.getElementById("gp-scheme")?.addEventListener("change", loadPhysical);
    const reportingYear = document.getElementById("gf-fy");
    if (reportingYear) {
      reportingYear.value = activeFinancialYear();
      reportingYear.closest("label")?.insertAdjacentHTML("beforeend", "<small class=\"grant-note\">Active session: changing this value saves it for future Form-24 and UC work.</small>");
      reportingYear.addEventListener("change", () => {
        const value = text(reportingYear.value);
        if (!/^\d{4}-\d{2}$/.test(value)) {
          alert("Enter the session as YYYY-YY, for example 2025-26.");
          reportingYear.value = activeFinancialYear();
          return;
        }
        state.activeFinancialYear = value;
        log("Active financial session changed", `Active reporting session set to ${value}.`);
        saveState();
        refreshForm24Editor();
        refreshForms();
      });
    }
    document.getElementById("gf-scheme")?.addEventListener("change", () => { refreshForm24Editor(); refreshForms(); });
    if (activeTab === "forms") { refreshForm24Editor(); refreshForms(); }
  }
  mount();
})();
