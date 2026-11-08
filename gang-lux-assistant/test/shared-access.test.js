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
test('Telegram personal chat accepts plain questions only from current group members',async(t)=>{
 const {default:worker}=await import('../src/worker.js');const sent=[];let notion=0;let status='member';let isMember;let fail=false;
 const env={APP_MODE:'production',ADMIN_SECRET:secret,TELEGRAM_GROUP_ID:'-100123',TELEGRAM_BOT_USERNAME:'example_bot',TELEGRAM_WEBHOOK_SECRET:'test-webhook',TELEGRAM_BOT_TOKEN:'789:fake',NOTION_TOKEN:'fake',NOTION_DATA_SOURCE_ID:'fake'};
 t.mock.method(globalThis,'fetch',async(url,init)=>{const u=String(url);if(u.endsWith('/getChatMember')){assert.deepEqual(JSON.parse(init.body),{chat_id:'-100123',user_id:123});if(fail)throw Error('unavailable');return Response.json({ok:true,result:{status,is_member:isMember}});}if(u.endsWith('/sendMessage')){sent.push(JSON.parse(init.body));return Response.json({ok:true});}if(u.includes('api.notion.com')){notion++;return Response.json({results:[],has_more:false});}assert.fail('unexpected upstream');});
 const send=async(chat,type,text)=>worker.fetch(new Request('https://assistant.example/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'test-webhook'},body:JSON.stringify({message:{from:{id:123},chat:{id:chat,type},text}})}),env);
 await send(-100123,'supergroup','/ask Вопрос');assert.equal(sent.length,0);assert.equal(notion,0);
 await send(123,'private','Что входит в категорию A?');assert.match(sent.at(-1).text,/нет подтверждённого ответа/);assert.equal(notion,1);
 for(const bad of ['left','kicked']){status=bad;await send(123,'private','Вопрос');assert.match(sent.at(-1).text,/Доступ только для сотрудников/);assert.equal(notion,1);}
 status='restricted';isMember=false;await send(123,'private','Вопрос');assert.match(sent.at(-1).text,/Доступ только для сотрудников/);assert.equal(notion,1);
 isMember=true;await send(123,'private','Вопрос');assert.equal(notion,2);
 fail=true;await send(123,'private','Вопрос');assert.match(sent.at(-1).text,/Не удалось проверить доступ/);assert.equal(notion,2);
});
test('administrator can recover new group ID after migration; ordinary member cannot',async(t)=>{
 const {default:worker}=await import('../src/worker.js');let body;let role='administrator';
 t.mock.method(globalThis,'fetch',async(url,init)=>{const u=String(url);if(u.endsWith('/getChatMember'))return Response.json({ok:true,result:{status:role}});if(u.endsWith('/sendMessage')){body=JSON.parse(init.body);return Response.json({ok:true});}assert.fail('unexpected upstream');});
 const req=()=>new Request('https://assistant.example/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'test-webhook'},body:JSON.stringify({message:{from:{id:123},chat:{id:-100456,type:'supergroup'},text:'/chatid@example_bot'}})});
 const env={TELEGRAM_WEBHOOK_SECRET:'test-webhook',TELEGRAM_BOT_TOKEN:'789:fake',TELEGRAM_GROUP_ID:'-100000',TELEGRAM_BOT_USERNAME:'example_bot'};
 const r=await worker.fetch(req(),env);assert.equal(r.status,200);assert.match(body.text,/-100456/);
 role='member';body=null;await worker.fetch(req(),env);assert.equal(body,null);
});
test('bad origin or absent owner secret denies link login',async()=>{
 const {default:worker}=await import('../src/worker.js');const token=await sharedToken(secret);const request=origin=>new Request('https://assistant.example/api/redeem',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:JSON.stringify({token})});
 assert.equal((await worker.fetch(request('https://evil.example'),{ADMIN_SECRET:secret})).status,403);
 assert.equal((await worker.fetch(request('https://assistant.example'),{})).status,403);
});
test('owner can connect webhook without exposing token or overwriting an unrelated webhook',async(t)=>{
 const {default:worker}=await import('../src/worker.js');let existing='';let setup=0;let sent;
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const u=String(url);if(u.endsWith('/getWebhookInfo'))return Response.json({ok:true,result:{url:existing}});
  if(u.endsWith('/getMe'))return Response.json({ok:true,result:{username:'example_bot'}});
  if(u.endsWith('/setWebhook')){setup++;sent=JSON.parse(init.body);return Response.json({ok:true,result:true});}
  assert.fail('unexpected upstream');
 });
 const env={ADMIN_SECRET:secret,TELEGRAM_BOT_TOKEN:'123:fake',TELEGRAM_WEBHOOK_SECRET:'test-webhook-secret-32-characters-long'};
 const call=(key,origin='https://assistant.example')=>worker.fetch(new Request('https://assistant.example/admin/connect-telegram',{method:'POST',headers:{Authorization:`Bearer ${key}`,Origin:origin}}),env);
 assert.equal((await call('wrong')).status,403);assert.equal((await call(secret,'https://other.example')).status,403);assert.equal(setup,0);
 existing='https://other-service.example/hook';assert.equal((await call(secret)).status,409);assert.equal(setup,0);
 existing='';const result=await call(secret);assert.equal(result.status,200);assert.deepEqual(await result.json(),{ok:true,bot_username:'example_bot'});
 assert.equal(sent.url,'https://assistant.example/telegram/webhook');assert.equal(sent.secret_token,env.TELEGRAM_WEBHOOK_SECRET);assert.equal(setup,1);
});
