import { ask, ServiceError, boundedJSON, apiJSON, diagnoseModel } from './core.js';
import { localDemo, webAccess, telegramAccess, secretEqual } from './auth.js';
import { demoCards, demoSelect } from './demo.js';
import { sharedToken, validSharedToken } from './shared-access.js';
const headers = { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer', 'X-Frame-Options':'DENY', 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'" };
const json = (data,status=200) => Response.json(data,{status,headers});
async function runQuestion(q,env,demo) {
 return ask(q,env,demo ? {cards:demoCards,select:demoSelect} : {});
}
export function telegramText(result,question) {
 const sources = result.sources.map(s=>result.kind==='answer' && s.url ? `Источник: ${s.url}` : `• ${s.title}${s.url ? `\n${s.url}` : ''}`).join('\n');
 return `${result.text}${sources?'\n\n'+sources:''}${result.kind==='clarify'?'\n\nВопрос: '+question:''}`;
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
 if (!message || !Number.isSafeInteger(message.from?.id) || !Number.isSafeInteger(message.chat?.id) || typeof message.text !== 'string') return json({ok:true});
 if (!env.TELEGRAM_BOT_TOKEN) throw new ServiceError('NOT_CONFIGURED');
 const isGroup = ['group','supergroup'].includes(message.chat.type);
 const parsedCommand = /^\/(ask|chatid)(?:@([A-Za-z0-9_]+))?(?:\s+|$)/i.exec(message.text);
 const commandTargetsBot = !parsedCommand?.[2] || (env.TELEGRAM_BOT_USERNAME && parsedCommand[2].toLowerCase() === env.TELEGRAM_BOT_USERNAME.toLowerCase());
 const setupCommand = commandTargetsBot && parsedCommand?.[1].toLowerCase() === 'chatid';
 if (isGroup && setupCommand) {
  // Telegram can change the group ID during migration to a supergroup.
  // Only a current group administrator may ask the bot to show that group's ID.
  try {
   const member=await apiJSON(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:message.chat.id,user_id:message.from.id})});
   if (!member.ok || !['creator','administrator'].includes(member.result?.status)) return json({ok:true});
   const sent=await apiJSON(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:message.chat.id,text:`ID этой группы: ${message.chat.id}`})});
   if (!sent.ok) throw new ServiceError('UPSTREAM_UNAVAILABLE');
   return json({ok:true});
  } catch { return json({ok:true}); }
 }
 // Personal chats use Telegram group membership, queried for every request.
 // The group is the source of access; no list or employee database is kept here.
 const privateChat = message.chat.type === 'private' && message.chat.id === message.from.id;
 if (!privateChat) return json({ok:true});
 const legacyAllowed = env.ACCESS_MODE === 'legacy' && telegramAccess(message,env);
 if (env.ACCESS_MODE === 'legacy' && !legacyAllowed) return json({ok:true});
 if (!legacyAllowed) {
  let authorized = false;
  let verificationFailed = false;
  if (!/^-\d+$/.test(env.TELEGRAM_GROUP_ID || '')) verificationFailed = true;
  else try {
   const member=await apiJSON(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:env.TELEGRAM_GROUP_ID,user_id:message.from.id})});
   if (!member.ok || typeof member.result?.status !== 'string') verificationFailed = true;
   else authorized = ['creator','administrator','member'].includes(member.result.status) || (member.result.status === 'restricted' && member.result.is_member === true);
  } catch { verificationFailed = true; }
  if (!authorized) {
   const text = verificationFailed ? 'Не удалось проверить доступ. Попросите владельца проверить настройки группы и права бота.' : 'Доступ только для сотрудников. Попросите владельца добавить вас в группу школы.';
   const sent=await apiJSON(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:message.chat.id,text})});
   if (!sent.ok) throw new ServiceError('UPSTREAM_UNAVAILABLE');
   return json({ok:true});
  }
 }
 if (/^\/start(?:\s|$)/i.test(message.text)) {
  const sent=await apiJSON(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:message.chat.id,text:'Здравствуйте! Напишите ваш вопрос обычными словами.'})});
  if (!sent.ok) throw new ServiceError('UPSTREAM_UNAVAILABLE');
  return json({ok:true});
 }
 let result;
 try { result = await runQuestion(telegramQuestion(message,env),env,false); }
 catch { result = {kind:'unavailable',text:'Справочник временно недоступен. Попробуйте позже или обратитесь к старшему администратору.',sources:[]}; }
 const body = {chat_id:message.chat.id,text:telegramText(result,message.text),link_preview_options:{is_disabled:true},...(Number.isSafeInteger(message.message_id)?{reply_parameters:{message_id:message.message_id}}:{}),...(result.kind==='clarify'?{reply_markup:{force_reply:true,selective:true}}:{})};
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
   if (url.pathname === '/join' && request.method === 'GET') return new Response('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Вход в справочник</title><body><main><h1>Вход в справочник</h1><p id="status">Проверяем приглашение…</p></main><link rel="stylesheet" href="/manage.css"><script src="/join.js" defer></script></body></html>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
   if (['/join.js','/manage','/manage.js','/manage.css'].includes(url.pathname) && request.method === 'GET') { const a=await env.ASSETS.fetch(request); const out=new Response(a.body,a); for(const [k,v] of Object.entries(headers)) out.headers.set(k,v); return out; }
   if (url.pathname === '/api/redeem' && request.method === 'POST') {
    if (request.headers.get('Origin') !== url.origin || !request.headers.get('Content-Type')?.startsWith('application/json')) return json({error:'FORBIDDEN'},403);
    const data = await boundedJSON(request,2048); const valid = await validSharedToken(data.token,env.ADMIN_SECRET);
    if (!valid) return json({error:'INVALID_LINK'},403);
    return Response.json({ok:true,telegram_bot_username:env.TELEGRAM_BOT_USERNAME || ''},{headers:{...headers,'Set-Cookie':`__Host-gang_session=${data.token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=31536000`}});
   }
   if (url.pathname.startsWith('/admin/')) {
    const bearer=request.headers.get('Authorization') || '';
    if (!env.ADMIN_SECRET || env.ADMIN_SECRET.length < 32 || !await secretEqual(bearer.startsWith('Bearer ') ? bearer.slice(7) : '',env.ADMIN_SECRET)) return json({error:'FORBIDDEN'},403);
    if (request.method === 'GET' && url.pathname === '/admin/check-model') return json(await diagnoseModel(env));
    if (request.method === 'GET' && url.pathname === '/admin/shared-link') { const token=await sharedToken(env.ADMIN_SECRET); return token ? json({token}) : json({error:'NOT_CONFIGURED'},503); }
    if (request.method === 'POST' && url.pathname === '/admin/connect-telegram') {
     if (url.protocol !== 'https:' || request.headers.get('Origin') !== url.origin) return json({error:'FORBIDDEN'},403);
     if (!env.TELEGRAM_BOT_TOKEN || !/^[A-Za-z0-9_-]{32,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET || '')) return json({error:'NOT_CONFIGURED'},503);
     const endpoint=`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/`;
     const info=await apiJSON(endpoint+'getWebhookInfo',{});
     if (!info.ok || typeof info.result?.url !== 'string') throw new ServiceError('UPSTREAM_UNAVAILABLE');
     const target=new URL('/telegram/webhook',url.origin).href;
     if (info.result.url && info.result.url !== target) return json({error:'WEBHOOK_IN_USE',message:'Бот уже подключён к другому сервису. Его настройки не изменены.'},409);
     const me=await apiJSON(endpoint+'getMe',{});
     if (!me.ok || !/^[A-Za-z0-9_]{5,32}$/.test(me.result?.username || '')) throw new ServiceError('UPSTREAM_UNAVAILABLE');
     const result=await apiJSON(endpoint+'setWebhook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:target,secret_token:env.TELEGRAM_WEBHOOK_SECRET,allowed_updates:['message'],max_connections:1})});
     if (!result.ok) throw new ServiceError('UPSTREAM_UNAVAILABLE');
     return json({ok:true,bot_username:me.result.username});
    }

    return json({error:'NOT_FOUND'},404);
   }
   const cookie=(request.headers.get('Cookie') || '').split(';').map(x=>x.trim()).find(x=>x.startsWith('__Host-gang_session='))?.slice('__Host-gang_session='.length);
   const allowed=env.ACCESS_MODE === 'legacy' ? await webAccess(request,env) : await validSharedToken(cookie,env.ADMIN_SECRET);
   if (!allowed && !localDemo(request,env)) return json({error:'FORBIDDEN',message:'Доступ только по ссылке школы. Обратитесь к владельцу.'},403);
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
