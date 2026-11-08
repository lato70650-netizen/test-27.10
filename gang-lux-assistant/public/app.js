const form = document.querySelector('#ask-form');
const input = document.querySelector('#question');
const submit = document.querySelector('#submit');
const result = document.querySelector('#result');
let previous = ''; let busy = false;
const titles = {answer:'Подсказка из справочника',clarify:'Давайте уточним',not_found:'Пока нет подтверждённого ответа',unavailable:'Поиск временно недоступен',privacy:'Уберите личные данные'};
function node(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
function show(data){
 result.replaceChildren(node('h2',titles[data.kind]||'Не удалось получить ответ'),node('p',data.text,'answer-text'));
 result.className='result has-answer';
 if(data.sources?.length){const list=node('div','','source-list');list.append(node('p',data.kind==='clarify'?'Выберите тему или уточните вопрос:':'Источник ответа'));
 for(const source of data.sources){
  let el;
  if(data.kind==='clarify'){el=node('button',source.title);el.type='button';el.addEventListener('click',()=>{input.value=source.title;previous='';updateCount();form.requestSubmit();});}
  else if(source.url){el=node('a',source.title+' ↗');el.href=source.url;el.target='_blank';el.rel='noreferrer';}
  else el=node('span',source.title+' · демонстрация');
  list.append(el);
 }result.append(list);}

 if(data.kind==='clarify'){previous=input.value;input.placeholder='Уточните категорию или филиал';input.value='';updateCount();input.focus();}else previous='';
 if(innerWidth<800)result.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'start'});
}
function updateCount(){document.querySelector('#count').textContent=input.value.length+' / 600';}
input.addEventListener('input',updateCount);
for(const button of document.querySelectorAll('[data-question]'))button.addEventListener('click',()=>{if(busy)return;previous='';input.value=button.dataset.question;updateCount();input.focus();});
form.addEventListener('submit',async e=>{
 e.preventDefault();if(busy||!input.value.trim())return;
 busy=true;submit.disabled=true;result.setAttribute('aria-busy','true');
 result.replaceChildren(node('h2','Ищем в справочнике…'),node('p','Проверяем утверждённые карточки.'));
 try{
  const question=previous?previous+'\nУточнение: '+input.value:input.value;
  const response=await fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question}),signal:AbortSignal.timeout(45000)});
  const data=await response.json();
  if(response.status===403)show({text:'Нет доступа. Попросите владельца прислать ссылку.'});
  else if(data.kind)show(data);
  else show({text:data.message||'Не удалось выполнить запрос. Попробуйте ещё раз.'});
 }catch{show({kind:'unavailable',text:'Не удалось связаться с помощником. Проверьте соединение и повторите вопрос.'});}
 finally{busy=false;submit.disabled=false;result.removeAttribute('aria-busy');}
});
fetch('/api/session').then(r=>{if(!r.ok)throw Error();return r.json();}).then(s=>{document.querySelector('#demo-banner').hidden=!s.demo;}).catch(()=>{show({text:'Доступ закрыт. Попросите владельца прислать ссылку.'});submit.disabled=true;});
