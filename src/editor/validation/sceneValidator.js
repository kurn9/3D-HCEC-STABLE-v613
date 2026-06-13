/* =========================
   SCENE.JSON VALIDATOR
   Editor V2 - chỉ kiểm tra, không tự sửa dữ liệu.
========================= */

const SCENE_REQUIRED_FIELDS = ["id", "title", "image", "group"];
const SCENE_OPTIONAL_CONTENT_FIELDS = ["author", "content", "realSize"];
const SCENE_BOOLEAN_FIELDS = ["frame", "transparent", "clickable"];
const SCENE_EXPORT_FIELDS = [
  "id",
  "title",
  "author",
  "year",
  "material",
  "realSize",
  "description",
  "content",
  "note",
  "image",
  "position",
  "rotation",
  "size",
  "group",
  "frame",
  "transparent",
  "clickable"
];

function classifySceneItem(item) {
  const id = String(item?.id || "").trim();
  const title = String(item?.title || "").trim();
  const upperId = id.toUpperCase();
  const upperTitle = title.toUpperCase();

  const isDraftRange = /^ART_0?(44|45|46|47|48)$/.test(upperId);
  const isCopyTitle = title.toLowerCase().includes("copy");
  if (isDraftRange || isCopyTitle) return "draft/test";

  const isDecorationByName = ["LOGO", "NEON", "TITLE", "DECOR", "BANNER"].some((key) =>
    upperId.includes(key) || upperTitle.includes(key)
  );

  const isDecorationByFlags = item?.frame === false && item?.transparent === true && item?.clickable === false;
  if (isDecorationByName || isDecorationByFlags) return "decoration";

  return "artwork";
}

function validateSceneData(sceneData) {
  const report = {
    valid: true,
    errors: [],
    warnings: [],
    stats: {
      total: Array.isArray(sceneData) ? sceneData.length : 0,
      artwork: 0,
      decoration: 0,
      draftTest: 0,
      clickableFalse: 0,
      transparentTrue: 0,
      duplicateIds: 0,
      missingAuthor: 0,
      missingContent: 0,
      missingRealSize: 0
    },
    items: []
  };

  if (!Array.isArray(sceneData)) {
    report.valid = false;
    report.errors.push({ id: "ROOT", message: "scene.json phải là một mảng JSON." });
    return report;
  }

  const seenIds = new Map();

  sceneData.forEach((item, index) => {
    const id = String(item?.id || `INDEX_${index}`).trim();
    const type = classifySceneItem(item);
    const itemErrors = [];
    const itemWarnings = [];

    if (type === "artwork") report.stats.artwork += 1;
    if (type === "decoration") report.stats.decoration += 1;
    if (type === "draft/test") report.stats.draftTest += 1;

    if (item?.clickable === false) report.stats.clickableFalse += 1;
    if (item?.transparent === true) report.stats.transparentTrue += 1;

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      itemErrors.push("Object không hợp lệ.");
    } else {
      SCENE_REQUIRED_FIELDS.forEach((field) => {
        if (item[field] === undefined || item[field] === null || String(item[field]).trim() === "") {
          itemErrors.push(`Thiếu field bắt buộc: ${field}`);
        }
      });

      if (item.id !== undefined) {
        const normalizedId = String(item.id).trim();
        if (seenIds.has(normalizedId)) {
          itemErrors.push(`Trùng id với object ở dòng/thứ tự ${seenIds.get(normalizedId) + 1}: ${normalizedId}`);
          report.stats.duplicateIds += 1;
        } else {
          seenIds.set(normalizedId, index);
        }
      }

      if (!isNumberArray(item.position, 3)) {
        itemErrors.push("position phải là mảng 3 số.");
      }

      if (!isNumberArray(item.rotation, 3)) {
        itemErrors.push("rotation phải là mảng 3 số.");
      }

      if (!isNumberArray(item.size, 2)) {
        itemErrors.push("size phải là mảng 2 số.");
      }

      SCENE_BOOLEAN_FIELDS.forEach((field) => {
        if (item[field] === undefined) {
          itemWarnings.push(`Thiếu ${field}; editor sẽ dùng giá trị mặc định khi normalize.`);
        } else if (typeof item[field] !== "boolean") {
          itemErrors.push(`${field} phải là boolean true/false.`);
        }
      });

      SCENE_OPTIONAL_CONTENT_FIELDS.forEach((field) => {
        if (item[field] === undefined || item[field] === null || String(item[field]).trim() === "") {
          itemWarnings.push(`Thiếu nội dung: ${field}`);
          if (field === "author") report.stats.missingAuthor += 1;
          if (field === "content") report.stats.missingContent += 1;
          if (field === "realSize") report.stats.missingRealSize += 1;
        }
      });

      if (type === "draft/test") {
        itemWarnings.push("Object draft/test cần rà soát trước khi đưa vào dữ liệu chính thức.");
      }

      if (type === "decoration" && item.clickable !== false) {
        itemWarnings.push("Object trang trí nên để clickable=false nếu không muốn mở popup trong viewer.");
      }
    }

    itemErrors.forEach((message) => report.errors.push({ id, index, message }));
    itemWarnings.forEach((message) => report.warnings.push({ id, index, message }));

    report.items.push({ id, index, type, errors: itemErrors, warnings: itemWarnings });
  });

  report.valid = report.errors.length === 0;
  return report;
}

function showValidationReport(report) {
  if (!dom.validationPanel) return;
  dom.validationPanel.innerHTML = formatValidationReport(report);
}

function validateCurrentScene() {
  const report = validateSceneData(data);
  showValidationReport(report);

  const label = report.valid ? "hợp lệ" : "có lỗi";
  setStatus(`
    ${report.valid ? "✅" : "❌"} <strong>Scene JSON ${label}</strong><br>
    Object: ${report.stats.total} · Lỗi: ${report.errors.length} · Cảnh báo: ${report.warnings.length}
  `);

  return report;
}

function formatValidationReport(report) {
  const icon = report.valid ? "✅" : "❌";
  const title = report.valid ? "JSON hợp lệ để export/import" : "JSON có lỗi cần sửa";
  const maxErrors = 8;
  const maxWarnings = 8;

  const errorsHtml = report.errors.slice(0, maxErrors).map((entry) =>
    `<li><b>${validatorEscapeHtml(entry.id)}</b>: ${validatorEscapeHtml(entry.message)}</li>`
  ).join("");

  const warningsHtml = report.warnings.slice(0, maxWarnings).map((entry) =>
    `<li><b>${validatorEscapeHtml(entry.id)}</b>: ${validatorEscapeHtml(entry.message)}</li>`
  ).join("");

  return `
    <div class="validation-title ${report.valid ? "ok-text" : "danger-text"}">${icon} ${title}</div>
    <div class="validation-stats">
      Tổng: <b>${report.stats.total}</b> · Artwork: <b>${report.stats.artwork}</b> · Decoration: <b>${report.stats.decoration}</b> · Draft/test: <b>${report.stats.draftTest}</b><br>
      clickable=false: <b>${report.stats.clickableFalse}</b> · transparent=true: <b>${report.stats.transparentTrue}</b><br>
      Thiếu author: <b>${report.stats.missingAuthor}</b> · thiếu content: <b>${report.stats.missingContent}</b> · thiếu realSize: <b>${report.stats.missingRealSize}</b>
    </div>
    ${report.errors.length ? `<div class="validation-block"><b>Lỗi (${report.errors.length})</b><ul>${errorsHtml}</ul>${report.errors.length > maxErrors ? `<div class="note">Còn ${report.errors.length - maxErrors} lỗi khác.</div>` : ""}</div>` : ""}
    ${report.warnings.length ? `<div class="validation-block"><b>Cảnh báo (${report.warnings.length})</b><ul>${warningsHtml}</ul>${report.warnings.length > maxWarnings ? `<div class="note">Còn ${report.warnings.length - maxWarnings} cảnh báo khác.</div>` : ""}</div>` : ""}
  `;
}

function isNumberArray(value, expectedLength) {
  return Array.isArray(value) &&
    value.length === expectedLength &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
}

function validatorEscapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
