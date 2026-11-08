// Invitation primitives for the Worker.
// Never store or log a raw token. Each token is consumed by a single atomic update.
const encoder = new TextEncoder();
export async function hashInvitation(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token)));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
export function generateInvitation() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function createInvitation(db, channel, now = Date.now()) {
  if (!db || !['web', 'telegram'].includes(channel)) throw new Error('Invalid invitation configuration');
  const token = generateInvitation();
  const hash = await hashInvitation(token);
  const expires = now + 24 * 60 * 60 * 1000;
  await db.prepare('INSERT INTO invitations (token_hash, channel, expires_at) VALUES (?, ?, ?)').bind(hash, channel, expires).run();
  return { token, expires_at: expires };
}
export async function consumeInvitation(db, token, channel, now = Date.now()) {
  if (!db || !['web', 'telegram'].includes(channel)) return false;
  const hash = await hashInvitation(token);
  if (!hash) return false;
  const row = await db.prepare('UPDATE invitations SET used_at = ? WHERE token_hash = ? AND channel = ? AND used_at IS NULL AND expires_at > ? RETURNING token_hash').bind(now, hash, channel, now).first();
  return Boolean(row);
}

const SESSION_LIFETIME = 30 * 24 * 60 * 60 * 1000;
export async function redeemWeb(db, token, now = Date.now()) {
  if (!db) return null;
  const hash = await hashInvitation(token);
  if (!hash) return null;
  const session = generateInvitation();
  const sessionHash = await hashInvitation(session);
  const result = await db.batch([
    db.prepare("UPDATE invitations SET used_at = ? WHERE token_hash = ? AND channel = 'web' AND used_at IS NULL AND expires_at > ? AND (SELECT count(*) FROM web_sessions WHERE expires_at > ?) < 5").bind(now, hash, now, now),
    db.prepare('INSERT INTO web_sessions (session_hash, expires_at, created_at) SELECT ?, ?, ? WHERE changes() = 1').bind(sessionHash, now + SESSION_LIFETIME, now)
  ]);
  return result[0].meta.changes === 1 && result[1].meta.changes === 1 ? session : null;
}
export async function redeemTelegram(db, token, telegramId, now = Date.now()) {
  if (!db || !/^\d+$/.test(String(telegramId))) return false;
  const hash = await hashInvitation(token);
  if (!hash) return false;
  const id = String(telegramId);
  const result = await db.batch([
    db.prepare("UPDATE invitations SET used_at = ? WHERE token_hash = ? AND channel = 'telegram' AND used_at IS NULL AND expires_at > ? AND (SELECT count(*) FROM telegram_members) < 5 AND NOT EXISTS (SELECT 1 FROM telegram_members WHERE telegram_id = ?)").bind(now, hash, now, id),
    db.prepare('INSERT INTO telegram_members (telegram_id, created_at) SELECT ?, ? WHERE changes() = 1').bind(id, now)
  ]);
  return result[0].meta.changes === 1 && result[1].meta.changes === 1;
}
export async function validWebSession(db, token, now = Date.now()) {
  if (!db) return false;
  const hash = await hashInvitation(token);
  if (!hash) return false;
  return Boolean(await db.prepare('SELECT 1 AS ok FROM web_sessions WHERE session_hash = ? AND expires_at > ?').bind(hash, now).first());
}
export async function isTelegramMember(db, id) {
  if (!db || !/^\d+$/.test(String(id))) return false;
  return Boolean(await db.prepare('SELECT 1 AS ok FROM telegram_members WHERE telegram_id = ?').bind(String(id)).first());
}
export async function revokeAccess(db, channel, id) {
  if (!db) throw new Error('Missing access database');
  if (channel === 'web' && /^[0-9a-f]{64}$/.test(id)) return db.prepare('DELETE FROM web_sessions WHERE session_hash = ?').bind(id).run();
  if (channel === 'telegram' && /^\d+$/.test(id)) return db.prepare('DELETE FROM telegram_members WHERE telegram_id = ?').bind(id).run();
  throw new Error('Invalid access identifier');
}
