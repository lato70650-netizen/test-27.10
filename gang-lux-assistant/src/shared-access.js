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
