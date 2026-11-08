import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createInvitation, consumeInvitation, redeemWeb, redeemTelegram, validWebSession, isTelegramMember, revokeAccess } from '../src/invitations.js';
function database() {
 const sql = new DatabaseSync(':memory:');
 sql.exec(readFileSync(new URL('../migrations/0001_invitations.sql', import.meta.url),'utf8'));
 const db = { sql, prepare(query) { return { bind(...args) { return { async run() { const result=sql.prepare(query).run(...args); return { meta: { changes:Number(result.changes) } }; }, async first() { return sql.prepare(query).get(...args) ?? null; }, async all() { return {results:sql.prepare(query).all(...args)}; } }; } }; }, async batch(statements) { sql.exec('BEGIN'); try { const results=[]; for (const statement of statements) results.push(await statement.run()); sql.exec('COMMIT'); return results; } catch(e) { sql.exec('ROLLBACK'); throw e; } } }; return db;
}
test('invitation is random, stored as a hash and usable only once', async () => {
 const db = database(); const a = await createInvitation(db, 'web', 1000); const b = await createInvitation(db, 'web', 1000);
 assert.notEqual(a.token,b.token); assert.equal(a.token.length,43);
 assert.equal(db.sql.prepare('SELECT token_hash FROM invitations WHERE token_hash = ?').get(a.token), undefined);
 assert.equal(await consumeInvitation(db,a.token,'web',1001),true);
 assert.equal(await consumeInvitation(db,a.token,'web',1002),false);
});
test('expired, malformed and wrong-channel invitations cannot be used', async () => {
 const db = database(); const a = await createInvitation(db,'telegram',1000);
 assert.equal(await consumeInvitation(db,a.token,'web',1001),false);
 assert.equal(await consumeInvitation(db,'invalid','telegram',1001),false);
 assert.equal(await consumeInvitation(db,a.token,'telegram',a.expires_at),false);
});

test('web: one-time session is revocable and limited to five', async () => {
 const db=database(); const a=await createInvitation(db,'web',1000); const session=await redeemWeb(db,a.token,1001);
 assert.ok(session); assert.equal(await validWebSession(db,session,1002),true); assert.equal(await redeemWeb(db,a.token,1002),null);
 const id=db.sql.prepare('SELECT session_hash FROM web_sessions').get().session_hash;
 await revokeAccess(db,'web',id); assert.equal(await validWebSession(db,session,1003),false);
 for(let i=0;i<5;i++){const invite=await createInvitation(db,'web',1000); assert.ok(await redeemWeb(db,invite.token,1002));}
 const extra=await createInvitation(db,'web',1000); assert.equal(await redeemWeb(db,extra.token,1002),null);
});
test('telegram: redemption associates one numeric ID and revocation blocks it', async () => {
 const db=database(); const invite=await createInvitation(db,'telegram',1000);
 assert.equal(await redeemTelegram(db,invite.token,'12',1001),true); assert.equal(await isTelegramMember(db,'12'),true);
 assert.equal(await redeemTelegram(db,invite.token,'13',1002),false); await revokeAccess(db,'telegram','12'); assert.equal(await isTelegramMember(db,'12'),false);
});
test('Worker: admin issues invitation, only same-origin redeem works, and revoked session is denied', async () => {
 const { default: worker }=await import('../src/worker.js');const db=database();const env={ACCESS_DB:db, ADMIN_SECRET:'test-admin-secret-with-32-chars-12345',APP_MODE:'production',ASSETS:{fetch:async()=>new Response('asset')}};
 const call=(path,init={})=>worker.fetch(new Request('https://assistant.example'+path,init),env);
 assert.equal((await call('/admin/invitations',{method:'POST',body:'{}'})).status,403);
 const issue=await call('/admin/invitations',{method:'POST',headers:{Authorization:'Bearer test-admin-secret-with-32-chars-12345','Content-Type':'application/json'},body:JSON.stringify({channel:'web'})});assert.equal(issue.status,200);const {token}=await issue.json();
 const body=JSON.stringify({token});const headers={'Content-Type':'application/json',Origin:'https://evil.example'};
 assert.equal((await call('/api/redeem',{method:'POST',headers,body})).status,403);
 headers.Origin='https://assistant.example';const accept=await call('/api/redeem',{method:'POST',headers,body});assert.equal(accept.status,200);
 const cookie=accept.headers.get('set-cookie');assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);
 assert.equal((await call('/api/redeem',{method:'POST',headers,body})).status,403);
 assert.equal((await call('/api/session',{headers:{Cookie:cookie.split(';')[0]}})).status,200);
 const sessionId=db.sql.prepare('SELECT session_hash FROM web_sessions').get().session_hash;
 await call('/admin/revoke',{method:'POST',headers:{Authorization:'Bearer test-admin-secret-with-32-chars-12345'},body:JSON.stringify({channel:'web',id:sessionId})});
 assert.equal((await call('/api/session',{headers:{Cookie:cookie.split(';')[0]}})).status,403);
});
test('Worker: no D1 binding denies access by default, including bogus cookie and Telegram user',async()=>{
 const {default:worker}=await import('../src/worker.js');const env={APP_MODE:'production',TELEGRAM_WEBHOOK_SECRET:'secret',TELEGRAM_ALLOWED_IDS:'123',TELEGRAM_BOT_TOKEN:'789:fake'};
 assert.equal((await worker.fetch(new Request('https://assistant.example/api/session',{headers:{Cookie:'__Host-gang_session=fake'}}),env)).status,403);
 const request=new Request('https://assistant.example/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'secret'},body:JSON.stringify({message:{from:{id:123},chat:{id:123,type:'private'},text:'test'}})});
 assert.equal((await worker.fetch(request,env)).status,200);
});
test('Telegram webhook activates only valid invitation and then answers an authorized member',async(t)=>{
 const {default:worker}=await import('../src/worker.js');const db=database();const sent=[];
 const env={ACCESS_DB:db,APP_MODE:'production',TELEGRAM_WEBHOOK_SECRET:'test-webhook',TELEGRAM_BOT_TOKEN:'789:fake',NOTION_TOKEN:'fake',NOTION_DATA_SOURCE_ID:'fake'};
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).includes('api.telegram.org')){sent.push(JSON.parse(init.body));return Response.json({ok:true});}
  if(String(url).includes('api.notion.com'))return Response.json({results:[],has_more:false});
  assert.fail('unexpected upstream');
 });
 const send=async(id,text)=>worker.fetch(new Request('https://assistant.example/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'test-webhook'},body:JSON.stringify({message:{from:{id},chat:{id,type:'private'},text}})}),env);
 await send(123,'Привет');assert.equal(sent.length,0);
 const invite=await createInvitation(db,'telegram');await send(123,`/start ${invite.token}`);assert.match(sent[0].text,/Доступ открыт/);
 await send(124,`/start ${invite.token}`);assert.match(sent[1].text,/недействительна/);assert.equal(await isTelegramMember(db,124),false);
 await send(123,'Какой график?');assert.match(sent[2].text,/нет подтверждённого ответа/);
 await revokeAccess(db,'telegram','123');await send(123,'Какой график?');assert.equal(sent.length,3);
});
