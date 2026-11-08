const form=document.querySelector('#login'),status=document.querySelector('#status');
let ownerKey='';
form.addEventListener('submit',async e=>{e.preventDefault();const secret=document.querySelector('#secret').value;status.textContent='';try{const r=await fetch('/admin/shared-link',{headers:{Authorization:`Bearer ${secret}`}});if(!r.ok)throw Error();const data=await r.json();document.querySelector('#link').value=location.origin+'/join#'+data.token;ownerKey=secret;document.querySelector('#secret').value='';form.hidden=true;document.querySelector('#manager').hidden=false;}catch{status.textContent='Не удалось открыть ссылку. Проверьте ключ владельца и настройки.';}});
document.querySelector('#copy').onclick=async()=>{try{await navigator.clipboard.writeText(document.querySelector('#link').value);status.textContent='Ссылка скопирована.';}catch{document.querySelector('#link').select();status.textContent='Выделите и скопируйте ссылку вручную.';}};

document.querySelector('#connect-telegram').onclick=async()=>{
 const button=document.querySelector('#connect-telegram'), output=document.querySelector('#telegram-status');button.disabled=true;output.textContent='Подключаем бота…';
 try{const r=await fetch('/admin/connect-telegram',{method:'POST',headers:{Authorization:`Bearer ${ownerKey}`}});const data=await r.json();if(data.error==='WEBHOOK_IN_USE')throw new Error('Бот уже подключён к другому сервису. Напишите об этом, настройки не изменены.');if(!r.ok)throw new Error('Не получилось подключить бота. Проверьте токен и секрет в Cloudflare.');output.textContent=`Бот подключён. В группе отправьте команду /chatid@${data.bot_username} и сохраните показанный ID.`;}catch(e){output.textContent=e.message;}finally{button.disabled=false;}
};
