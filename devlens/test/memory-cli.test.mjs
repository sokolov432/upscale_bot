import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {remember,readMemory,lookup} from '../memory-cli.mjs';
const CA='7Ad8WyDQRgUwYFg4bWTp4jxhuXaJEKEDtrXU8peoqqXw',OLD='BPGA2Yg7sqNkWXzUnsWGpVjCkD6sSVBQDyvgDQJepump',DEV='H95LimAz4QrZDimxDi4GbQykX8t3NTcpHJhrnA338vrQ';
test('private catalogue survives rereads and merges snapshots; malformed input cannot erase saved cases',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'devlens-private-memory-')),file=path.join(dir,'book.json');
 try{
  assert.equal((await readMemory(file)).cases.length,0);
  await remember([{mint:OLD,creator:DEV},{mint:CA,funding:[{address:DEV,service:true}],twitter:'https://x.com/testprofile'}],file);
  await remember([{mint:CA,funding:[{address:DEV,service:false}],coverage:{funding:true},observedAt:Date.now()+100}],file);
  assert.equal((await readMemory(file)).cases.length,2);assert.equal((await lookup(CA,file)).known.funding[0].service,true);assert.equal((await lookup(CA,file)).matches.length,0);
  await assert.rejects(remember([{mint:'invalid'}],file));assert.equal((await readMemory(file)).cases.length,2);
  await remember({version:1,cases:[],links:[{a:CA,b:OLD,decision:'rejected',updatedAt:2000}]},file);
  await remember({version:1,cases:[],links:[{a:CA,b:OLD,decision:'confirmed',updatedAt:1000}]},file);
  assert.equal((await readMemory(file)).links[0].decision,'rejected');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
