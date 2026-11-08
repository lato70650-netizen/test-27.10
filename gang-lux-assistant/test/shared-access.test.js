import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedToken, validSharedToken } from '../src/shared-access.js';
const secret='test-owner-key-with-at-least-32-chars-123';
test('one stable web link may be reused and changing key revokes it',async()=>{
 const token=await sharedToken(secret);assert.equal(token.length,43);assert.equal(await sharedToken(secret),token);assert.equal(await validSharedToken(token,secret),true);assert.equal(await validSharedToken('invalid',secret),false);assert.equal(await validSharedToken(token,secret+'other'),false);assert.equal(await sharedToken('short'),null);
});
test('Worker link grants multiple web sessions without D1 and key rotation revokes them',async()=>{
 const {default:worker}=await import('../src/worker.js');const env={ADMIN_SECRET:secret,APP_MODE:'production'};
 const call=(path,init={})=>worker.fetch(new Request('https://assistant.example'+path,init),env);
 assert.equal((await call('/admin/shared-link')).status,403);
 const response=await call('/admin/shared-link',{headers:{Authorization:`Bearer ${secret}`}});assert.equal(response.status,200);const {token}=await response.json();
 const headers={'Content-Type':'application/json',Origin:'https://assistant.example'};const body=JSON.stringify({token});
 const first=await call('/api/redeem',{method:'POST',headers,body});const second=await call('/api/redeem',{method:'POST',headers,body});assert.equal(first.status,200);assert.equal(second.status,200);
 const cookie=first.headers.get('set-cookie');assert.match(cookie,/Secure; HttpOnly; SameSite=Strict/);assert.equal((await call('/api/session',{headers:{Cookie:cookie.split(';')[0]}})).status,200);
 env.ADMIN_SECRET=secret+'rotated';assert.equal((await call('/api/session',{headers:{Cookie:cookie.split(';')[0]}})).status,403);assert.equal((await call('/api/redeem',{method:'POST',headers,body})).status,403);
});
test('Telegram responds only to allowed group commands and replies, not other groups or private messages',async(t)=>{
 const {default:worker}=await import('../src/worker.js');const sent=[];let notion=0;
 const env={APP_MODE:'production',ADMIN_SECRET:secret,TELEGRAM_GROUP_ID:'-100123',TELEGRAM_BOT_USERNAME:'example_bot',TELEGRAM_WEBHOOK_SECRET:'test-webhook',TELEGRAM_BOT_TOKEN:'789:fake',NOTION_TOKEN:'fake',NOTION_DATA_SOURCE_ID:'fake'};
 t.mock.method(globalThis,'fetch',async(url,init)=>{if(String(url).includes('api.telegram.org')){sent.push(JSON.parse(init.body));return Response.json({ok:true});}if(String(url).includes('api.notion.com')){notion++;return Response.json({results:[],has_more:false});}assert.fail('unexpected upstream');});
 const send=async(chat,type,text,reply)=>worker.fetch(new Request('https://assistant.example/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'test-webhook'},body:JSON.stringify({message:{from:{id:123},chat:{id:chat,type},text,reply_to_message:reply}})}),env);
 await send(-100999,'supergroup','/ask Вопрос');await send(123,'private','/ask Вопрос');await send(-100123,'supergroup','Обычная беседа');await send(-100123,'supergroup','/ask@another_bot Вопрос');assert.equal(sent.length,0);assert.equal(notion,0);
 await send(-100123,'supergroup','/ask@example_bot Какой график?');assert.match(sent[0].text,/нет подтверждённого ответа/);assert.equal(notion,1);
 await send(-100123,'supergroup','Категория Б',{from:{id:789},text:'Уточните\n\nВопрос: Как проходят занятия?'});assert.equal(sent.length,2);
});
test('chatid bootstrap reveals only its own group ID and never calls Notion',async(t)=>{
 const {default:worker}=await import('../src/worker.js');let body;
 t.mock.method(globalThis,'fetch',async(url,init)=>{assert.ok(String(url).includes('api.telegram.org'));body=JSON.parse(init.body);return Response.json({ok:true});});
 const request=new Request('https://assistant.example/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'test-webhook'},body:JSON.stringify({message:{from:{id:123},chat:{id:-100456,type:'supergroup'},text:'/chatid'}})});
 const r=await worker.fetch(request,{TELEGRAM_WEBHOOK_SECRET:'test-webhook',TELEGRAM_BOT_TOKEN:'789:fake'});assert.equal(r.status,200);assert.match(body.text,/-100456/);
});
test('bad origin or absent owner secret denies link login',async()=>{
 const {default:worker}=await import('../src/worker.js');const token=await sharedToken(secret);const request=origin=>new Request('https://assistant.example/api/redeem',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({token})});
 assert.equal((await worker.fetch(request('https://evil.example'),{ADMIN_SECRET:secret})).status,403);
 assert.equal((await worker.fetch(request('https://assistant.example'),{})).status,403);
});
