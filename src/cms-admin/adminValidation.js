const SITE_SETTINGS_ALLOWED_LANGUAGES = ['vi'];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^[0-9\s+\-.()]+$/;

export function validateSiteSettingsDraft(values = {}, copy = {}) {
  const labels = copy.fields || {};
  const errors = {};
  const warnings = {};
  const normalized = normalizeSiteSettingsValues(values);

  if (!normalized.site_title) {
    errors.site_title = copy.errors?.siteTitleRequired || 'Tên website không được để trống.';
  }

  if (!normalized.organization_name) {
    errors.organization_name = copy.errors?.organizationRequired || 'Đơn vị quản lý không được để trống.';
  }

  if (normalized.email && !EMAIL_PATTERN.test(normalized.email)) {
    errors.email = copy.errors?.emailInvalid || 'Thư điện tử không đúng định dạng.';
  }

  if (!SITE_SETTINGS_ALLOWED_LANGUAGES.includes(normalized.default_language)) {
    errors.default_language = copy.errors?.languageInvalid || 'Ngôn ngữ mặc định không hợp lệ.';
  }

  ['phone', 'fax'].forEach((fieldName) => {
    const value = normalized[fieldName];
    if (value && !PHONE_PATTERN.test(value)) {
      const fieldLabel = labels[fieldName] || fieldName;
      warnings[fieldName] = `${fieldLabel} có ký tự chưa quen thuộc. Vẫn có thể lưu nếu đây là dữ liệu đúng.`;
    }
  });

  if (normalized.address && normalized.address.length < 5) {
    warnings.address = copy.warnings?.addressShort || 'Địa chỉ đang khá ngắn. Vui lòng kiểm tra lại trước khi công khai.';
  }

  if (normalized.site_title.length > 120) {
    warnings.site_title = copy.warnings?.siteTitleLong || 'Tên website khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
  }

  if (normalized.organization_name.length > 180) {
    warnings.organization_name = copy.warnings?.organizationLong || 'Tên đơn vị quản lý khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
  }

  return {
    values: normalized,
    errors,
    warnings,
    valid: Object.keys(errors).length === 0,
  };
}

export function normalizeSiteSettingsValues(values = {}) {
  return {
    site_title: normalizeText(values.site_title),
    organization_name: normalizeText(values.organization_name),
    address: normalizeText(values.address),
    phone: normalizeText(values.phone),
    fax: normalizeText(values.fax),
    email: normalizeText(values.email),
    default_language: normalizeText(values.default_language) || 'vi',
  };
}


export function validateIndexSectionDraft(values = {}, copy = {}) {
  const errors = {};
  const warnings = {};
  const normalized = normalizeIndexSectionValues(values);

  if (normalized.section_key !== 'hero') {
    errors.section_key = copy.errors?.sectionInvalid || 'Chỉ chỉnh sửa Khu vực đầu trang ở bước này.';
  }

  if (!normalized.title) {
    errors.title = copy.errors?.titleRequired || 'Tiêu đề Khu vực đầu trang không được để trống.';
  }

  if (values.originalMediaJson !== undefined && !isPlainObject(normalized.media_json)) {
    errors.media_json = copy.errors?.mediaInvalid || 'Dữ liệu ảnh/video giới thiệu không hợp lệ.';
  }

  if (!Array.isArray(normalized.items_json)) {
    errors.items_json = copy.errors?.itemsInvalid || 'Dữ liệu nội dung con không hợp lệ.';
  }

  const originalItems = normalizeHomeHeroItemsJson(values.originalItemsJson);
  if (Array.isArray(originalItems) && originalItems.length !== normalized.items_json.length) {
    errors.items_json = copy.errors?.itemsCountChanged || 'Không thể thêm, xóa hoặc sắp xếp lại mục con ở bước này.';
  }

  if (normalized.title.length > 120) {
    warnings.title = copy.warnings?.titleLong || 'Tiêu đề khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
  }
  if (normalized.lead.length > 300) {
    warnings.lead = copy.warnings?.leadLong || 'Mô tả ngắn khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
  }
  if (normalized.body.length > 800) {
    warnings.body = copy.warnings?.bodyLong || 'Nội dung mô tả khá dài. Nên kiểm tra lại trước khi công khai.';
  }
  if (!normalizeText(normalized.mediaDraft?.caption)) {
    warnings['media.caption'] = copy.warnings?.mediaCaptionEmpty || 'Chú thích media đang trống. Nên kiểm tra lại trước khi công khai.';
  }
  if (normalizeText(normalized.mediaDraft?.caption).length > 180) {
    warnings['media.caption'] = copy.warnings?.mediaCaptionLong || 'Chú thích media khá dài. Nên rút gọn trước khi công khai.';
  }

  safeArray(normalized.itemDrafts).forEach((item, index) => {
    const titleValue = normalizeText(item.kind === 'string' ? item.text : item.title);
    const descriptionValue = normalizeText(item.description);
    if (titleValue.length > 120) {
      warnings[`items.${index}.title`] = copy.warnings?.itemTitleLong || 'Nội dung mục khá dài. Nên kiểm tra lại cách hiển thị.';
    }
    if (descriptionValue.length > 250) {
      warnings[`items.${index}.description`] = copy.warnings?.itemDescriptionLong || 'Mô tả mục khá dài. Nên kiểm tra lại cách hiển thị.';
    }
  });

  if (normalizeText(normalized.ctaDraft?.label).length > 80) {
    warnings['cta.label'] = copy.warnings?.ctaLabelLong || 'Nhãn nút khá dài. Nên rút gọn trước khi công khai.';
  }

  return {
    values: {
      eyebrow: normalized.eyebrow,
      title: normalized.title,
      subtitle: normalized.subtitle,
      lead: normalized.lead,
      body: normalized.body,
      media_json: normalized.media_json,
      items_json: normalized.items_json,
      cta_json: normalized.cta_json,
    },
    errors,
    warnings,
    valid: Object.keys(errors).length === 0,
  };
}

export function normalizeIndexSectionValues(values = {}) {
  const originalMediaJson = normalizeHomeHeroMediaJson(values.originalMediaJson);
  const originalItemsJson = normalizeHomeHeroItemsJson(values.originalItemsJson);
  const originalCtaJson = normalizeHomeHeroCtaJson(values.originalCtaJson);
  const mediaDraft = normalizeHomeHeroMediaDraft(values.media);
  const itemDrafts = normalizeHomeHeroItemDrafts(values.items);
  const ctaDraft = normalizeHomeHeroCtaDraft(values.cta);

  return {
    section_key: normalizeText(values.section_key),
    eyebrow: normalizeText(values.eyebrow),
    title: normalizeText(values.title),
    subtitle: normalizeText(values.subtitle),
    lead: normalizeText(values.lead),
    body: normalizeText(values.body),
    mediaDraft,
    itemDrafts,
    ctaDraft,
    media_json: patchHomeMediaTextFields(originalMediaJson, mediaDraft),
    items_json: patchHomeItemsTextFields(originalItemsJson, itemDrafts),
    cta_json: patchHomeCtaTextFields(originalCtaJson, ctaDraft),
  };
}

export function normalizeHomeHeroMediaJson(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isPlainObject(value) ? cloneJsonSafe(value) : {};
}

export function normalizeHomeHeroItemsJson(value) {
  if (!value) return [];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? cloneJsonSafe(value) : [];
}

function normalizeHomeHeroCtaJson(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return isPlainObject(value) ? cloneJsonSafe(value) : {};
}

function normalizeHomeHeroMediaDraft(media = {}) {
  return { caption: normalizeText(media?.caption) };
}

function normalizeHomeHeroItemDrafts(items = []) {
  return safeArray(items).map((item) => ({
    kind: item?.kind === 'string' ? 'string' : 'object',
    text: normalizeText(item?.text),
    title: normalizeText(item?.title),
    description: normalizeText(item?.description),
  }));
}

function normalizeHomeHeroCtaDraft(cta = {}) {
  return {
    label: normalizeText(cta?.label),
    editable: Boolean(cta?.editable),
  };
}

export function patchHomeMediaTextFields(originalMediaJson = {}, draftMedia = {}) {
  const mediaJson = normalizeHomeHeroMediaJson(originalMediaJson);
  patchEquivalentTextKeys(mediaJson, ['caption', 'alt', 'title', 'label'], draftMedia.caption, 'caption');
  return mediaJson;
}

export function patchHomeItemsTextFields(originalItemsJson = [], draftItems = []) {
  const itemsJson = normalizeHomeHeroItemsJson(originalItemsJson);
  return itemsJson.map((originalItem, index) => {
    const draftItem = normalizeHomeHeroItemDrafts(draftItems)[index] || {};
    if (typeof originalItem === 'string') {
      return normalizeText(draftItem.text);
    }
    if (!isPlainObject(originalItem)) {
      return cloneJsonSafe(originalItem);
    }
    const patchedItem = cloneJsonSafe(originalItem);
    patchEquivalentTextKeys(patchedItem, ['title', 'label', 'name', 'heading', 'text'], draftItem.title, 'title');
    patchEquivalentTextKeys(patchedItem, ['description', 'lead', 'body', 'note'], draftItem.description, 'description');
    return patchedItem;
  });
}

export function patchHomeCtaTextFields(originalCtaJson = {}, draftCta = {}) {
  const ctaJson = normalizeHomeHeroCtaJson(originalCtaJson);
  if (!draftCta?.editable) return ctaJson;
  patchEquivalentTextKeys(ctaJson, ['label', 'text', 'title', 'name'], draftCta.label, 'label');
  return ctaJson;
}


export function validateHomeGuideSectionDraft(values = {}, copy = {}) {
  const errors = {};
  const warnings = {};
  const normalized = normalizeHomeGuideSectionValues(values);

  if (normalized.section_key !== 'guide') {
    errors.section_key = copy.errors?.sectionInvalid || 'Chỉ chỉnh sửa Hướng dẫn tham quan ở bước này.';
  }

  if (!normalized.title) {
    errors.title = copy.errors?.titleRequired || 'Tiêu đề Hướng dẫn tham quan không được để trống.';
  }

  if (!Array.isArray(normalized.items_json)) {
    errors.items_json = copy.errors?.itemsInvalid || 'Dữ liệu bước hướng dẫn không hợp lệ.';
  }

  const originalItems = normalizeHomeGuideItemsJson(values.originalItemsJson);
  if (Array.isArray(originalItems) && originalItems.length !== normalized.items_json.length) {
    errors.items_json = copy.errors?.itemsCountChanged || 'Không thể thêm, xóa hoặc sắp xếp lại bước hướng dẫn ở bước này.';
  }

  if (normalized.title.length > 120) {
    warnings.title = copy.warnings?.titleLong || 'Tiêu đề khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
  }
  if (normalized.lead.length > 300) {
    warnings.lead = copy.warnings?.leadLong || 'Mô tả ngắn khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
  }
  if (normalized.body.length > 800) {
    warnings.body = copy.warnings?.bodyLong || 'Nội dung mô tả khá dài. Nên kiểm tra lại trước khi công khai.';
  }

  if (!normalized.items_json.length) {
    warnings.items_json = copy.warnings?.itemsEmpty || 'Danh sách bước hướng dẫn đang trống.';
  }
  if (normalized.items_json.length > 0 && normalized.items_json.length < 2) {
    warnings.items_json = copy.warnings?.itemsShort || 'Hướng dẫn có ít hơn 2 bước. Nên kiểm tra lại trước khi công khai.';
  }

  safeArray(normalized.itemDrafts).forEach((item, index) => {
    const titleValue = normalizeText(item.kind === 'string' ? item.text : item.title);
    const descriptionValue = normalizeText(item.description);
    if (titleValue.length > 120) {
      warnings[`items.${index}.title`] = copy.warnings?.itemTitleLong || 'Tên bước khá dài. Nên kiểm tra lại cách hiển thị.';
    }
    if (descriptionValue.length > 250) {
      warnings[`items.${index}.description`] = copy.warnings?.itemDescriptionLong || 'Mô tả bước khá dài. Nên kiểm tra lại cách hiển thị.';
    }
    if (item.kind !== 'string' && !descriptionValue) {
      warnings[`items.${index}.description`] = copy.warnings?.itemDescriptionEmpty || 'Mô tả bước đang trống, nên kiểm tra trước khi công khai.';
    }
  });

  return {
    values: {
      eyebrow: normalized.eyebrow,
      title: normalized.title,
      subtitle: normalized.subtitle,
      lead: normalized.lead,
      body: normalized.body,
      items_json: normalized.items_json,
    },
    errors,
    warnings,
    valid: Object.keys(errors).length === 0,
  };
}

export function normalizeHomeGuideSectionValues(values = {}) {
  const originalItemsJson = normalizeHomeGuideItemsJson(values.originalItemsJson);
  const itemDrafts = normalizeHomeGuideItemDrafts(values.items);

  return {
    section_key: normalizeText(values.section_key),
    eyebrow: normalizeText(values.eyebrow),
    title: normalizeText(values.title),
    subtitle: normalizeText(values.subtitle),
    lead: normalizeText(values.lead),
    body: normalizeText(values.body),
    itemDrafts,
    items_json: patchHomeGuideItemsTextFields(originalItemsJson, itemDrafts),
  };
}

export function normalizeHomeGuideItemsJson(value) {
  return normalizeHomeHeroItemsJson(value);
}

function normalizeHomeGuideItemDrafts(items = []) {
  return safeArray(items).map((item) => ({
    kind: item?.kind === 'string' ? 'string' : 'object',
    text: normalizeText(item?.text),
    title: normalizeText(item?.title),
    description: normalizeText(item?.description),
  }));
}

export function patchHomeGuideItemsTextFields(originalItemsJson = [], draftItems = []) {
  const itemsJson = normalizeHomeGuideItemsJson(originalItemsJson);
  const normalizedDraftItems = normalizeHomeGuideItemDrafts(draftItems);
  return itemsJson.map((originalItem, index) => {
    const draftItem = normalizedDraftItems[index] || {};
    if (typeof originalItem === 'string') {
      return normalizeText(draftItem.text);
    }
    if (!isPlainObject(originalItem)) {
      return cloneJsonSafe(originalItem);
    }
    const patchedItem = cloneJsonSafe(originalItem);
    patchEquivalentTextKeys(patchedItem, ['title', 'label', 'name', 'heading', 'text'], draftItem.title, 'title');
    patchEquivalentTextKeys(patchedItem, ['description', 'lead', 'body', 'note'], draftItem.description, 'description');
    return patchedItem;
  });
}

export function validateHomeExperienceSectionDraft(values = {}, copy = {}) {
  const errors = {};
  const warnings = {};
  const normalized = normalizeHomeExperienceSectionValues(values);

  if (normalized.section_key !== 'experience') {
    errors.section_key = copy.errors?.sectionInvalid || 'Chỉ chỉnh sửa Khu vực trải nghiệm ở bước này.';
  }

  if (!normalized.title) {
    errors.title = copy.errors?.titleRequired || 'Tiêu đề Khu vực trải nghiệm không được để trống.';
  }

  if (!Array.isArray(normalized.items_json)) {
    errors.items_json = copy.errors?.itemsInvalid || 'Dữ liệu card trải nghiệm không hợp lệ.';
  }

  const originalItems = normalizeHomeExperienceItemsJson(values.originalItemsJson);
  if (Array.isArray(originalItems) && originalItems.length !== normalized.items_json.length) {
    errors.items_json = copy.errors?.itemsCountChanged || 'Không thể thêm, xóa hoặc sắp xếp lại card trải nghiệm ở bước này.';
  }

  const protectedValidation = validateExperienceProtectedFields(originalItems, normalized.items_json, copy);
  Object.assign(errors, protectedValidation.errors);

  if (normalized.title.length > 120) {
    warnings.title = copy.warnings?.titleLong || 'Tiêu đề khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
  }
  if (normalized.lead.length > 300) {
    warnings.lead = copy.warnings?.leadLong || 'Mô tả ngắn khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
  }
  if (normalized.body.length > 800) {
    warnings.body = copy.warnings?.bodyLong || 'Nội dung mô tả khá dài. Nên kiểm tra lại trước khi công khai.';
  }

  if (normalized.items_json.length > 0 && normalized.items_json.length < 2) {
    warnings.items_json = copy.warnings?.itemsShort || 'Khu vực trải nghiệm có ít hơn 2 card. Nên kiểm tra lại trước khi công khai.';
  }

  safeArray(normalized.itemDrafts).forEach((item, index) => {
    const titleValue = normalizeText(item.kind === 'string' ? item.text : item.title);
    const descriptionValue = normalizeText(item.description);
    if (titleValue.length > 120) {
      warnings[`items.${index}.title`] = copy.warnings?.itemTitleLong || 'Tên card khá dài. Nên kiểm tra lại cách hiển thị.';
    }
    if (descriptionValue.length > 250) {
      warnings[`items.${index}.description`] = copy.warnings?.itemDescriptionLong || 'Mô tả card khá dài. Nên kiểm tra lại cách hiển thị.';
    }
    if (item.kind !== 'string' && !descriptionValue) {
      warnings[`items.${index}.description`] = copy.warnings?.itemDescriptionEmpty || 'Mô tả card đang trống, nên kiểm tra trước khi công khai.';
    }
  });

  return {
    values: {
      eyebrow: normalized.eyebrow,
      title: normalized.title,
      subtitle: normalized.subtitle,
      lead: normalized.lead,
      body: normalized.body,
      items_json: normalized.items_json,
    },
    errors,
    warnings,
    valid: Object.keys(errors).length === 0,
  };
}

export function normalizeHomeExperienceSectionValues(values = {}) {
  const originalItemsJson = normalizeHomeExperienceItemsJson(values.originalItemsJson);
  const itemDrafts = normalizeHomeExperienceItemDrafts(values.items);

  return {
    section_key: normalizeText(values.section_key),
    eyebrow: normalizeText(values.eyebrow),
    title: normalizeText(values.title),
    subtitle: normalizeText(values.subtitle),
    lead: normalizeText(values.lead),
    body: normalizeText(values.body),
    itemDrafts,
    items_json: patchHomeExperienceItemsTextFields(originalItemsJson, itemDrafts),
  };
}

export function normalizeHomeExperienceItemsJson(value) {
  return normalizeHomeHeroItemsJson(value);
}

function normalizeHomeExperienceItemDrafts(items = []) {
  return safeArray(items).map((item) => ({
    kind: item?.kind === 'string' ? 'string' : 'object',
    text: normalizeText(item?.text),
    title: normalizeText(item?.title),
    description: normalizeText(item?.description),
  }));
}

export function patchHomeExperienceItemsTextFields(originalItemsJson = [], draftItems = []) {
  const itemsJson = normalizeHomeExperienceItemsJson(originalItemsJson);
  const normalizedDraftItems = normalizeHomeExperienceItemDrafts(draftItems);
  return itemsJson.map((originalItem, index) => {
    const draftItem = normalizedDraftItems[index] || {};
    if (typeof originalItem === 'string') {
      return normalizeText(draftItem.text);
    }
    if (!isPlainObject(originalItem)) {
      return cloneJsonSafe(originalItem);
    }
    const patchedItem = cloneJsonSafe(originalItem);
    patchEquivalentTextKeys(patchedItem, ['title', 'label', 'name', 'heading', 'text'], draftItem.title, 'title');
    patchEquivalentTextKeys(patchedItem, ['description', 'lead', 'body', 'note'], draftItem.description, 'description');
    return patchedItem;
  });
}

function validateExperienceProtectedFields(originalItems = [], patchedItems = [], copy = {}) {
  const errors = {};
  if (!Array.isArray(originalItems) || !Array.isArray(patchedItems)) return { errors };
  const protectedKeys = ['room_key', 'room', 'ctaLabel', 'key', 'type', 'icon', 'href', 'url', 'link', 'path', 'to', 'route', 'query'];
  originalItems.forEach((originalItem, index) => {
    const patchedItem = patchedItems[index];
    if (!isPlainObject(originalItem) || !isPlainObject(patchedItem)) return;
    protectedKeys.forEach((key) => {
      const originalValue = JSON.stringify(originalItem[key] ?? null);
      const patchedValue = JSON.stringify(patchedItem[key] ?? null);
      if (originalValue !== patchedValue) {
        errors[`items.${index}.${key}`] = copy.errors?.protectedFieldChanged || 'Mã phòng, đường dẫn tham quan và nhãn nút vào phòng chỉ xem ở bước này.';
      }
    });
  });
  return { errors };
}


export function validateRoomDraft(values = {}, copy = {}) {
  const errors = {};
  const warnings = {};
  const normalized = normalizeRoomDraftValues(values);
  const roomId = normalizeText(values.roomId);
  const roomKey = normalizeText(values.roomKey);

  if (!roomId) {
    errors.id = copy.errors?.missingId || 'Không tìm thấy ID phòng trưng bày.';
  }

  if (!['indoor', 'outdoor'].includes(roomKey)) {
    errors.room_key = copy.errors?.invalidRoomKey || 'Mã phòng không nằm trong phạm vi chỉnh sửa an toàn.';
  }

  if (!normalized.name) {
    errors.name = copy.errors?.nameRequired || 'Tên phòng không được để trống.';
  }

  const forbiddenKeys = ['id', 'room_key', 'room_type', 'is_active', 'sort_order', 'route', 'query', 'scene', 'scene_json', 'artworks', 'artwork_mapping'];
  forbiddenKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      errors[key] = copy.errors?.protectedFieldChanged || 'Mã phòng, route, scene và liên kết tác phẩm chỉ xem ở bước này.';
    }
  });

  if (normalized.name.length > 120) {
    warnings.name = copy.warnings?.nameLong || 'Tên phòng hơi dài. Nên kiểm tra lại cách hiển thị.';
  }
  if (normalized.description.length > 500) {
    warnings.description = copy.warnings?.descriptionLong || 'Mô tả phòng hơi dài. Nên kiểm tra lại cách hiển thị.';
  }
  if (!normalized.description) {
    warnings.description = copy.warnings?.descriptionEmpty || 'Mô tả phòng đang trống.';
  }

  return {
    values: {
      name: normalized.name,
      description: normalized.description,
    },
    errors,
    warnings,
    valid: Object.keys(errors).length === 0,
  };
}

export function normalizeRoomDraftValues(values = {}) {
  return {
    name: normalizeText(values.name),
    description: normalizeText(values.description),
  };
}


export function validateArtworkTextDraft(values = {}, copy = {}) {
  const errors = {};
  const warnings = {};
  const normalized = normalizeArtworkTextDraftValues(values);
  const artworkId = normalizeText(values.artworkId);
  const artworkCode = normalizeText(values.artworkCode);

  if (!artworkId) {
    errors.id = copy.errors?.missingId || 'Không tìm thấy ID tác phẩm.';
  }

  if (!normalized.title) {
    errors.title = copy.errors?.titleRequired || 'Tên tác phẩm không được để trống.';
  }

  const forbiddenKeys = [
    'id',
    'room_key',
    'artwork_code',
    'type',
    'content',
    'note',
    'category',
    'tags',
    'image_url',
    'thumbnail_url',
    'video_url',
    'poster_url',
    'audio_url',
    'media_url',
    'media_path',
    'storage_path',
    'is_visible',
    'is_featured',
    'sort_order',
    'cms_warning',
    'scene',
    'scene_json',
    'marker',
    'position',
    'rotation',
    'size',
    'scale',
  ];
  forbiddenKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      errors[key] = copy.errors?.protectedFieldChanged || 'Trường kỹ thuật chỉ xem ở bước này.';
    }
  });

  if (normalized.title.length > 160) {
    warnings.title = copy.warnings?.titleLong || 'Tên tác phẩm hơi dài.';
  }
  if (normalized.subtitle.length > 200) {
    warnings.subtitle = copy.warnings?.subtitleLong || 'Phụ đề hơi dài.';
  }
  if (!normalized.artist) {
    warnings.artist = copy.warnings?.artistEmpty || 'Tác giả đang trống.';
  }
  if (normalized.year && !/^\d{4}([–\-\/ ]\d{4})?$/.test(normalized.year)) {
    warnings.year = copy.warnings?.yearUnusual || 'Năm/thời gian có định dạng chưa quen thuộc.';
  }
  if (normalized.material.length > 200) {
    warnings.material = copy.warnings?.materialLong || 'Chất liệu hơi dài.';
  }
  if (normalized.real_size.length > 120) {
    warnings.real_size = copy.warnings?.realSizeLong || 'Kích thước thật hơi dài.';
  }
  if (!normalized.description) {
    warnings.description = copy.warnings?.descriptionEmpty || 'Mô tả đang trống.';
  }
  if (normalized.description.length > 1000) {
    warnings.description = copy.warnings?.descriptionLong || 'Mô tả hơi dài.';
  }
  if (values.originalCmsWarning) {
    warnings.cms_warning = copy.warnings?.cmsWarning || 'Tác phẩm đang có cảnh báo CMS.';
  }
  if (values.originalHasMedia === false) {
    warnings.media = copy.warnings?.mediaMissing || 'Tác phẩm có thể thiếu media.';
  }

  return {
    values: {
      title: normalized.title,
      subtitle: normalized.subtitle,
      artist: normalized.artist,
      year: normalized.year,
      material: normalized.material,
      real_size: normalized.real_size,
      description: normalized.description,
    },
    errors,
    warnings,
    valid: Object.keys(errors).length === 0,
    artworkId,
    artworkCode,
  };
}

export function normalizeArtworkTextDraftValues(values = {}) {
  return {
    title: normalizeText(values.title),
    subtitle: normalizeText(values.subtitle),
    artist: normalizeText(values.artist),
    year: normalizeText(values.year),
    material: normalizeText(values.material),
    real_size: normalizeText(values.real_size),
    description: normalizeText(values.description),
  };
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function validateGateContentDraft(values = {}, copy = {}) {
  const errors = {};
  const warnings = {};
  const normalized = normalizeGateContentValues(values);

  if (!normalized.title) {
    errors.title = copy.errors?.titleRequired || 'Tiêu đề cổng vào không được để trống.';
  }

  if (!isPlainObject(normalized.originalRoomsJson)) {
    errors.rooms_json = copy.errors?.roomsInvalid || 'Dữ liệu lựa chọn không gian không hợp lệ.';
  }
  if (!isPlainObject(normalized.originalRoomsJson?.indoor)) {
    errors['rooms.indoor.displayName'] = copy.errors?.indoorMissing || 'Thiếu dữ liệu không gian trong nhà.';
  }
  if (!isPlainObject(normalized.originalRoomsJson?.outdoor)) {
    errors['rooms.outdoor.displayName'] = copy.errors?.outdoorMissing || 'Thiếu dữ liệu không gian ngoài trời.';
  }

  if (!normalizeText(normalized.draftRooms?.indoor?.displayName)) {
    errors['rooms.indoor.displayName'] = copy.errors?.indoorNameRequired || 'Không gian trong nhà cần có tên hiển thị.';
  }
  if (!normalizeText(normalized.draftRooms?.outdoor?.displayName)) {
    errors['rooms.outdoor.displayName'] = copy.errors?.outdoorNameRequired || 'Không gian ngoài trời cần có tên hiển thị.';
  }

  const roomsValidation = validateGateRoomsJson(normalized.rooms_json, copy, { skipDisplayNameRequired: true });
  Object.assign(errors, roomsValidation.errors);
  Object.assign(warnings, roomsValidation.warnings);

  if (!normalized.description) {
    warnings.description = copy.warnings?.descriptionEmpty || 'Mô tả đang trống, nên kiểm tra trước khi công khai.';
  }

  if (normalized.title.length > 120) {
    warnings.title = copy.warnings?.titleLong || 'Tiêu đề cổng vào khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
  }

  if (normalized.description.length > 500) {
    warnings.description = copy.warnings?.descriptionLong || 'Mô tả hướng dẫn khá dài. Nên kiểm tra lại trước khi công khai.';
  }

  ['indoor', 'outdoor'].forEach((roomKey) => {
    const room = normalized.draftRooms?.[roomKey] || {};
    if (!normalizeText(room.description)) {
      warnings[`rooms.${roomKey}.description`] = roomKey === 'indoor'
        ? (copy.warnings?.indoorDescriptionEmpty || 'Mô tả không gian trong nhà đang trống, nên kiểm tra trước khi công khai.')
        : (copy.warnings?.outdoorDescriptionEmpty || 'Mô tả không gian ngoài trời đang trống, nên kiểm tra trước khi công khai.');
    }
    if (normalizeText(room.displayName).length > 120) {
      warnings[`rooms.${roomKey}.displayName`] = copy.warnings?.roomTitleLong || 'Tên hiển thị khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
    }
    if (normalizeText(room.description).length > 300) {
      warnings[`rooms.${roomKey}.description`] = copy.warnings?.roomDescriptionLong || 'Mô tả không gian khá dài. Nên kiểm tra lại cách hiển thị trên giao diện public.';
    }
    if (normalizeText(room.ctaLabel).length > 80) {
      warnings[`rooms.${roomKey}.ctaLabel`] = copy.warnings?.ctaLong || 'Nhãn nút bắt đầu tham quan khá dài. Nên rút gọn trước khi công khai.';
    }
  });

  return {
    values: {
      eyebrow: normalized.eyebrow,
      title: normalized.title,
      description: normalized.description,
      back_label: normalized.back_label,
      rooms_json: normalized.rooms_json,
    },
    errors,
    warnings,
    valid: Object.keys(errors).length === 0,
  };
}

export function normalizeGateContentValues(values = {}) {
  const originalRoomsJson = normalizeGateRoomsJson(values.originalRoomsJson);
  const draftRooms = {
    indoor: normalizeGateRoomDraft(values.rooms?.indoor),
    outdoor: normalizeGateRoomDraft(values.rooms?.outdoor),
  };
  return {
    eyebrow: normalizeText(values.eyebrow),
    title: normalizeText(values.title),
    description: normalizeText(values.description),
    back_label: normalizeText(values.back_label),
    draftRooms,
    originalRoomsJson,
    rooms_json: patchGateRoomTextFields(originalRoomsJson, draftRooms),
  };
}

export function normalizeGateRoomsJson(value) {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return isPlainObject(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  if (!isPlainObject(value)) return {};
  return cloneJsonSafe(value);
}

export function patchGateRoomTextFields(originalRoomsJson = {}, draftRooms = {}) {
  const roomsJson = normalizeGateRoomsJson(originalRoomsJson);
  ['indoor', 'outdoor'].forEach((roomKey) => {
    const originalRoom = isPlainObject(roomsJson[roomKey]) ? cloneJsonSafe(roomsJson[roomKey]) : {};
    const draftRoom = normalizeGateRoomDraft(draftRooms[roomKey]);
    patchEquivalentTextKeys(originalRoom, ['label', 'title', 'name'], draftRoom.displayName, 'label');
    patchEquivalentTextKeys(originalRoom, ['description', 'lead', 'subtitle'], draftRoom.description, 'description');
    patchGateRoomCtaLabel(originalRoom, draftRoom.ctaLabel);
    roomsJson[roomKey] = originalRoom;
  });
  return roomsJson;
}

export function validateGateRoomsJson(roomsJson = {}, copy = {}, options = {}) {
  const errors = {};
  const warnings = {};

  if (!isPlainObject(roomsJson)) {
    errors.rooms_json = copy.errors?.roomsInvalid || 'Dữ liệu lựa chọn không gian không hợp lệ.';
    return { errors, warnings };
  }

  ['indoor', 'outdoor'].forEach((roomKey) => {
    const room = roomsJson[roomKey];
    if (!room) {
      errors[`rooms.${roomKey}.displayName`] = roomKey === 'indoor'
        ? (copy.errors?.indoorMissing || 'Thiếu dữ liệu không gian trong nhà.')
        : (copy.errors?.outdoorMissing || 'Thiếu dữ liệu không gian ngoài trời.');
      return;
    }
    if (!isPlainObject(room)) {
      errors[`rooms.${roomKey}.displayName`] = roomKey === 'indoor'
        ? (copy.errors?.indoorInvalid || 'Dữ liệu không gian trong nhà không hợp lệ.')
        : (copy.errors?.outdoorInvalid || 'Dữ liệu không gian ngoài trời không hợp lệ.');
      return;
    }
    if (!options.skipDisplayNameRequired && !firstText(room, ['label', 'title', 'name'])) {
      errors[`rooms.${roomKey}.displayName`] = roomKey === 'indoor'
        ? (copy.errors?.indoorNameRequired || 'Không gian trong nhà cần có tên hiển thị.')
        : (copy.errors?.outdoorNameRequired || 'Không gian ngoài trời cần có tên hiển thị.');
    }
  });

  return { errors, warnings };
}

function normalizeGateRoomDraft(room = {}) {
  return {
    displayName: normalizeText(room?.displayName),
    description: normalizeText(room?.description),
    ctaLabel: normalizeText(room?.ctaLabel),
  };
}

function patchEquivalentTextKeys(object, keys, value, fallbackKey) {
  const normalized = normalizeText(value);
  const existingKeys = keys.filter((key) => Object.prototype.hasOwnProperty.call(object, key));
  if (existingKeys.length) {
    existingKeys.forEach((key) => {
      object[key] = normalized;
    });
    return;
  }
  object[fallbackKey] = normalized;
}

function patchGateRoomCtaLabel(room, value) {
  if (Object.prototype.hasOwnProperty.call(room, 'ctaLabel')) {
    room.ctaLabel = normalizeText(value);
    return;
  }
  const ctaObject = firstObject(room, ['cta', 'button', 'action']);
  if (!ctaObject) return;
  for (const key of ['label', 'text', 'title', 'name']) {
    if (Object.prototype.hasOwnProperty.call(ctaObject, key)) {
      ctaObject[key] = normalizeText(value);
      return;
    }
  }
}

function firstObject(object = {}, keys = []) {
  for (const key of keys) {
    if (isPlainObject(object?.[key])) return object[key];
  }
  return null;
}

function firstText(object = {}, keys = []) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== null && value !== undefined && String(value).trim()) return String(value).trim();
  }
  return '';
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cloneJsonSafe(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

// V6.11.21-B6-F_K_O_I_H — static CMS draft/export validation.
const STATIC_CMS_LAYOUT_FIELDS = new Set([
  'position', 'rotation', 'size', 'scale', 'group', 'frame', 'clickable', 'transparent',
  'collider', 'physics', 'mesh', 'object3D', 'geometry', 'materialConfig', 'renderConfig',
]);
const STATIC_CMS_MEDIA_FIELDS = [
  'image', 'imageUrl', 'image_url', 'thumbnail', 'thumbnailUrl', 'thumbnail_url',
  'videoUrl', 'video_url', 'poster', 'posterUrl', 'poster_url', 'mediaUrl', 'media_url',
];
const STATIC_CMS_OLD_ID_PATTERN = /^(TEXT_00[12]|VIDEO_00[23]|NEON_TEXT_HCEC_001|ART_00[2-9]|ART_0[1-4][0-9])$/i;

export function validateStaticCmsMediaUrl(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return { valid: true, reason: 'empty' };
  const lower = raw.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:') || lower.startsWith('file:') || lower.startsWith('blob:')) {
    return { valid: false, reason: 'blocked-protocol' };
  }
  if (raw.includes('intro_h264_test.mp4')) {
    return { valid: false, reason: 'stale-missing-media' };
  }
  if (raw.startsWith('./assets/') || raw.startsWith('assets/') || raw.startsWith('/assets/')) {
    return { valid: true, reason: 'relative-asset' };
  }
  if (raw.startsWith('./') || raw.startsWith('/')) {
    return { valid: false, reason: 'relative-path-not-asset' };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return { valid: false, reason: 'malformed-url' };
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    return { valid: false, reason: 'blocked-protocol' };
  }

  const origins = new Set(safeArray(options.allowedMediaOrigins).map((entry) => String(entry || '').trim()).filter(Boolean));
  const hosts = new Set(safeArray(options.allowedMediaHosts).map((entry) => String(entry || '').trim()).filter(Boolean));
  const originOk = origins.size === 0 || origins.has(url.origin);
  const hostOk = hosts.size === 0 || hosts.has(url.host) || hosts.has(url.hostname);
  if (!originOk && !hostOk) {
    return { valid: false, reason: 'remote-host-not-allowlisted' };
  }
  return { valid: true, reason: 'remote-allowlisted' };
}

export function validateStaticCmsDraft(cmsJson = {}, options = {}) {
  const errors = {};
  const warnings = {};
  if (!isPlainObject(cmsJson)) {
    return { valid: false, errors: { root: 'CMS JSON phải là object.' }, warnings };
  }
  if (!isPlainObject(cmsJson.rooms)) {
    errors.rooms = 'Thiếu rooms trong CMS JSON.';
  }

  const expectedIds = options.expectedIds || {};
  ['indoor', 'outdoor'].forEach((roomKey) => {
    const artworks = cmsJson?.rooms?.[roomKey]?.artworks;
    if (!Array.isArray(artworks)) {
      errors[`rooms.${roomKey}.artworks`] = `Thiếu rooms.${roomKey}.artworks[].`;
      return;
    }
    const expected = safeArray(expectedIds[roomKey]).map((id) => String(id).toUpperCase());
    const ids = artworks.map((item) => String(item?.artwork_code || item?.id || item?.code || '').trim().toUpperCase()).filter(Boolean);
    if (expected.length && ids.length !== expected.length) {
      errors[`rooms.${roomKey}.count`] = `${roomKey} phải có đúng ${expected.length} item, hiện có ${ids.length}.`;
    }
    const missing = expected.filter((id) => !ids.includes(id));
    const extra = ids.filter((id) => !expected.includes(id));
    if (missing.length) errors[`rooms.${roomKey}.missing`] = `Thiếu item: ${missing.join(', ')}.`;
    if (extra.length) errors[`rooms.${roomKey}.extra`] = `Có item ngoài scene actual: ${extra.join(', ')}.`;

    const seen = new Set();
    artworks.forEach((item, index) => {
      const id = String(item?.artwork_code || item?.id || item?.code || `#${index}`).trim().toUpperCase();
      if (seen.has(id)) errors[`rooms.${roomKey}.${id}.duplicate`] = `Trùng ID trong ${roomKey}: ${id}.`;
      seen.add(id);
      if (STATIC_CMS_OLD_ID_PATTERN.test(id)) {
        errors[`rooms.${roomKey}.${id}.old`] = `Item cũ không còn trong scene actual: ${id}.`;
      }
      Object.keys(item || {}).forEach((key) => {
        if (STATIC_CMS_LAYOUT_FIELDS.has(key)) {
          errors[`rooms.${roomKey}.${id}.${key}`] = `CMS draft không được chứa layout field: ${key}.`;
        }
      });
      STATIC_CMS_MEDIA_FIELDS.forEach((fieldName) => {
        const mediaValue = item?.[fieldName];
        if (mediaValue === null || mediaValue === undefined || String(mediaValue).trim() === '') return;
        const mediaCheck = validateStaticCmsMediaUrl(mediaValue, options);
        if (!mediaCheck.valid) {
          errors[`rooms.${roomKey}.${id}.${fieldName}`] = `${fieldName} không an toàn/hợp lệ (${mediaCheck.reason}).`;
        }
        if (String(mediaValue).includes('intro_h264_test.mp4')) {
          errors[`rooms.${roomKey}.${id}.${fieldName}.stale`] = 'Không được dùng intro_h264_test.mp4 trong CMS target.';
        }
        if (String(mediaValue).trim().toLowerCase().startsWith('data:')) {
          errors[`rooms.${roomKey}.${id}.${fieldName}.base64`] = 'Không được nhúng base64/data URL vào CMS JSON.';
        }
      });
      const videoValue = firstText(item || {}, ['videoUrl', 'video_url']);
      const posterValue = firstText(item || {}, ['poster', 'posterUrl', 'poster_url']);
      if (videoValue && !posterValue) {
        warnings[`rooms.${roomKey}.${id}.poster`] = 'Video chưa có poster; đây là warning, không chặn export.';
      }
    });
  });

  return { valid: Object.keys(errors).length === 0, errors, warnings };
}
