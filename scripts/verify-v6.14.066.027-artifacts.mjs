#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';

const EXACT = {
  zip: '3DGallery_CHANGED_v6.14.066.027_CMS_VERIFY_FINAL.zip',
  report: 'APPLY_v6.14.066.027_CMS_VERIFY_FINAL.md',
  full: 'FULL_CODE_v6.14.066.027_CMS_VERIFY_FINAL.md',
};
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...rest] = arg.split('=');
  return [key.replace(/^--/, ''), rest.length ? rest.join('=') : 'true'];
}));
const zipPath = path.resolve(args.get('zip') || EXACT.zip);
const reportPath = path.resolve(args.get('report') || EXACT.report);
const fullPath = path.resolve(args.get('full') || EXACT.full);
const resultFile = path.resolve(args.get('result-file') || path.join(os.tmpdir(), `cms-066027-artifacts-${Date.now()}.json`));
const expectedRoot = path.resolve(args.get('expected-root') || process.cwd());
const changedList = [
  'scripts/verify-v6.14.066.027-final.mjs',
  'scripts/verify-v6.14.066.027-parent.mjs',
  'scripts/verify-v6.14.066.027-child.mjs',
  'scripts/lib/v6.14.066.027-oracle.mjs',
  'scripts/lib/v6.14.066.027-sql.mjs',
  'scripts/fixtures/v6.14.066.027-cases.json',
  'scripts/verify-v6.14.066.027-artifacts.mjs',
];
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function add(assertions, id, pass, message = '', details = null) { assertions.push({ id, pass: Boolean(pass), message, ...(details ? { details } : {}) }); }
function unzipList(zip) {
  const proc = spawnSync('unzip', ['-Z', '-1', zip], { encoding: 'utf8' });
  if (proc.status !== 0) throw new Error(proc.stderr || proc.stdout || 'unzip list failed');
  return proc.stdout.trim().split(/\r?\n/).filter(Boolean);
}
function unzipBytes(zip, rel) {
  const proc = spawnSync('unzip', ['-p', zip, rel]);
  if (proc.status !== 0) throw new Error(`unzip -p failed for ${rel}: ${proc.stderr}`);
  return proc.stdout;
}
function parseFullCode(markdown) {
  const blocks = new Map();
  const re = /<!-- FILE: ([^\n]+) -->\n```(?:[^\n]*)\n([\s\S]*?)\n```/g;
  let match;
  while ((match = re.exec(markdown))) {
    const rel = match[1].trim();
    const content = match[2];
    blocks.set(rel, Buffer.from(content, 'utf8'));
  }
  return blocks;
}
const assertions = [];
try {
  add(assertions, 'ARTIFACT_ZIP_BASENAME_EXACT', path.basename(zipPath) === EXACT.zip, path.basename(zipPath));
  add(assertions, 'ARTIFACT_REPORT_BASENAME_EXACT', path.basename(reportPath) === EXACT.report, path.basename(reportPath));
  add(assertions, 'ARTIFACT_FULL_BASENAME_EXACT', path.basename(fullPath) === EXACT.full, path.basename(fullPath));
  add(assertions, 'ARTIFACT_FILES_EXIST', [zipPath, reportPath, fullPath].every((p) => fs.existsSync(p)), `${zipPath} ${reportPath} ${fullPath}`);
  const listed = unzipList(zipPath).sort();
  add(assertions, 'ZIP_FILE_LIST_EXACT', JSON.stringify(listed) === JSON.stringify(changedList.slice().sort()), JSON.stringify(listed));
  add(assertions, 'ZIP_FORBIDDEN_PATHS_ABSENT', listed.every((p) => !/(^|\/)(\.env|\.git|node_modules|reports|backup|backups)(\/|$)|\.zip$/i.test(p)), JSON.stringify(listed));
  const fullText = fs.readFileSync(fullPath, 'utf8');
  const blocks = parseFullCode(fullText);
  add(assertions, 'FULL_CODE_BLOCK_LIST_EXACT', JSON.stringify([...blocks.keys()].sort()) === JSON.stringify(changedList.slice().sort()), JSON.stringify([...blocks.keys()].sort()));
  for (const rel of changedList) {
    const zipBytes = unzipBytes(zipPath, rel);
    const blockBytes = blocks.get(rel) || Buffer.from('');
    const sourceBytes = fs.readFileSync(path.join(expectedRoot, rel));
    const trailingNewline = zipBytes.length > 0 && zipBytes[zipBytes.length - 1] === 10;
    add(assertions, `BYTE_EQUAL_ZIP_FULL_${rel}`, zipBytes.equals(blockBytes), `${sha256(zipBytes)} ${sha256(blockBytes)}`, { rel, byteLength: zipBytes.length, trailingNewline });
    add(assertions, `BYTE_EQUAL_ZIP_SOURCE_${rel}`, zipBytes.equals(sourceBytes), `${sha256(zipBytes)} ${sha256(sourceBytes)}`, { rel, byteLength: sourceBytes.length, trailingNewline });
  }
  const report = fs.readFileSync(reportPath, 'utf8');
  add(assertions, 'REPORT_RUNTIME_NOT_RUN_LABELS_PRESENT', /Deno[\s\S]*NOT RUN/.test(report) && /PostgreSQL[\s\S]*NOT RUN/.test(report) && /authenticated staging[\s\S]*NOT RUN/i.test(report), 'runtime labels');
} catch (err) {
  add(assertions, 'ARTIFACT_VERIFIER_EXCEPTION', false, err.stack || err.message);
}
const result = { assertions };
result.passCount = assertions.filter((a) => a.pass).length;
result.failCount = assertions.filter((a) => !a.pass).length;
result.totalCount = assertions.length;
fs.mkdirSync(path.dirname(resultFile), { recursive: true });
fs.writeFileSync(resultFile, JSON.stringify(result, null, 2));
process.exit(result.failCount > 0 ? 1 : 0);
