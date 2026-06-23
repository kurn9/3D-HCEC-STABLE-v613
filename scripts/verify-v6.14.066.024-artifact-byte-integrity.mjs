#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CHANGED_FILES = [
  'scripts/verify-v6.14.066.024-cms-verification-meta-orchestrator.mjs',
  'scripts/verify-v6.14.066.024-cms-mutation-parent-orchestrator.mjs',
  'scripts/verify-v6.14.066.024-cms-harness-child-runner.mjs',
  'scripts/lib/v6.14.066.024-mutation-outcome-oracle.mjs',
  'scripts/verify-v6.14.066.024-artifact-byte-integrity.mjs',
  'scripts/fixtures/v6.14.066.024-product-mutation-cases.json',
  'scripts/fixtures/v6.14.066.024-child-behavior-mutation-cases.json',
  'scripts/fixtures/v6.14.066.024-parent-behavior-mutation-cases.json',
  'scripts/fixtures/v6.14.066.024-oracle-control-cases.json',
  'scripts/fixtures/v6.14.066.024-required-verification-cases.json',
  'scripts/fixtures/v6.14.066.024-baseline-red-cases.json',
];
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const root = path.resolve(args.get('root') || process.cwd());
const fullCodePath = args.get('full-code') ? path.resolve(args.get('full-code')) : '';
const mode = args.get('mode') || (fullCodePath ? 'verify' : 'manifest');

function sha256Bytes(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function trailingNewline(bytes) { return bytes.length > 0 && bytes[bytes.length - 1] === 0x0a; }
function sourceRecord(rel) {
  const bytes = fs.readFileSync(path.join(root, rel));
  return { relativePath: rel, byteLength: bytes.length, sha256: sha256Bytes(bytes), trailingNewline: trailingNewline(bytes), bytes };
}
function parseMetadata(line) {
  const out = {};
  const regex = /([A-Za-z0-9_]+)=("([^"]*)"|[^\s]+)/g;
  let match;
  while ((match = regex.exec(line))) out[match[1]] = match[3] ?? match[2];
  return out;
}
function extractBlocks(markdown) {
  const blocks = [];
  const openRe = /^```[^\n]*relativePath="([^"]+)"[^\n]*$/gm;
  let match;
  while ((match = openRe.exec(markdown))) {
    const openLine = match[0];
    const contentStart = openRe.lastIndex;
    const closeIndex = markdown.indexOf('\n```', contentStart);
    if (closeIndex === -1) throw new Error(`Unclosed block for ${match[1]}`);
    const raw = markdown.slice(contentStart, closeIndex);
    const meta = parseMetadata(openLine);
    const rel = meta.relativePath || match[1];
    let content = raw;
    if (content.startsWith('\n')) content = content.slice(1);
    const declaredTrailing = meta.trailingNewline === 'true';
    if (!declaredTrailing && content.endsWith('\n')) content = content.slice(0, -1);
    const bytes = Buffer.from(content, 'utf8');
    blocks.push({ relativePath: rel, meta, bytes, byteLength: bytes.length, sha256: sha256Bytes(bytes), trailingNewline: trailingNewline(bytes) });
    openRe.lastIndex = closeIndex + 4;
  }
  return blocks;
}
function verify() {
  const markdown = fs.readFileSync(fullCodePath, 'utf8');
  const blocks = extractBlocks(markdown);
  const byPath = new Map(blocks.map((block) => [block.relativePath, block]));
  const results = CHANGED_FILES.map((rel) => {
    const source = sourceRecord(rel);
    const block = byPath.get(rel);
    if (!block) return { relativePath: rel, byteEqual: false, reason: 'MISSING_BLOCK' };
    const sourceBytes = source.bytes;
    const byteEqual = Buffer.compare(sourceBytes, block.bytes) === 0;
    return {
      relativePath: rel,
      byteEqual,
      sourceByteLength: source.byteLength,
      extractedByteLength: block.byteLength,
      sourceSha256: source.sha256,
      extractedSha256: block.sha256,
      sourceTrailingNewline: source.trailingNewline,
      extractedTrailingNewline: block.trailingNewline,
      metadataByteLength: Number(block.meta.byteLength),
      metadataSha256: block.meta.sha256,
      metadataTrailingNewline: block.meta.trailingNewline === 'true',
    };
  });
  const pass = results.every((r) => r.byteEqual && r.sourceByteLength === r.extractedByteLength && r.sourceSha256 === r.extractedSha256 && r.sourceTrailingNewline === r.extractedTrailingNewline && r.metadataByteLength === r.sourceByteLength && r.metadataSha256 === r.sourceSha256 && r.metadataTrailingNewline === r.sourceTrailingNewline);
  console.log(JSON.stringify({ pass, total: results.length, results }, null, 2));
  process.exit(pass ? 0 : 1);
}
function manifest() {
  const results = CHANGED_FILES.map((rel) => {
    const source = sourceRecord(rel);
    return { relativePath: rel, byteLength: source.byteLength, sha256: source.sha256, trailingNewline: source.trailingNewline };
  });
  console.log(JSON.stringify({ total: results.length, results }, null, 2));
}
if (mode === 'verify') verify();
else manifest();
