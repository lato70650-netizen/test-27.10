import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { sharedToken, validSharedToken, registerTelegram, telegramAllowed } from '../src/shared-access.js';
const secret='test-owner-key-with-at-least-32-chars-123';
function database(){const sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../migrations/0001_shared_access.sql',import.meta.url),'utf8'));return {sql,prepare(q){return {bind(...args){return {async run(){const r=sql.prepare(q).run(...args);return {meta:{changes:Number(r.changes)}};},async first(){return sql.prepare(q).get(...args)??null;}};}};}};}
test('one stable link may be reused; changing owner secret changes link',async()=>{
 const token=await sharedToken(secret);assert.equal(token.length,43);assert.equal(await sharedToken(secret),token);assert.equal(await validSharedToken(token,secret),true);assert.equal(await validSharedToken('invalid',secret),false);assert.equal(await validSharedToken(token,secret+'other'),false);assert.equal(await sharedToken('short'),null);
});
test('Telegram access persists for shared link; secret rotation revokes prior access',async()=>{
 const db=database();assert.equal(await registerTelegram(db,123,secret),true);assert.equal(await telegramAllowed(db,123,secret),true);assert.equal(await telegramAllowed(db,123,secret+'other'),false);assert.equal(await telegramAllowed(db,124,secret),false);assert.equal(await registerTelegram(db,123,secret+'other'),true);assert.equal(await telegramAllowed(db,123,secret+'other'),true);
});
test('Worker shared link grants multiple web sessions and rotation revokes them',async()=>{
 const {default:worker}=await import('../src/worker.js');const db=database();const env={ACCESS_DB:db,ADMIN_SECRET:secret,APP_MODE:'production',TELEGRAM_BOT_USERNAME:'test_bot'};
 const call=(path,init={})=>worker.fetch(new Request('https://assistant.example'+path,init),env);
 assert.equal((await call('/admin/shared-link')).status,403);
 const response=await call('/admin/shared-link',{headers:{Authorization:`Bearer ${secret}`}});assert.equal(response.status,200);const {token}=await response.json();
 const headers={'Content-Type':'application/json',Origin:'https://assistant.example'};const body=JSON.stringify({token});
 const first=await call('/api/redeem',{method:'POST',headers,body});const second=await call('/api/redeem',{method:'POST',headers,body});assert.equal(first.status,200);assert.equal(second.status,200);
 const cookie=first.headers.get('set-cookie');assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);assert.equal((await call('/api/session',{headers:{Cookie:cookie.split(';')[0]}})).status,200);
 env.ADMIN_SECRET=secret+'rotated';assert.equal((await call('/api/session',{headers:{Cookie:cookie.split(';')[0]}})).status,403);
 assert.equal((await call('/api/redeem',{method:'POST',headers,body})).status,403);
});
test('Telegram accepts the same shared link for two staff and denies outsiders and old links',async(t)=>{
 const {default:worker}=await import('../src/worker.js');const db=database();const sent=[];const env={ACCESS_DB:db,APP_MODE:'production',ADMIN_SECRET:secret,TELEGRAM_WEBHOOK_SECRET:'test-webhook',TELEGRAM_BOT_TOKEN:'789:fake',NOTION_TOKEN:'fake',NOTION_DATA_SOURCE_ID:'fake'};
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(String(url).includes('api.telegram.org')){sent.push(JSON.parse(init.body));return Response.json({ok:true});}if(String(url).includes('api.notion.com'))return Response.json({results:[],has_more:false});assert.fail('unexpected upstream');});
 const send=async(id,text)=>worker.fetch(new Request('https://assistant.example/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'test-webhook'},body:JSON.stringify({message:{from:{id},chat:{id,type:'private'},text}})}),env);
 await send(123,'Привет');assert.equal(sent.length,0);const token=await sharedToken(secret);
 await send(123,`/start ${token}`);await send(124,`/start ${token}`);assert.match(sent[0].text,/Доступ открыт/);assert.match(sent[1].text,/Доступ открыт/);
 await send(123,'Какой график?');assert.match(sent[2].text,/нет подтверждённого ответа/);
 env.ADMIN_SECRET=secret+'rotated';await send(123,'Какой график?');assert.equal(sent.length,3);
});
test('missing database or bad origin denies shared-link login',async()=>{
 const {default:worker}=await import('../src/worker.js');const token=await sharedToken(secret);const request=origin=>new Request('https://assistant.example/api/redeem',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({token})});
 assert.equal((await worker.fetch(request('https://evil.example'),{ADMIN_SECRET:secret})).status,403);
 assert.equal((await worker.fetch(request('https://assistant.example'),{ADMIN_SECRET:secret})).status,503);
});
