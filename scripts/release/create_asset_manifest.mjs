#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const VERSION = 'V6.11.21-B6-F_J_B';
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '../..');
const OUTPUT_PATH = path.join(PROJECT_ROOT, 'data', 'asset_manifest.json');

const SCAN_ROOTS = [
  { rel: 'assets/artworks', kind: 'artwork' },
  { rel: 'assets/videos', kind: 'video' },
  { rel: 'assets/logos', kind: 'logo' },
  { rel: 'assets/posters', kind: 'poster' },
  { rel: 'assets/audio', kind: 'audio' }
];

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg']);

function toPosix(value) {
  return String(value || '').replace(/\\/g, '/');
}

function detectType(ext) {
  const e = String(ext || '').toLowerCase();
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  if (AUDIO_EXTS.has(e)) return 'audio';
  return '';
}

function detectRoom(relativePath, rootRel) {
  const rel = toPosix(relativePath);
  const root = toPosix(rootRel).replace(/\/$/, '');
  const rest = rel.startsWith(`${root}/`) ? rel.slice(root.length + 1) : rel;
  const first = rest.split('/')[0];
  if (first === 'indoor' || first === 'outdoor' || first === 'shared') return first;
  return 'root';
}

function walkFiles(absDir) {
  const out = [];
  if (!fs.existsSync(absDir)) return out;
  const stack = [absDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        stack.push(abs);
      } else if (entry.isFile()) {
        out.push(abs);
      }
    }
  }
  return out;
}

function createAssetId(publicPath) {
  const hash = crypto.createHash('sha1').update(publicPath).digest('hex').slice(0, 12);
  return `asset_${hash}`;
}

function buildAsset(absPath, rootInfo) {
  const ext = path.extname(absPath).toLowerCase();
  const type = detectType(ext);
  if (!type) return null;

  const rel = toPosix(path.relative(PROJECT_ROOT, absPath));
  const stat = fs.statSync(absPath);
  const publicPath = `./${rel}`;
  const folder = toPosix(path.dirname(rel));
  const name = path.basename(absPath);

  return {
    id: createAssetId(publicPath),
    type,
    kind: rootInfo.kind,
    room: detectRoom(rel, rootInfo.rel),
    name,
    ext,
    path: publicPath,
    folder,
    sizeBytes: stat.size,
    mtimeMs: Math.round(stat.mtimeMs),
    publicPath
  };
}

function sortAsset(a, b) {
  return [a.kind, a.room, a.name, a.publicPath].join('\u0000').localeCompare([b.kind, b.room, b.name, b.publicPath].join('\u0000'));
}

function countBy(assets, predicate) {
  return assets.filter(predicate).length;
}

function main() {
  const warnings = [];
  const assets = [];

  for (const rootInfo of SCAN_ROOTS) {
    const absRoot = path.join(PROJECT_ROOT, rootInfo.rel);
    if (!fs.existsSync(absRoot)) {
      warnings.push(`Skipped missing folder: ${rootInfo.rel}`);
      continue;
    }
    for (const file of walkFiles(absRoot)) {
      const asset = buildAsset(file, rootInfo);
      if (asset) assets.push(asset);
    }
  }

  assets.sort(sortAsset);

  const manifest = {
    version: VERSION,
    generatedAt: new Date().toISOString(),
    root: 'assets',
    counts: {
      total: assets.length,
      image: countBy(assets, (asset) => asset.type === 'image'),
      video: countBy(assets, (asset) => asset.type === 'video'),
      logo: countBy(assets, (asset) => asset.kind === 'logo'),
      poster: countBy(assets, (asset) => asset.kind === 'poster'),
      audio: countBy(assets, (asset) => asset.type === 'audio')
    },
    warnings,
    assets
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(`[asset-manifest] wrote ${path.relative(PROJECT_ROOT, OUTPUT_PATH)}`);
  console.table(manifest.counts);
  if (warnings.length) warnings.forEach((warning) => console.warn(`[asset-manifest] ${warning}`));
}

main();
