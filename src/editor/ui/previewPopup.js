/* =========================
   POPUP PREVIEW
   Preview dữ liệu popup mà không đụng viewer.
========================= */

function openPreviewPopup() {
  const item = getItem(selectedId);
  if (!item) {
    alert("Hãy chọn một object trước khi xem popup thử.");
    return;
  }

  dom.previewImage.src = item.image || "";
  dom.previewImage.alt = item.title || item.id || "Preview tác phẩm";
  dom.previewBadge.textContent = item.clickable === false ? "Preview object trang trí" : "Preview popup viewer";
  dom.previewTitle.textContent = item.title || item.id || "Tên tác phẩm";
  dom.previewDescription.textContent = item.description || "";
  dom.previewAuthor.textContent = displayValue(item.author);
  dom.previewYear.textContent = displayValue(item.year);
  dom.previewMaterial.textContent = displayValue(item.material);
  dom.previewRealSize.textContent = displayValue(item.realSize);
  dom.previewContent.textContent = item.content || "Thông tin thuyết minh đang được cập nhật.";

  dom.previewOverlay.classList.remove("hidden");
}

function closePreviewPopup() {
  dom.previewOverlay.classList.add("hidden");
}

function displayValue(value) {
  const text = String(value ?? "").trim();
  return text || "—";
}
