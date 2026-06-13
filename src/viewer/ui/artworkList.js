const artworkListToggle = document.getElementById('artworkListToggle');
const artworkListPanel = document.getElementById('artworkListPanel');
const artworkListClose = document.getElementById('artworkListClose');
const artworkSearchInput = document.getElementById('artworkSearchInput');
const artworkGroupFilter = document.getElementById('artworkGroupFilter');
const artworkListCount = document.getElementById('artworkListCount');
const artworkListItems = document.getElementById('artworkListItems');

let artworkListData = [];

const artworkListSmallTitle = artworkListPanel?.querySelector('.artwork-list-head small');
const artworkListMainTitle = artworkListPanel?.querySelector('.artwork-list-head h3');
if (artworkListSmallTitle) artworkListSmallTitle.textContent = 'Danh mục trưng bày';
if (artworkListMainTitle) artworkListMainTitle.textContent = 'Nội dung triển lãm';

const TYPE_LABELS = {
  artwork: 'Tranh',
  logo: 'Logo',
  text: 'Chữ',
  video: 'Video',
};

const TYPE_SUBTITLES = {
  artwork: 'Tác phẩm trưng bày',
  logo: 'Nhận diện / Logo',
  text: 'Nội dung chữ',
  video: 'Video trình chiếu',
};

function normalizeListText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getTypeLabel(type) {
  return TYPE_LABELS[type] || 'Nội dung';
}

function getTypeSubtitle(type) {
  return TYPE_SUBTITLES[type] || 'Nội dung trưng bày';
}

function compactText(value, max = 118) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function getItemDescription(data) {
  const type = data.type || 'artwork';
  if (type === 'video') {
    return compactText(data.description || data.content || data.note || 'Nhấp để phát hoặc tạm dừng video trên bề mặt trình chiếu.', 120);
  }
  if (type === 'logo') {
    return compactText(data.description || data.content || data.note || 'Logo dùng trong cụm trưng bày hoặc nhận diện nội dung.', 120);
  }
  if (type === 'text') {
    return compactText(data.text || data.description || data.content || 'Nội dung chữ trong không gian triển lãm.', 120);
  }
  return compactText(data.description || data.content || data.note, 120);
}


function getListMediaSrc(data = {}) {
  if (window.cmsContentLoader?.getArtworkMediaSrc) return window.cmsContentLoader.getArtworkMediaSrc(data);
  return String(
    data?.image ||
    data?.imageUrl ||
    data?.image_url ||
    data?.thumbnail ||
    data?.thumbnail_url ||
    data?.src ||
    data?.poster ||
    data?.posterUrl ||
    data?.poster_url ||
    ''
  ).trim();
}

function getClickableArtworkData() {
  return artworkRoots
    .map((root) => ({ root, data: root.userData?.artData || {} }))
    .filter((item) => item.data && item.data.clickable !== false)
    .map((item) => {
      const type = item.data.type || 'artwork';
      const title = item.data.title || item.data.text || item.data.id || item.root.name || 'Nội dung trưng bày';
      return {
        id: item.data.id || item.root.name,
        type,
        typeLabel: getTypeLabel(type),
        typeSubtitle: getTypeSubtitle(type),
        title,
        author: item.data.author || '',
        year: item.data.year || '',
        group: item.data.group || 'Không phân nhóm',
        material: item.data.material || item.data.medium || '',
        medium: item.data.medium || item.data.material || '',
        realSize: item.data.realSize || '',
        description: getItemDescription(item.data),
        text: item.data.text || '',
        content: item.data.content || '',
        image: getListMediaSrc(item.data),
        videoUrl: item.data.videoUrl || '',
        clickable: item.data.clickable !== false,
        root: item.root,
      };
    });
}

function shouldAutoFocusArtworkSearch() {
  try {
    return !window.matchMedia?.('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return true;
  }
}

function openArtworkListPanel() {
  if (!artworkListPanel || !artworkListToggle) return;
  artworkListPanel.classList.add('active');
  document.body.classList.add('artwork-list-open');
  window.releaseAllMobileKeys?.();
  artworkListToggle.setAttribute('aria-expanded', 'true');
  artworkListItems?.scrollTo?.({ top: 0, behavior: 'auto' });
  if (shouldAutoFocusArtworkSearch()) {
    setTimeout(() => artworkSearchInput?.focus(), 40);
  }
}

function closeArtworkListPanel() {
  if (!artworkListPanel || !artworkListToggle) return;
  artworkListPanel.classList.remove('active');
  document.body.classList.remove('artwork-list-open');
  artworkListToggle.setAttribute('aria-expanded', 'false');
  window.releaseAllMobileKeys?.();
}

function toggleArtworkListPanel() {
  if (!artworkListPanel) return;
  if (artworkListPanel.classList.contains('active')) closeArtworkListPanel();
  else openArtworkListPanel();
}

function fillGroupFilter() {
  if (!artworkGroupFilter) return;

  const current = artworkGroupFilter.value;
  const groups = [...new Set(artworkListData.map((item) => item.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'vi'));

  artworkGroupFilter.innerHTML = '<option value="">Tất cả nhóm</option>';
  groups.forEach((group) => {
    const option = document.createElement('option');
    option.value = group;
    option.textContent = group;
    artworkGroupFilter.appendChild(option);
  });

  if (groups.includes(current)) artworkGroupFilter.value = current;
}

function getFilteredArtworkList() {
  const q = normalizeListText(artworkSearchInput?.value || '');
  const group = artworkGroupFilter?.value || '';

  return artworkListData.filter((item) => {
    if (group && item.group !== group) return false;
    if (!q) return true;

    const haystack = normalizeListText(`${item.id} ${item.type} ${item.typeLabel} ${item.typeSubtitle} ${item.title} ${item.author} ${item.year} ${item.group} ${item.material} ${item.medium} ${item.realSize} ${item.description} ${item.text} ${item.videoUrl}`);
    return haystack.includes(q);
  });
}

function buildMetaLine(item) {
  if (item.type === 'video') return `${item.typeSubtitle} · ${item.group}`;
  if (item.type === 'logo') return `${item.typeSubtitle} · ${item.group}`;
  if (item.type === 'text') return `${item.typeSubtitle} · ${item.group}`;

  const parts = [item.typeSubtitle, item.group];
  const credit = [item.author, item.year].filter(Boolean).join(' · ');
  if (credit) parts.push(credit);
  return parts.join(' · ');
}

function renderArtworkList() {
  if (!artworkListItems || !artworkListCount) return;

  const filtered = getFilteredArtworkList();
  artworkListItems.innerHTML = '';
  artworkListCount.textContent = `${filtered.length}/${artworkListData.length} nội dung có thể xem`;

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'artwork-list-empty';
    empty.textContent = artworkListData.length === 0
      ? 'Chưa có nội dung clickable=true trong dữ liệu phòng.'
      : 'Không tìm thấy nội dung phù hợp.';
    artworkListItems.appendChild(empty);
    return;
  }

  filtered.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `artwork-list-item artwork-list-item--${escapeHtml(item.type)}`;
    button.dataset.id = item.id;

    const description = item.description || (item.clickable ? 'Nhấp để chuyển đến nội dung này trong phòng.' : 'Nội dung không tương tác.');
    const actionHtml = item.type === 'video'
      ? '<span class="artwork-list-actions"><span class="artwork-list-action-primary">Click: phát/tạm dừng</span><span class="artwork-list-action-secondary">Nhấp đúp trong phòng: xem lớn</span></span>'
      : '<span class="artwork-list-actions"><span class="artwork-list-action-primary">Click để chuyển đến vị trí</span></span>';

    button.innerHTML = `
      <span class="artwork-list-type">${escapeHtml(item.typeLabel)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <span class="artwork-list-meta">${escapeHtml(buildMetaLine(item))}</span>
      <span class="artwork-list-desc">${escapeHtml(description)}</span>
      ${actionHtml}
    `;

    button.addEventListener('click', () => {
      closeArtworkListPanel();
      if (item.type === 'video') {
        focusArtworkById(item.id, { openModalAfterFocus: false });
        window.setTimeout(() => window.openSceneVideoCinema?.(item.root || item), 520);
        return;
      }
      focusArtworkById(item.id, { openModalAfterFocus: true });
    });

    artworkListItems.appendChild(button);
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function refreshArtworkList() {
  artworkListData = getClickableArtworkData();
  fillGroupFilter();
  renderArtworkList();
}

if (artworkListToggle) artworkListToggle.addEventListener('click', toggleArtworkListPanel);
if (artworkListClose) artworkListClose.addEventListener('click', closeArtworkListPanel);
if (artworkSearchInput) artworkSearchInput.addEventListener('input', renderArtworkList);
if (artworkGroupFilter) artworkGroupFilter.addEventListener('change', renderArtworkList);

document.addEventListener('keydown', (event) => {
  if (event.code === 'Escape' && artworkListPanel?.classList.contains('active')) {
    closeArtworkListPanel();
  }
});

refreshArtworkList();

window.openArtworkListPanel = openArtworkListPanel;
window.closeArtworkListPanel = closeArtworkListPanel;
window.toggleArtworkListPanel = toggleArtworkListPanel;
