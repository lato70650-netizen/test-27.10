import { createRemoteJWKSet, jwtVerify } from 'jose';
export const list = value => String(value || '').split(',').map(s=>s.trim()).filter(Boolean);
export function localDemo(request,env) {
  const u = new URL(request.url);
  return env.APP_MODE === 'demo' && ['localhost','127.0.0.1','[::1]'].includes(u.hostname);
}
export async function webAccess(request,env,verificationKey) {
  if (localDemo(request,env)) return true;
  if (env.APP_MODE === 'demo') return false;
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(env.ACCESS_TEAM_DOMAIN || '') || !env.ACCESS_AUD) return false;
  const emails = list(env.WEB_ALLOWED_EMAILS).map(x=>x.toLowerCase());
  if (!emails.length || emails.length > 5) return false;
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) return false;
  try {
    const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
    const key = verificationKey || createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`),{ timeoutDuration:5000 });
    const { payload } = await jwtVerify(token,key,{ issuer,audience:env.ACCESS_AUD,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email'] });
    return typeof payload.email === 'string' && emails.includes(payload.email.toLowerCase());
  } catch { return false; }
}
export async function secretEqual(provided,expected) {
  if (!expected) return false;
  // WebCrypto HMAC verification avoids string comparison, and works in Node and Workers.
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw',enc.encode(expected),{ name:'HMAC',hash:'SHA-256' },false,['sign','verify']);
  const signature = await crypto.subtle.sign('HMAC',key,enc.encode('webhook-auth'));
  const other = await crypto.subtle.importKey('raw',enc.encode(provided || 'missing'),{ name:'HMAC',hash:'SHA-256' },false,['verify']);
  return crypto.subtle.verify('HMAC',other,signature,enc.encode('webhook-auth'));
}
export function telegramAccess(message,env) {
  const ids = list(env.TELEGRAM_ALLOWED_IDS);
  return ids.length > 0 && ids.length <= 5 && ids.every(id=>/^\d+$/.test(id)) && message?.chat?.type === 'private' && Number.isSafeInteger(message?.from?.id) && ids.includes(String(message.from.id)) && message.chat.id === message.from.id;
}
