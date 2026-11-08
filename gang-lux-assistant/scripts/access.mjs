// Run from a trusted computer with ADMIN_SECRET, WORKER_URL and TELEGRAM_BOT_USERNAME in the environment.
// Invitation links grant access. Share each with exactly one intended employee.
const {ADMIN_SECRET,WORKER_URL,TELEGRAM_BOT_USERNAME} = process.env;
const operation = process.argv[2];
if (!ADMIN_SECRET || !WORKER_URL || !['web','telegram','list','revoke'].includes(operation)) {
 console.error('Set ADMIN_SECRET and WORKER_URL in the environment; use web, telegram, list, or revoke.'); process.exit(1);
}
try {
 const origin=new URL(WORKER_URL); if(origin.protocol!=='https:')throw Error('Worker URL must use HTTPS');
 const headers={Authorization:`Bearer ${ADMIN_SECRET}`,'Content-Type':'application/json'};
 let endpoint, method, body;
 if(operation==='list'){endpoint='/admin/access';method='GET';}
 else if(operation==='revoke'){
  const [channel,id]=process.argv.slice(3); if(!['web','telegram'].includes(channel)||!id)throw Error('Use revoke web <id> or revoke telegram <id>');
  endpoint='/admin/revoke';method='POST';body=JSON.stringify({channel,id});
 } else {if(operation==='telegram'&&!/^[A-Za-z0-9_]{5,32}$/.test(TELEGRAM_BOT_USERNAME||''))throw Error('Set TELEGRAM_BOT_USERNAME without @');endpoint='/admin/invitations';method='POST';body=JSON.stringify({channel:operation});}
 const response=await fetch(new URL(endpoint,origin),{method,headers,body,signal:AbortSignal.timeout(10000)});
 if(!response.ok)throw Error(`Access operation failed (HTTP ${response.status})`);
 const data=await response.json();
 if(operation==='web') console.log(`${origin.origin}/join#${data.token}\nExpires: ${new Date(data.expires_at).toISOString()}`);
 else if(operation==='telegram') console.log(`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${data.token}\nExpires: ${new Date(data.expires_at).toISOString()}`);
 else if(operation==='list') console.log(JSON.stringify(data,null,2));
 else console.log('Access revoked.');
}catch(error){console.error(error.message);process.exitCode=1;}
