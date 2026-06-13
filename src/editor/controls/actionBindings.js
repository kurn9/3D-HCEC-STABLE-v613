/* =========================
   ACTION BUTTONS
========================= */

dom.btnAddWall.addEventListener("click", addItemAtWall);
dom.btnDuplicate.addEventListener("click", duplicateSelected);
dom.btnDelete.addEventListener("click", deleteSelected);
dom.btnPlace.addEventListener("click", placeSelectedOnWall);
dom.btnApply.addEventListener("click", applyForm);
dom.btnFocus.addEventListener("click", focusSelectedApprox);
dom.btnDraft.addEventListener("click", saveDraft);
dom.btnExport.addEventListener("click", exportJson);

dom.btnValidate.addEventListener("click", validateCurrentScene);
dom.btnImport.addEventListener("click", requestImportJson);
dom.importFile.addEventListener("change", handleImportFile);
dom.btnPreviewPopup.addEventListener("click", openPreviewPopup);
dom.previewCloseBtn.addEventListener("click", closePreviewPopup);
dom.previewOverlay.addEventListener("click", (event) => {
  if (event.target === dom.previewOverlay) closePreviewPopup();
});

dom.btnRestoreBackup.addEventListener("click", restoreSelectedBackup);
dom.btnClearBackups.addEventListener("click", clearEditorBackups);

dom.search.addEventListener("input", renderList);
dom.groupFilter.addEventListener("change", renderList);
dom.advancedFilter.addEventListener("change", renderList);

dom.btnLeft.addEventListener("click", () => nudgeSelected("left"));
dom.btnRight.addEventListener("click", () => nudgeSelected("right"));
dom.btnUp.addEventListener("click", () => nudgeSelected("up"));
dom.btnDown.addEventListener("click", () => nudgeSelected("down"));
dom.btnForward.addEventListener("click", () => nudgeSelected("forward"));
dom.btnBack.addEventListener("click", () => nudgeSelected("back"));
dom.btnBigger.addEventListener("click", () => resizeSelected(1));
dom.btnSmaller.addEventListener("click", () => resizeSelected(-1));
dom.btnRotateLeft90.addEventListener("click", () => rotateSelected90(1));
