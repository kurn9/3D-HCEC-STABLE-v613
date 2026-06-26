#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.cwd());
const DEFAULT_INPUT = path.join(ROOT, 'assets', 'artworks');
const DEFAULT_OUTPUT = path.join(ROOT, 'assets_optimized', 'artworks');

const args = parseArgs(process.argv.slice(2));
const inputDir = path.resolve(args.input || DEFAULT_INPUT);
const outputDir = path.resolve(args.output || DEFAULT_OUTPUT);
const maxEdge = Number(args.maxEdge || args['max-edge'] || 1600);
const quality = Number(args.quality || 82);
const format = String(args.format || 'jpg').toLowerCase();
const dryRun = Boolean(args.dryRun || args['dry-run']);

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
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

function walkImages(dir) {
  if (!fs.existsSync(dir)) return [];
  const extensions = new Set(['.jpg', '.jpeg', '.png', '.webp']);
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      if (entry.isFile() && extensions.has(path.extname(fullPath).toLowerCase())) out.push(fullPath);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function outputPathFor(inputPath) {
  const relative = path.relative(inputDir, inputPath);
  const parsed = path.parse(relative);
  const extension = format === 'webp' ? '.webp' : '.jpg';
  return path.join(outputDir, parsed.dir, `${parsed.name}${extension}`);
}

function requireSharp() {
  try {
    return require('sharp');
  } catch (error) {
    return null;
  }
}

async function optimizeWithSharp(sharp, inputPath, outputPath) {
  ensureDir(path.dirname(outputPath));
  let pipeline = sharp(inputPath, { failOn: 'none' })
    .rotate()
    .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true });

  if (format === 'webp') {
    pipeline = pipeline.webp({ quality });
  } else {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true });
  }

  await pipeline.toFile(outputPath);
}

function writeReport(rows) {
  const reportPath = path.join(ROOT, 'IMAGE_OPTIMIZATION_REPORT.md');
  const beforeTotal = rows.reduce((sum, row) => sum + row.before, 0);
  const afterTotal = rows.reduce((sum, row) => sum + row.after, 0);
  const saved = beforeTotal - afterTotal;
  const percent = beforeTotal > 0 ? ((saved / beforeTotal) * 100).toFixed(1) : '0.0';

  const lines = [];
  lines.push('# IMAGE OPTIMIZATION REPORT — Viewer V4.0');
  lines.push('');
  lines.push(`Input: \`${path.relative(ROOT, inputDir) || '.'}\``);
  lines.push(`Output: \`${path.relative(ROOT, outputDir) || '.'}\``);
  lines.push(`Max edge: ${maxEdge}px`);
  lines.push(`Quality: ${quality}`);
  lines.push(`Format: ${format}`);
  lines.push('');
  lines.push('| Tổng trước | Tổng sau | Giảm | Tỷ lệ giảm |');
  lines.push('|---:|---:|---:|---:|');
  lines.push(`| ${formatBytes(beforeTotal)} | ${formatBytes(afterTotal)} | ${formatBytes(saved)} | ${percent}% |`);
  lines.push('');
  lines.push('| File gốc | File tối ưu | Trước | Sau | Giảm |');
  lines.push('|---|---|---:|---:|---:|');
  rows.forEach((row) => {
    const rowSaved = row.before - row.after;
    lines.push(`| \`${path.relative(ROOT, row.input).split(path.sep).join('/')}\` | \`${path.relative(ROOT, row.output).split(path.sep).join('/')}\` | ${formatBytes(row.before)} | ${formatBytes(row.after)} | ${formatBytes(rowSaved)} |`);
  });
  lines.push('');
  lines.push('Lưu ý: script này không ghi đè ảnh gốc và không sửa `data/scene.json`. Hãy kiểm tra chất lượng ảnh trước khi quyết định đổi path trong pipeline riêng.');
  fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
  console.log(`Đã tạo báo cáo: ${reportPath}`);
}

async function main() {
  if (!fs.existsSync(inputDir)) {
    console.error(`Không tìm thấy thư mục input: ${inputDir}`);
    process.exitCode = 1;
    return;
  }

  if (!['jpg', 'jpeg', 'webp'].includes(format)) {
    console.error('Format hợp lệ: jpg hoặc webp.');
    process.exitCode = 1;
    return;
  }

  const sharp = requireSharp();
  if (!sharp) {
    console.error('Chưa cài thư viện sharp. Script không tự tối ưu ảnh nếu thiếu sharp.');
    console.error('Cài bằng lệnh: npm install --save-dev sharp');
    console.error('Sau đó chạy lại, ví dụ: node scripts/optimize-images.js --max-edge 1600 --quality 82');
    process.exitCode = 1;
    return;
  }

  const images = walkImages(inputDir);
  if (!images.length) {
    console.log('Không tìm thấy ảnh để tối ưu.');
    return;
  }

  ensureDir(outputDir);
  const rows = [];

  for (const inputPath of images) {
    const outPath = outputPathFor(inputPath);
    const before = fs.statSync(inputPath).size;

    if (dryRun) {
      rows.push({ input: inputPath, output: outPath, before, after: before });
      console.log(`[dry-run] ${path.relative(ROOT, inputPath)} -> ${path.relative(ROOT, outPath)}`);
      continue;
    }

    await optimizeWithSharp(sharp, inputPath, outPath);
    const after = fs.statSync(outPath).size;
    rows.push({ input: inputPath, output: outPath, before, after });
    const savedPercent = before > 0 ? (((before - after) / before) * 100).toFixed(1) : '0.0';
    console.log(`${path.relative(ROOT, inputPath)} -> ${path.relative(ROOT, outPath)} | ${formatBytes(before)} -> ${formatBytes(after)} | giảm ${savedPercent}%`);
  }

  writeReport(rows);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
