/* =========================
   LOCAL BACKUP MANAGER
   Backup trước import/export, không ghi đè file thật.
========================= */

const BACKUP_STORAGE_KEY = "gallery_walk_cms_backups_v2";
const MAX_BACKUPS = 10;

function createEditorBackup(reason, sourceData) {
  const snapshot = cloneSceneForBackup(sourceData || getCurrentSceneForBackup());
  const backups = getEditorBackups();
  const entry = {
    id: `backup_${Date.now()}`,
    reason: reason || "manual",
    createdAt: new Date().toISOString(),
    count: snapshot.length,
    data: snapshot
  };

  backups.unshift(entry);
  localStorage.setItem(BACKUP_STORAGE_KEY, JSON.stringify(backups.slice(0, MAX_BACKUPS)));
  renderBackupList();
  return entry;
}

function getEditorBackups() {
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Không đọc được backup CMS:", error);
    return [];
  }
}

function renderBackupList() {
  if (!dom.backupSelect) return;

  const backups = getEditorBackups();
  if (backups.length === 0) {
    dom.backupSelect.innerHTML = '<option value="">Chưa có backup</option>';
    return;
  }

  dom.backupSelect.innerHTML = backups.map((entry) => {
    const date = new Date(entry.createdAt);
    const label = `${formatBackupDate(date)} · ${entry.reason || "backup"} · ${entry.count || 0} object`;
    return `<option value="${backupEscapeHtml(entry.id)}">${backupEscapeHtml(label)}</option>`;
  }).join("");
}

function restoreSelectedBackup() {
  const id = dom.backupSelect?.value;
  if (!id) {
    alert("Chưa có backup để restore.");
    return;
  }

  const backups = getEditorBackups();
  const entry = backups.find((item) => item.id === id);
  if (!entry) {
    alert("Không tìm thấy backup đã chọn.");
    renderBackupList();
    return;
  }

  const report = validateSceneData(entry.data);
  showValidationReport(report);
  if (!report.valid) {
    setStatus(`❌ <strong>Backup không hợp lệ</strong><br>Lỗi: ${report.errors.length}. Không restore.`);
    return;
  }

  if (!confirm(`Restore backup ${formatBackupDate(new Date(entry.createdAt))}? Dữ liệu đang mở sẽ bị thay bằng backup này.`)) {
    return;
  }

  createEditorBackup("before_restore", data);
  data = entry.data.map(normalizeItem);
  selectedId = data[0]?.id || null;
  buildAllItems();
  renderGroupFilter();
  renderList();
  if (selectedId) selectItem(selectedId);
  markDirty("restore_backup");
  showValidationReport(validateSceneData(data));

  setStatus(`
    ✅ <strong>Đã restore backup</strong><br>
    Dữ liệu đang mở đã đổi sang bản backup. Hãy kiểm tra rồi export scene.json nếu muốn dùng chính thức.
  `);
}

function clearEditorBackups() {
  if (!confirm("Xóa toàn bộ backup localStorage của editor?")) return;
  localStorage.removeItem(BACKUP_STORAGE_KEY);
  renderBackupList();
  setStatus("✅ <strong>Đã xóa backup localStorage</strong>");
}

function markDirty(reason = "changed") {
  isDirty = true;
  updateDirtyBadge(reason);
}

function clearDirty() {
  isDirty = false;
  updateDirtyBadge("");
}

function updateDirtyBadge() {
  if (!dom.dirtyBadge) return;
  dom.dirtyBadge.classList.toggle("hidden", !isDirty);
}

window.addEventListener("beforeunload", (event) => {
  if (!isDirty) return;
  event.preventDefault();
  event.returnValue = "";
});

function getCurrentSceneForBackup() {
  if (typeof cleanData === "function") return cleanData();
  return Array.isArray(data) ? data : [];
}

function cloneSceneForBackup(sceneData) {
  return JSON.parse(JSON.stringify(sceneData || []));
}

function formatBackupDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "Không rõ thời gian";
  return date.toLocaleString("vi-VN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function backupEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
