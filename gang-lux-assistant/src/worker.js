import { ask, ServiceError, boundedJSON, apiJSON } from './core.js';
import { localDemo, webAccess, telegramAccess, secretEqual } from './auth.js';
import { demoCards, demoSelect } from './demo.js';
import { createInvitation, redeemWeb, redeemTelegram, validWebSession, isTelegramMember, revokeAccess } from './invitations.js';
const headers = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };
const json = (data,status=200) => Response.json(data,{status,headers});
async function runQuestion(q,env,demo) {
 return ask(q,env,demo ? {cards:demoCards,select:demoSelect} : {});
}
export function telegramText(result,question) {
 const sources = result.sources.map(s=>`• ${s.title}${s.url ? `\n${s.url}` : ''}`).join('\n');
 return `${result.text}${result.degraded?'\n\nМодель недоступна; найдено точное совпадение в справочнике.':''}${sources?'\n\n'+sources:''}${result.kind==='clarify'?'\n\nВопрос: '+question:''}`;
}
export function telegramQuestion(message,env) {
 let q = message.text;
 const reply = message.reply_to_message;
 if (reply?.from?.id === Number(env.TELEGRAM_BOT_TOKEN?.split(':')[0]) && reply.text?.includes('\n\nВопрос: ')) {
  const original = reply.text.split('\n\nВопрос: ').at(-1);
  q = original + '\nУточнение: ' + q;
 }
 return q;
}
async function telegram(request,env) {
 if (!await secretEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),env.TELEGRAM_WEBHOOK_SECRET)) return json({error:'FORBIDDEN'},403);
 const update = await boundedJSON(request,20000);
 const message = update.message;
 if (!message || message.chat?.type !== 'private' || !Number.isSafeInteger(message.from?.id) || message.chat.id !== message.from.id || typeof message.text !== 'string') return json({ok:true});
 if (!env.TELEGRAM_BOT_TOKEN) throw new ServiceError('NOT_CONFIGURED');
 const match = /^\/start\s+([A-Za-z0-9_-]{43})$/.exec(message.text);
 if (match && env.ACCESS_DB) {
  const accepted = await redeemTelegram(env.ACCESS_DB, match[1], message.from.id);
  const sent = await apiJSON(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:message.chat.id,text:accepted?'Доступ открыт. Задайте ваш вопрос.':'Ссылка недействительна, уже использована или срок её действия истёк.'})});
  if (!sent.ok) throw new ServiceError('UPSTREAM_UNAVAILABLE');
  return json({ok:true});
 }
 if (env.ACCESS_DB ? !await isTelegramMember(env.ACCESS_DB,message.from.id) : !(env.ACCESS_MODE === 'legacy' && telegramAccess(message,env))) return json({ok:true});
 let result;
 try { result = await runQuestion(telegramQuestion(message,env),env,false); }
 catch { result = {kind:'unavailable',text:'Справочник временно недоступен. Попробуйте позже или обратитесь к старшему администратору.',sources:[]}; }
 const body = {chat_id:message.chat.id,text:telegramText(result,message.text),link_preview_options:{is_disabled:true},...(result.kind==='clarify'?{reply_markup:{force_reply:true,selective:true}}:{})};
 // Await send success before ACK so Telegram can retry failures. Duplicate delivery is possible.
 const sent = await apiJSON(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 if (!sent.ok) throw new ServiceError('UPSTREAM_UNAVAILABLE');
 return json({ok:true});
}
export default {
 async fetch(request,env) {
  const url = new URL(request.url);
  try {
   if (url.pathname === '/health' && request.method === 'GET') return json({ok:true});
   if (url.pathname === '/telegram/webhook' && request.method === 'POST') return await telegram(request,env);
   if (url.pathname === '/join' && request.method === 'GET') return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Вход в справочник</title><body><main><h1>Вход в справочник</h1><p id="status">Проверяем приглашение…</p></main><script src="/join.js" defer></script></body></html>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
   if (['/join.js','/manage','/manage.js','/manage.css'].includes(url.pathname) && request.method === 'GET') { const a=await env.ASSETS.fetch(request); const out=new Response(a.body,a); for(const [k,v] of Object.entries(headers)) out.headers.set(k,v); return out; }
   if (url.pathname === '/api/redeem' && request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'FORBIDDEN'},403);
    const data = await boundedJSON(request,2048); const session = await redeemWeb(env.ACCESS_DB,data.token);
    if (!session) return json({error:'INVALID_INVITATION'},403);
    return Response.json({ok:true},{headers:{...headers,'Set-Cookie':`__Host-gang_session=${session}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=2592000`}});
   }
   if (url.pathname.startsWith('/admin/')) {
    const bearer=request.headers.get('Authorization') || '';
    if (!env.ADMIN_SECRET || env.ADMIN_SECRET.length < 32 || !await secretEqual(bearer.startsWith('Bearer ') ? bearer.slice(7) : '',env.ADMIN_SECRET) || !env.ACCESS_DB) return json({error:'FORBIDDEN'},403);
    if (request.method === 'GET' && url.pathname === '/admin/settings') return json({telegram_bot_username:env.TELEGRAM_BOT_USERNAME || ''});
    if (request.method === 'POST' && url.pathname === '/admin/invitations') {
     const data=await boundedJSON(request,2048); if (!['web','telegram'].includes(data.channel)) return json({error:'INVALID_CHANNEL'},400);
     const invite=await createInvitation(env.ACCESS_DB,data.channel); return json(invite);
    }
    if (request.method === 'GET' && url.pathname === '/admin/access') {
     const web=await env.ACCESS_DB.prepare('SELECT session_hash, created_at, expires_at FROM web_sessions WHERE expires_at > ?').bind(Date.now()).all();
     const telegram=await env.ACCESS_DB.prepare('SELECT telegram_id, created_at FROM telegram_members').all();
     return json({web:web.results,telegram:telegram.results});
    }
    if (request.method === 'POST' && url.pathname === '/admin/revoke') { const data=await boundedJSON(request,2048); await revokeAccess(env.ACCESS_DB,data.channel,data.id); return json({ok:true}); }
    return json({error:'NOT_FOUND'},404);
   }
   const cookie=(request.headers.get('Cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-gang_session='))?.slice('__Host-gang_session='.length);
   const allowed=env.ACCESS_DB ? await validWebSession(env.ACCESS_DB,cookie) : (env.ACCESS_MODE === 'legacy' && await webAccess(request,env));
   if (!allowed && !localDemo(request,env)) return json({error:'FORBIDDEN',message:'Доступ только по приглашению. Обратитесь к владельцу.'},403);
   if (url.pathname === '/api/session' && request.method === 'GET') return json({demo:localDemo(request,env)});
   if (url.pathname === '/api/ask' && request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'FORBIDDEN'},403);
    const data = await boundedJSON(request,8000);
    const result = await runQuestion(data.question,env,localDemo(request,env));
    return json(result,result.kind === 'unavailable' ? 503 : 200);
   }
   if (url.pathname.startsWith('/api/') || !['GET','HEAD'].includes(request.method)) return json({error:'NOT_FOUND'},404);
   const asset = await env.ASSETS.fetch(request);
   const response = new Response(asset.body,asset); for (const [key,value] of Object.entries(headers)) response.headers.set(key,value);
   return response;
  } catch (error) {
   // Never log request, URL, identity, question, card, upstream body or error message.
   const code = error instanceof ServiceError ? error.code : 'INTERNAL_ERROR';
   console.error(JSON.stringify({event:'request_failed',code}));
   return json({error:code,message:'Не удалось обработать запрос. Попробуйте ещё раз.'},error instanceof ServiceError?error.status:500);
  }
 }
};
