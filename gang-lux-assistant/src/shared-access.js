// The shareable token is derived from a secret held in the Worker, never stored in Git.
import { secretEqual } from './auth.js';
export async function sharedToken(secret) {
 if (typeof secret !== 'string' || secret.length < 32) return null;
 const e=new TextEncoder();
 const key=await crypto.subtle.importKey('raw',e.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const bytes=new Uint8Array(await crypto.subtle.sign('HMAC',key,e.encode('gang-lux-shared-link-v1')));
 let value='';for(const b of bytes)value+=String.fromCharCode(b);
 return btoa(value).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
export async function validSharedToken(token,secret) {
 const expected=await sharedToken(secret);
 return expected ? secretEqual(token,expected) : false;
}
export async function accessVersion(secret) {
 const token=await sharedToken(secret); if(!token)return null;
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)));
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export async function registerTelegram(db,id,secret,now=Date.now()) {
 if(!db || !/^\d+$/.test(String(id)))return false;
 const version=await accessVersion(secret);if(!version)return false;
 const result=await db.prepare('INSERT INTO shared_telegram_members (telegram_id, access_version, created_at) VALUES (?, ?, ?) ON CONFLICT(telegram_id) DO UPDATE SET access_version=excluded.access_version, created_at=excluded.created_at').bind(String(id),version,now).run();
 return result.meta.changes === 1;
}
export async function telegramAllowed(db,id,secret) {
 if(!db || !/^\d+$/.test(String(id)))return false;
 const version=await accessVersion(secret);if(!version)return false;
 return Boolean(await db.prepare('SELECT 1 AS ok FROM shared_telegram_members WHERE telegram_id = ? AND access_version = ?').bind(String(id),version).first());
}
