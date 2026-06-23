#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
const args=new Map(process.argv.slice(2).map(arg=>{ const [k,...rest]=arg.split('='); return [k.replace(/^--/,''), rest.length?rest.join('='):'true']; }));
const zipPath=path.resolve(args.get('zip') || '');
const fullPath=path.resolve(args.get('full') || '');
const resultFile=args.get('result-file') ? path.resolve(args.get('result-file')) : '';
function sha(b){return crypto.createHash('sha256').update(b).digest('hex');}
function add(assertions,id,pass,msg=''){assertions.push({id,pass:Boolean(pass),message:String(msg||'')});}
function zipList(zip){ const p=spawnSync('unzip',['-Z1',zip],{encoding:'utf8'}); if(p.status!==0) throw new Error(p.stderr); return p.stdout.split(/\r?\n/).filter(Boolean); }
function zipRead(zip,rel){ const p=spawnSync('unzip',['-p',zip,rel],{encoding:null,maxBuffer:50*1024*1024}); if(p.status!==0) throw new Error(String(p.stderr)); return p.stdout; }
function parseBlocks(text){
  const blocks={};
  const lines=text.split(/\n/);
  for(let i=0;i<lines.length;i++){
    const m=lines[i].match(/^```(?:javascript|json|text)?\s+path="([^"]+)"\s*$/);
    if(!m) continue;
    const rel=m[1];
    const collected=[];
    i++;
    while(i<lines.length && lines[i] !== '```') { collected.push(lines[i]); i++; }
    blocks[rel]=Buffer.from(collected.join('\n') + '\n','utf8');
  }
  return blocks;
}
const assertions=[]; const records=[];
try{
  add(assertions,'ZIP_PRESENT',fs.existsSync(zipPath),zipPath);
  add(assertions,'FULL_CHANGED_CODE_PRESENT',fs.existsSync(fullPath),fullPath);
  const names=zipList(zipPath);
  const blocks=parseBlocks(fs.readFileSync(fullPath,'utf8'));
  add(assertions,'ZIP_NO_NESTED_ZIP',!names.some(n=>/\.zip$/i.test(n)),names.join(','));
  for(const rel of names){
    const bytes=zipRead(zipPath,rel);
    const block=blocks[rel];
    const rec={relativePath:rel,byteLength:bytes.length,sha256:sha(bytes),trailingNewline:bytes.length?bytes[bytes.length-1]===10:false,blockPresent:Boolean(block),byteEqual:Boolean(block && Buffer.compare(bytes,block)===0),blockSha256:block?sha(block):''};
    records.push(rec); add(assertions,`BYTE_EQUAL_${rel}`,rec.byteEqual,`${rec.sha256} ${rec.blockSha256}`);
  }
  add(assertions,'NO_EXTRA_BLOCKS',Object.keys(blocks).every(k=>names.includes(k)),Object.keys(blocks).filter(k=>!names.includes(k)).join(','));
}catch(err){ add(assertions,'ARTIFACT_VERIFIER_EXCEPTION',false,err.stack||err.message); }
const passCount=assertions.filter(a=>a.pass).length, failCount=assertions.filter(a=>!a.pass).length; const result={records,assertions,passCount,failCount,totalCount:assertions.length};
if(resultFile){fs.mkdirSync(path.dirname(resultFile),{recursive:true});fs.writeFileSync(resultFile,JSON.stringify(result,null,2));}
console.log(JSON.stringify(result,null,2)); process.exit(failCount?1:0);
