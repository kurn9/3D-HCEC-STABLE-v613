function renderGroupFilter() {
  const current = dom.groupFilter.value;
  const groupSet = new Set(data.map((item) => item.group || "").filter(Boolean));
  const options = ['<option value="">Tất cả nhóm</option>'];

  [...groupSet].sort().forEach((group) => {
    options.push(`<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`);
  });

  dom.groupFilter.innerHTML = options.join("");
  dom.groupFilter.value = current;
}

function renderList() {
  const keyword = dom.search.value.trim().toLowerCase();
  const group = dom.groupFilter.value;
  const advanced = dom.advancedFilter?.value || "all";

  const filtered = data.filter((item) => {
    const text = [
      item.id,
      item.title,
      item.group,
      item.image,
      item.author,
      item.year,
      item.material,
      item.realSize,
      item.description,
      item.content,
      item.note
    ].join(" ").toLowerCase();

    return text.includes(keyword) &&
      (!group || item.group === group) &&
      matchAdvancedFilter(item, advanced);
  });

  dom.list.innerHTML = filtered.map((item) => {
    const active = item.id === selectedId ? "active" : "";
    const type = classifySceneItem(item);
    const flags = [];
    if (item.clickable === false) flags.push("no-click");
    if (item.transparent === true) flags.push("transparent");
    if (type === "draft/test") flags.push("draft/test");
    if (!String(item.author || "").trim()) flags.push("thiếu author");
    if (!String(item.content || "").trim()) flags.push("thiếu content");

    const author = item.author ? ` · ${escapeHtml(item.author)}` : "";
    const badge = `<span class="item-badge ${type.replace("/", "-")}">${escapeHtml(type)}</span>`;

    return `
      <div class="item ${active}" data-id="${escapeHtml(item.id)}">
        <div class="item-title">${escapeHtml(item.id)} · ${escapeHtml(item.title || "")}</div>
        <div class="item-meta">${escapeHtml(item.group || "")}${author}</div>
        <div class="item-tags">${badge}${flags.map((flag) => `<span>${escapeHtml(flag)}</span>`).join("")}</div>
      </div>
    `;
  }).join("");

  dom.list.querySelectorAll(".item").forEach((el) => {
    el.addEventListener("click", () => selectItem(el.dataset.id));
  });
}

function matchAdvancedFilter(item, advanced) {
  const type = classifySceneItem(item);

  if (advanced === "missing-author") return !String(item.author || "").trim();
  if (advanced === "missing-content") return !String(item.content || "").trim();
  if (advanced === "draft-test") return type === "draft/test";
  if (advanced === "decoration") return type === "decoration";
  if (advanced === "clickable-false") return item.clickable === false;
  if (advanced === "transparent-true") return item.transparent === true;

  return true;
}

function selectItem(id) {
  const item = getItem(id);
  if (!item) return;

  selectedId = id;

  highlightSelected();
  syncForm();
  renderList();

  setStatus(`
    ✅ <strong>Đã chọn object</strong><br>
    ${escapeHtml(item.id)} · ${escapeHtml(item.title || "")}<br>
    Loại: ${escapeHtml(classifySceneItem(item))} · ESC để sửa ở panel trái.
  `);
}

function syncForm() {
  const item = getItem(selectedId);

  if (!item) {
    dom.selectedTitle.textContent = "Chưa chọn tranh";
    return;
  }

  dom.selectedTitle.textContent = `${item.id} · ${item.title || ""}`;

  dom.fId.value = item.id || "";
  dom.fTitle.value = item.title || "";
  dom.fImage.value = item.image || "";
  dom.fDesc.value = item.description || "";
  dom.fGroup.value = item.group || "";

  dom.fAuthor.value = item.author || "";
  dom.fYear.value = item.year || "";
  dom.fMaterial.value = item.material || "";
  dom.fRealSize.value = item.realSize || "";
  dom.fContent.value = item.content || "";
  dom.fNote.value = item.note || "";

  dom.fX.value = item.position[0];
  dom.fY.value = item.position[1];
  dom.fZ.value = item.position[2];

  dom.fRX.value = item.rotation[0];
  dom.fRY.value = item.rotation[1];
  dom.fRZ.value = item.rotation[2];

  dom.fW.value = item.size[0];
  dom.fH.value = item.size[1];

  dom.fFrame.checked = item.frame !== false;
  dom.fTransparent.checked = Boolean(item.transparent);
  dom.fClickable.checked = item.clickable !== false;
}

function applyForm() {
  const item = getItem(selectedId);
  if (!item) return;

  const oldId = item.id;
  const newId = dom.fId.value.trim() || oldId;

  if (newId !== oldId && getItem(newId)) {
    alert("ID này đã tồn tại. Hãy đổi ID khác.");
    dom.fId.value = oldId;
    return;
  }

  item.id = newId;
  item.title = dom.fTitle.value.trim();
  item.image = dom.fImage.value.trim();
  item.description = dom.fDesc.value.trim();
  item.group = dom.fGroup.value.trim();

  item.author = dom.fAuthor.value.trim();
  item.year = dom.fYear.value.trim();
  item.material = dom.fMaterial.value.trim();
  item.realSize = dom.fRealSize.value.trim();
  item.content = dom.fContent.value.trim();
  item.note = dom.fNote.value.trim();

  item.position = [num(dom.fX.value), num(dom.fY.value), num(dom.fZ.value)];
  item.rotation = [num(dom.fRX.value), num(dom.fRY.value), num(dom.fRZ.value)];

  item.size = [
    Math.max(0.05, num(dom.fW.value)),
    Math.max(0.05, num(dom.fH.value))
  ];

  item.frame = Boolean(dom.fFrame.checked);
  item.transparent = Boolean(dom.fTransparent.checked);
  item.clickable = Boolean(dom.fClickable.checked);

  if (newId !== oldId) {
    const group = itemGroups.get(oldId);
    itemGroups.delete(oldId);
    selectedId = newId;

    if (group) {
      itemGroups.set(newId, group);
      group.name = newId;
      group.userData.id = newId;
      group.traverse((obj) => {
        if (obj.userData && obj.userData.id === oldId) {
          obj.userData.id = newId;
        }
      });
    }
  }

  rebuildItem(newId);
  renderGroupFilter();
  renderList();
  selectItem(newId);
  markDirty("apply_form");
  showValidationReport(validateSceneData(data));

  setStatus(`
    ✅ <strong>Đã cập nhật object</strong><br>
    ${escapeHtml(item.id)} · ${escapeHtml(item.title || "")}
  `);
}
