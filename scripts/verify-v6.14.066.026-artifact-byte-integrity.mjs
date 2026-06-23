#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const args=new Map(process.argv.slice(2).map((a)=>{const [k,...r]=a.split('=');return [k.replace(/^--/,''),r.length?r.join('='):'true'];}));
const root=path.resolve(args.get('root')||process.cwd());
const zip=path.resolve(args.get('zip')||'');
const full=path.resolve(args.get('full')||'');
const report=path.resolve(args.get('report')||'');
const expected=[
'3DGallery_CHANGED_FILES_v6.14.066.026_CMS_TRUE_MUTATED_PARENT_ACCEPTANCE_META_GUARD_MUTATION_SQL_RAISE_CONTROL_FLOW_ACTUAL_MIGRATION_ORDER_AND_COMPLETE_ROOT_CLEANUP_HOTFIX_APPLY.zip',
'APPLY_REPORT_v6.14.066.026_CMS_TRUE_MUTATED_PARENT_ACCEPTANCE_META_GUARD_MUTATION_SQL_RAISE_CONTROL_FLOW_ACTUAL_MIGRATION_ORDER_AND_COMPLETE_ROOT_CLEANUP_HOTFIX_APPLY.md',
'FULL_CHANGED_CODE_v6.14.066.026_CMS_TRUE_MUTATED_PARENT_ACCEPTANCE_META_GUARD_MUTATION_SQL_RAISE_CONTROL_FLOW_ACTUAL_MIGRATION_ORDER_AND_COMPLETE_ROOT_CLEANUP_HOTFIX_APPLY.md'];
function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
function parseBlocks(text){const fence='`'.repeat(3); const re=new RegExp(`${fence}(?:javascript|json|text)?\\s+path=\"([^\"]+)\"\\n([\\s\\S]*?)${fence}`,'g'); const map=new Map(); let m; while((m=re.exec(text))) map.set(m[1],Buffer.from(m[2],'utf8')); return map;}
const assertions=[]; const add=(id,pass,msg='')=>assertions.push({id,pass:Boolean(pass),message:msg});
add('ARTIFACT_FILENAMES_EXACT', [path.basename(zip),path.basename(report),path.basename(full)].every((n,i)=>n===expected[i]), [path.basename(zip),path.basename(report),path.basename(full)].join('|'));
const list=spawnSync('unzip',['-Z1',zip],{encoding:'utf8'}); const files=list.status===0?list.stdout.trim().split(/\n/).filter(Boolean).sort():[]; add('ZIP_LIST_READABLE', list.status===0, list.stderr||'');
const blocks=parseBlocks(fs.existsSync(full)?fs.readFileSync(full,'utf8'):''); add('FULL_CHANGED_CODE_BLOCK_COUNT_MATCHES_ZIP', blocks.size===files.length, `${blocks.size}/${files.length}`);
let allEqual=true; const rows=[]; for(const f of files){const bytes=spawnSync('unzip',['-p',zip,f],{encoding:null}).stdout; const b=blocks.get(f); const equal=Boolean(b&&Buffer.compare(bytes,b)===0); if(!equal) allEqual=false; rows.push({relativePath:f, byteLength:bytes.length, sha256:sha(bytes), trailingNewline:bytes.length?bytes[bytes.length-1]===10:false, byteEqual:equal});}
add('FULL_CHANGED_CODE_BYTE_EXACT', allEqual, JSON.stringify(rows.filter(r=>!r.byteEqual)));
add('ZIP_HYGIENE_NO_FORBIDDEN_PATHS', files.every(f=>!/(^|\/)(\.env|\.git|node_modules|reports|backup|backups)(\/|$)|\.zip$/i.test(f)), files.join('|'));
const result={assertions, files:rows, passCount:assertions.filter(a=>a.pass).length, failCount:assertions.filter(a=>!a.pass).length, totalCount:assertions.length};
console.log(JSON.stringify(result,null,2)); process.exit(result.failCount?1:0);
