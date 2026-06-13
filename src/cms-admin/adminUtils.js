import { SUPABASE_CONFIG } from './adminConfig.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function setText(node, value, fallback = '—') {
  if (!node) return;
  const text = value === null || value === undefined || value === '' ? fallback : value;
  node.textContent = String(text);
}

export function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatCount(value) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('vi-VN').format(Number.isFinite(number) ? number : 0);
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

export function isPlaceholderSupabaseConfig(config = SUPABASE_CONFIG) {
  const url = String(config.url || '').trim();
  const anonKey = String(config.anonKey || '').trim();
  return !url || !anonKey || url === 'YOUR_SUPABASE_URL' || anonKey === 'YOUR_SUPABASE_ANON_KEY';
}

export function byId(id) {
  return document.getElementById(id);
}

export function clearNode(node) {
  if (!node) return;
  while (node.firstChild) {
    node.removeChild(node.firstChild);
  }
}

export function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);
  const {
    className,
    text,
    title,
    type,
    href,
    value,
    placeholder,
    ariaLabel,
    dataset,
    attrs,
  } = options;

  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  if (title) element.title = title;
  if (type) element.type = type;
  if (href) element.href = href;
  if (value !== undefined) element.value = value;
  if (placeholder) element.placeholder = placeholder;
  if (ariaLabel) element.setAttribute('aria-label', ariaLabel);

  if (dataset && typeof dataset === 'object') {
    Object.entries(dataset).forEach(([key, entryValue]) => {
      element.dataset[key] = String(entryValue);
    });
  }

  if (attrs && typeof attrs === 'object') {
    Object.entries(attrs).forEach(([key, entryValue]) => {
      if (entryValue !== null && entryValue !== undefined) {
        element.setAttribute(key, String(entryValue));
      }
    });
  }

  return element;
}

export function appendChildren(parent, children = []) {
  children.filter(Boolean).forEach((child) => parent.appendChild(child));
  return parent;
}

export function renderEmptyState(message = 'Chưa có dữ liệu.') {
  return createElement('div', {
    className: 'cms-admin-empty',
    text: message,
  });
}

export function renderErrorBox(error, title = 'Không thể tải dữ liệu') {
  const box = createElement('div', { className: 'cms-admin-alert cms-admin-alert-error' });
  const strong = createElement('strong', { text: title });
  const detail = createElement('div', {
    text: normalizeErrorMessage(error),
  });
  detail.style.marginTop = '6px';
  appendChildren(box, [strong, detail]);
  return box;
}

export function normalizeErrorMessage(error) {
  if (!error) return 'Không rõ nguyên nhân.';
  if (typeof error === 'string') return error;
  if (error.message) return error.message;
  if (error.error_description) return error.error_description;
  if (error.details) return error.details;
  try {
    return JSON.stringify(error);
  } catch {
    return 'Không thể đọc chi tiết lỗi.';
  }
}

export function renderBadge(label, variant = 'default') {
  const variantClass = variant === 'success'
    ? 'cms-admin-badge-success'
    : variant === 'warning'
      ? 'cms-admin-badge-warning'
      : variant === 'danger'
        ? 'cms-admin-badge-danger'
        : '';
  return createElement('span', {
    className: ['cms-admin-badge', variantClass].filter(Boolean).join(' '),
    text: label,
  });
}

export function toDisplayText(value, fallback = '—') {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  return String(value);
}

export function countBy(items, key) {
  return safeArray(items).reduce((acc, item) => {
    const value = item?.[key] || 'unknown';
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}
