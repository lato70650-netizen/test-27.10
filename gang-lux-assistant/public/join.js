const status=document.querySelector('#status');
const token=location.hash.slice(1);
history.replaceState(null,'','/join');
if(!/^[A-Za-z0-9_-]{43}$/.test(token))status.textContent='Ссылка недействительна. Попросите владельца прислать действующую ссылку.';
else fetch('/api/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})}).then(async response=>{
 if(!response.ok)throw new Error();
 const data=await response.json();status.textContent='Выберите, где задать вопрос:';
 const web=document.createElement('a');web.href='/';web.textContent='Открыть справочник';web.className='button';document.querySelector('main').append(web);
 const note=document.createElement('p');note.textContent='Для Telegram попросите владельца добавить вас в закрытую группу школы.';document.querySelector('main').append(note);
}).catch(()=>{status.textContent='Ссылка недействительна или доступ временно недоступен. Обратитесь к владельцу.';});
