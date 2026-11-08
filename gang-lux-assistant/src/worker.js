import { ask, ServiceError, boundedJSON, apiJSON } from './core.js';
import { localDemo, webAccess, telegramAccess, secretEqual } from './auth.js';
import { demoCards, demoSelect } from './demo.js';
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
 if (!telegramAccess(message,env)) return json({ok:true}); // No API or model access for outsiders.
 if (typeof message.text !== 'string') return json({ok:true});
 if (!env.TELEGRAM_BOT_TOKEN) throw new ServiceError('NOT_CONFIGURED');
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
   if (!await webAccess(request,env)) return json({error:'FORBIDDEN',message:'Доступ только для сотрудников. Войдите через Cloudflare Access.'},403);
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
