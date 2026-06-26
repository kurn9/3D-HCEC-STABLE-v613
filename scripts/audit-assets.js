#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || process.cwd());
const REPORT_PATH = path.join(ROOT, 'PERFORMANCE_AUDIT_REPORT.md');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const ASSET_DIR = path.join(ROOT, 'assets');
const ARTWORKS_DIR = path.join(ASSET_DIR, 'artworks');
const LOGOS_DIR = path.join(ASSET_DIR, 'logos');
const ROOM_GLB = path.join(ASSET_DIR, 'room_base.glb');
const AVATAR_GLB = path.join(ASSET_DIR, 'avatar', 'visitor.glb');

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch (_) {
    return false;
  }
}

function fileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (_) {
    return 0;
  }
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

function walkFiles(dir) {
  if (!exists(dir)) return [];
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(fullPath);
      }
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function readJpegDimensions(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (offset + 2 > buffer.length) break;
    const length = buffer.readUInt16BE(offset);
    if (length < 2) break;
    const isSof = (
      marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 ||
      marker === 0xc5 || marker === 0xc6 || marker === 0xc7 ||
      marker === 0xc9 || marker === 0xca || marker === 0xcb ||
      marker === 0xcd || marker === 0xce || marker === 0xcf
    );
    if (isSof && offset + 7 < buffer.length) {
      return {
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
        format: 'JPEG'
      };
    }
    offset += length;
  }
  return null;
}

function readPngDimensions(buffer) {
  if (buffer.length < 24) return null;
  const signature = '89504e470d0a1a0a';
  if (buffer.slice(0, 8).toString('hex') !== signature) return null;
  if (buffer.slice(12, 16).toString('ascii') !== 'IHDR') return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    format: 'PNG'
  };
}

function readWebpDimensions(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.slice(0, 4).toString('ascii') !== 'RIFF' || buffer.slice(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunk = buffer.slice(12, 16).toString('ascii');
  if (chunk === 'VP8X' && buffer.length >= 30) {
    const width = 1 + buffer.readUIntLE(24, 3);
    const height = 1 + buffer.readUIntLE(27, 3);
    return { width, height, format: 'WEBP/VP8X' };
  }
  if (chunk === 'VP8L' && buffer.length >= 25) {
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + ((b3 << 6) | (b2 >> 2));
    return { width, height, format: 'WEBP/VP8L' };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    // Lossy VP8 stores dimensions after the 3-byte start code 9d 01 2a.
    const startCodeOffset = buffer.indexOf(Buffer.from([0x9d, 0x01, 0x2a]), 20);
    if (startCodeOffset > -1 && startCodeOffset + 7 < buffer.length) {
      const width = buffer.readUInt16LE(startCodeOffset + 3) & 0x3fff;
      const height = buffer.readUInt16LE(startCodeOffset + 5) & 0x3fff;
      return { width, height, format: 'WEBP/VP8' };
    }
  }
  return { width: null, height: null, format: 'WEBP' };
}

function readImageDimensions(filePath) {
  try {
    const buffer = fs.readFileSync(filePath);
    return readJpegDimensions(buffer) || readPngDimensions(buffer) || readWebpDimensions(buffer) || null;
  } catch (error) {
    return null;
  }
}

function relative(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function summarizeFiles(files) {
  return files.map((filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const size = fileSize(filePath);
    const dimensions = IMAGE_EXTENSIONS.has(ext) ? readImageDimensions(filePath) : null;
    return {
      path: relative(filePath),
      size,
      sizeLabel: formatBytes(size),
      ext,
      width: dimensions?.width || null,
      height: dimensions?.height || null,
      format: dimensions?.format || ext.replace('.', '').toUpperCase()
    };
  }).sort((a, b) => b.size - a.size);
}

function toMarkdownTable(rows, columns) {
  if (!rows.length) return '_Không có dữ liệu._';
  const header = `| ${columns.map((c) => c.label).join(' | ')} |`;
  const sep = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${columns.map((c) => String(c.value(row))).join(' | ')} |`);
  return [header, sep, ...body].join('\n');
}

function main() {
  const assetFiles = walkFiles(ASSET_DIR);
  const artworkFiles = walkFiles(ARTWORKS_DIR).filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const logoFiles = walkFiles(LOGOS_DIR).filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const allImages = [...artworkFiles, ...logoFiles];

  const assetSummaries = summarizeFiles(assetFiles);
  const artworkSummaries = summarizeFiles(artworkFiles);
  const logoSummaries = summarizeFiles(logoFiles);
  const totalAssets = assetSummaries.reduce((sum, item) => sum + item.size, 0);
  const totalArtworkImages = artworkSummaries.reduce((sum, item) => sum + item.size, 0);
  const totalLogoImages = logoSummaries.reduce((sum, item) => sum + item.size, 0);
  const heavy500 = artworkSummaries.filter((item) => item.size > 500 * 1024);
  const heavy1m = artworkSummaries.filter((item) => item.size > 1024 * 1024);
  const heavy2m = artworkSummaries.filter((item) => item.size > 2 * 1024 * 1024);
  const tooWide = artworkSummaries.filter((item) => item.width && item.width > 2048);
  const tooTall = artworkSummaries.filter((item) => item.height && item.height > 2048);
  const topAssets = assetSummaries.slice(0, 20);

  const roomSize = fileSize(ROOM_GLB);
  const avatarSize = fileSize(AVATAR_GLB);

  const report = [];
  report.push('# PERFORMANCE AUDIT REPORT — Viewer V4.0');
  report.push('');
  report.push(`Thư mục kiểm tra: \`${ROOT}\``);
  report.push(`Thời điểm tạo báo cáo: ${new Date().toISOString()}`);
  report.push('');
  report.push('## 1. Tổng quan asset');
  report.push('');
  report.push(toMarkdownTable([
    { label: 'Tổng asset', value: formatBytes(totalAssets) },
    { label: 'Ảnh tranh', value: `${artworkSummaries.length} file / ${formatBytes(totalArtworkImages)}` },
    { label: 'Logo/PNG', value: `${logoSummaries.length} file / ${formatBytes(totalLogoImages)}` },
    { label: 'room_base.glb', value: exists(ROOM_GLB) ? formatBytes(roomSize) : 'Không tìm thấy' },
    { label: 'avatar/visitor.glb', value: exists(AVATAR_GLB) ? formatBytes(avatarSize) : 'Không tìm thấy' }
  ], [
    { label: 'Hạng mục', value: (r) => r.label },
    { label: 'Kết quả', value: (r) => r.value }
  ]));
  report.push('');
  report.push('## 2. Top asset nặng nhất');
  report.push('');
  report.push(toMarkdownTable(topAssets, [
    { label: 'File', value: (r) => `\`${r.path}\`` },
    { label: 'Dung lượng', value: (r) => r.sizeLabel },
    { label: 'Kích thước pixel', value: (r) => r.width && r.height ? `${r.width}×${r.height}` : '—' }
  ]));
  report.push('');
  report.push('## 3. Ảnh tranh vượt ngưỡng dung lượng');
  report.push('');
  report.push(`- Lớn hơn 500 KB: ${heavy500.length} file`);
  report.push(`- Lớn hơn 1 MB: ${heavy1m.length} file`);
  report.push(`- Lớn hơn 2 MB: ${heavy2m.length} file`);
  report.push('');
  report.push(toMarkdownTable(heavy500, [
    { label: 'File', value: (r) => `\`${r.path}\`` },
    { label: 'Dung lượng', value: (r) => r.sizeLabel },
    { label: 'Kích thước pixel', value: (r) => r.width && r.height ? `${r.width}×${r.height}` : 'Không đọc được' }
  ]));
  report.push('');
  report.push('## 4. Ảnh tranh có pixel quá lớn');
  report.push('');
  report.push(`- Rộng trên 2048 px: ${tooWide.length} file`);
  report.push(`- Cao trên 2048 px: ${tooTall.length} file`);
  report.push('');
  report.push(toMarkdownTable([...new Map([...tooWide, ...tooTall].map((item) => [item.path, item])).values()], [
    { label: 'File', value: (r) => `\`${r.path}\`` },
    { label: 'Kích thước pixel', value: (r) => r.width && r.height ? `${r.width}×${r.height}` : 'Không đọc được' },
    { label: 'Dung lượng', value: (r) => r.sizeLabel }
  ]));
  report.push('');
  report.push('## 5. Đề xuất tối ưu');
  report.push('');
  report.push('- Tranh thường trong không gian 3D: cạnh dài mục tiêu 1200–1600 px.');
  report.push('- Ảnh xem lớn trong popup/lightbox: cạnh dài mục tiêu 1600–2048 px.');
  report.push('- Thumbnail/list nếu tách riêng trong tương lai: cạnh dài 400–600 px.');
  report.push('- JPG nên thử quality 78–85; kiểm tra lại chữ nhỏ và chi tiết mỹ thuật sau khi nén.');
  report.push('- WebP chỉ nên dùng khi đã có fallback hoặc đã cập nhật pipeline đọc ảnh tương ứng.');
  report.push('- Chưa nên thay `scene.json` trong vòng audit đầu tiên.');
  report.push('- Với GLB, chỉ cân nhắc Draco/KTX2 ở V4.1 sau khi đo trên máy thật vì cần decoder, cần sửa loader và test đường dẫn.');
  report.push('');
  report.push('## 6. Gợi ý bước tiếp theo');
  report.push('');
  report.push('1. Chạy `node scripts/audit-assets.js` sau mỗi lần thay asset.');
  report.push('2. Chạy thử `node scripts/optimize-images.js` để tạo ảnh tối ưu ở thư mục riêng, không ghi đè ảnh gốc.');
  report.push('3. So sánh chất lượng ảnh trên viewer trước khi đổi path hoặc đổi schema.');

  fs.writeFileSync(REPORT_PATH, report.join('\n'), 'utf8');
  console.log(`Đã tạo báo cáo: ${REPORT_PATH}`);
  console.log(`Tổng asset: ${formatBytes(totalAssets)}`);
  console.log(`Ảnh tranh > 500 KB: ${heavy500.length}`);
  console.log(`Ảnh tranh > 1 MB: ${heavy1m.length}`);
  console.log(`Ảnh tranh > 2 MB: ${heavy2m.length}`);
}

main();
