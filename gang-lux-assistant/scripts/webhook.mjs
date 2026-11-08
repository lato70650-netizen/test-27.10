// Supply TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET and WORKER_URL in the environment.
// Never pass secrets as CLI arguments. Telegram token is necessarily used in the HTTPS URL; do not trace requests.
try {
 const {TELEGRAM_BOT_TOKEN:token,TELEGRAM_WEBHOOK_SECRET:secret,WORKER_URL:origin}=process.env;
 if(!token||!secret||!/^[A-Za-z0-9_-]{32,256}$/.test(secret))throw Error();
 const url=new URL('/telegram/webhook',origin);if(url.protocol!=='https:')throw Error();
 const response=await fetch(`https://api.telegram.org/bot${token}/setWebhook`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:url.href,secret_token:secret,allowed_updates:['message'],max_connections:1}),signal:AbortSignal.timeout(15000)});
 const data=await response.json();if(!response.ok||!data.ok)throw Error();
 console.log('Webhook установлен. Очередь существующих сообщений сохранена. Проверьте личный чат разрешённого и постороннего пользователя.');
}catch{console.error('Webhook не настроен. Проверьте переменные окружения, HTTPS-адрес и доступ к Telegram.');process.exitCode=1;}
