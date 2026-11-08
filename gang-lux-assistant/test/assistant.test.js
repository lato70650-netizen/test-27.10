import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { telegramQuestion, telegramText } from '../src/worker.js';
import { ask, readCards, semanticSelect, boundedJSON, privateQuestion } from '../src/core.js';
import { webAccess, telegramAccess, secretEqual } from '../src/auth.js';
const base={id:'age',question:'Со скольки лет можно учиться?',aliases:'Берёте несовершеннолетних?',answer:'Вымышленное правило: условия уточняет старший администратор.',topic:'Возраст',status:'Утверждено',url:'https://www.notion.so/abc'};
const env={ACCESS_MODE:'legacy',NOTION_TOKEN:'fake',NOTION_DATA_SOURCE_ID:'fake-source',OPENROUTER_API_KEY:'fake',OPENROUTER_MODEL:'test/model:free',TELEGRAM_WEBHOOK_SECRET:'fake-webhook',TELEGRAM_ALLOWED_IDS:'123',TELEGRAM_BOT_TOKEN:'789:fake'};
const choose=id=>async()=>({action:'answer',ids:[id]});
const fail=async()=>{throw Error('upstream failure');};
const page=(answer='Вымышленный ответ',status='Утверждено')=>({id:'age',url:base.url,properties:{'Вопрос':{title:[{plain_text:base.question}]},'Варианты формулировок':{rich_text:[{plain_text:base.aliases}]},'Утверждённый ответ':{rich_text:[{plain_text:answer}]},'Статус':{status:{name:status}},'Тема':{select:{name:'Возраст'}}}});
test('перефразирование со слабым совпадением получает семантический ответ',async()=>{
 let received;
 const result=await ask('А в 17 уже можно записаться?',env,{cards:[base],select:async(q,c)=>{received=c;return {action:'answer',ids:['age']};}});
 assert.equal(result.text,base.answer);assert.equal(received[0].id,'age');
});
test('уточнение задаёт один вопрос и только известные варианты',async()=>{
 const result=await ask('Как учиться?',env,{cards:[base,{...base,id:'b',question:'Категория B'}],select:async()=>({action:'clarify',ids:['age','b']})});
 assert.equal(result.kind,'clarify');assert.equal(result.sources.length,2);assert.equal((result.text.match(/\?/g)||[]).length,1);
});
test('отсутствие ответа отличается от сбоя',async()=>{
 const r=await ask('Есть ли бассейн?',env,{cards:[base],select:async()=>({action:'none',ids:[]})});assert.equal(r.kind,'not_found');
 const f=await ask('Есть ли бассейн?',env,{cards:[base],select:fail});assert.equal(f.kind,'unavailable');
});
test('черновик не попадает к модели даже при совпадении',async()=>{
 const result=await ask('Цена?',env,{cards:[{...base,status:'Черновик'}],select:async()=>{assert.fail('model must not be called');}});assert.equal(result.kind,'not_found');
});
test('модель не может выбрать чужой ID или вернуть собственный текст',async()=>{
 const r=await ask('Несовершеннолетних принимают?',env,{cards:[base],select:async()=>({action:'answer',ids:['draft-id'],answer:'Выдуманный возраст 12'})});assert.equal(r.kind,'unavailable');assert.ok(!r.text.includes('12'));
});
test('сбой модели: точный вопрос возвращает карточку с предупреждением',async()=>{
 const r=await ask(base.question,env,{cards:[base],select:fail});assert.equal(r.text,base.answer);assert.equal(r.degraded,true);
});
test('невалидный JSON модели не маскируется под отсутствие ответа',async()=>{
 const r=await ask('С какого возраста?',env,{cards:[base],select:async()=>({action:'none',ids:['age']})});assert.equal(r.kind,'unavailable');
});
test('Notion: фильтр статуса, пагинация и повторная проверка черновиков',async()=>{
 let calls=0;const fetcher=async(url,init)=>{calls++;assert.ok(url.endsWith('/data_sources/fake-source/query'));const body=JSON.parse(init.body);assert.equal(body.filter.status.equals,'Утверждено');if(calls===2)assert.equal(body.start_cursor,'next');return Response.json({results:calls===1?[page(),page('черновик','Черновик')]:[{...page(),id:'second'}],has_more:calls===1,next_cursor:'next'});};
 const cards=await readCards(env,fetcher);assert.equal(cards.length,2);assert.equal(calls,2);
});
test('изменённая карточка видна на следующем чтении, снятая с публикации исчезает',async()=>{
 let answer='первая версия',status='Утверждено';const fetcher=async()=>Response.json({results:[page(answer,status)],has_more:false});
 assert.equal((await readCards(env,fetcher))[0].answer,'первая версия');answer='новая версия';assert.equal((await readCards(env,fetcher))[0].answer,'новая версия');status='Черновик';assert.equal((await readCards(env,fetcher)).length,0);
});
test('отказ Notion возвращает ошибку, а не пустой справочник',async()=>{
 await assert.rejects(readCards(env,async()=>new Response('denied',{status:403})),/UPSTREAM_UNAVAILABLE/);
});
test('личные данные блокируются до базы и модели',async()=>{
 for(const q of ['Телефон +7 999 123 45 67','Ученик Иван Петров, какие документы?','почта student@example.com']){
 const r=await ask(q,env,{fetcher:async()=>assert.fail('no network'),select:async()=>assert.fail('no model')});assert.equal(r.kind,'privacy');}
 assert.equal(privateQuestion('А в 17 уже можно записаться?'),false);
});
test('OpenRouter получает лишь текущие данные, запрет сбора и бесплатную модель',async()=>{
 await semanticSelect('Возраст?', [base], env,async(url,init)=>{const p=JSON.parse(init.body);assert.equal(p.model,'test/model:free');assert.equal(p.provider.data_collection,'deny');assert.equal(p.messages.length,2);assert.equal(JSON.parse(p.messages[1].content).cards[0].id,'age');return Response.json({choices:[{message:{content:'{"action":"answer","ids":["age"]}'}}]});});
 await assert.rejects(semanticSelect('q',[base],{...env,OPENROUTER_MODEL:'paid/model'},fail),/MODEL_NOT_CONFIGURED/);
});
test('поддельный JWT и email-заголовок не дают доступа',async()=>{
 assert.equal(await webAccess(new Request('https://example.org',{headers:{'Cf-Access-Authenticated-User-Email':'owner@example.org','Cf-Access-Jwt-Assertion':'forged'}}),{ACCESS_TEAM_DOMAIN:'team.cloudflareaccess.com',ACCESS_AUD:'aud',WEB_ALLOWED_EMAILS:'owner@example.org'}),false);
});
test('демо доступно только на loopback',async()=>{
 assert.equal(await webAccess(new Request('http://localhost'),{APP_MODE:'demo'}),true);
 assert.equal(await webAccess(new Request('https://production.workers.dev'),{APP_MODE:'demo'}),false);
});
test('Telegram: доступ только числовому ID в личном чате',()=>{
 const message={from:{id:123},chat:{id:123,type:'private'}};assert.equal(telegramAccess(message,env),true);
 assert.equal(telegramAccess({...message,from:{id:124}},env),false);
 assert.equal(telegramAccess({...message,chat:{id:123,type:'group'}},env),false);
 assert.equal(telegramAccess(message,{...env,TELEGRAM_ALLOWED_IDS:'username'}),false);
});
test('секрет вебхука проверяется',async()=>{
 assert.equal(await secretEqual('abc','abc'),true);assert.equal(await secretEqual('abd','abc'),false);assert.equal(await secretEqual('',''),false);
});
test('посторонний Telegram ID не вызывает внешних API',async()=>{
 const r=await worker.fetch(new Request('https://example.org/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'fake-webhook'},body:JSON.stringify({message:{from:{id:999},chat:{id:999,type:'private'},text:'Вопрос'}})}),env);assert.equal(r.status,200);
});
test('неверный секрет вебхука отклоняется до чтения JSON',async()=>{
 const r=await worker.fetch(new Request('https://example.org/telegram/webhook',{method:'POST',body:'bad json'}),env);assert.equal(r.status,403);
});
test('посторонний веб-пользователь не читает базу',async()=>{
 const r=await worker.fetch(new Request('https://example.org/api/ask',{method:'POST',body:'{}'}),env);assert.equal(r.status,403);
});
test('CSRF / неверный Origin блокируется',async()=>{
 const r=await worker.fetch(new Request('http://localhost/api/ask',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'}),{APP_MODE:'demo'});assert.equal(r.status,403);
});
test('веб-демо работает через настоящий HTTP handler',async()=>{
 const r=await worker.fetch(new Request('http://localhost/api/ask',{method:'POST',headers:{Origin:'http://localhost','Content-Type':'application/json'},body:JSON.stringify({question:'А в 17 уже можно записаться?'})}),{APP_MODE:'demo'});assert.equal(r.status,200);assert.equal((await r.json()).kind,'answer');assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('ответ на уточнение Telegram сохраняет исходный вопрос без серверной истории',()=>{
 const q=telegramQuestion({text:'Категория B',reply_to_message:{from:{id:789},text:'Уточните\n\nВопрос: Как проходят занятия?'}},env);assert.ok(q.includes('Как проходят занятия?'));assert.ok(q.includes('Категория B'));
});
test('ответ Telegram включает утверждённый текст без ссылки',()=>{
 const t=telegramText({kind:'answer',text:base.answer,sources:[{title:base.question,url:base.url}]},'q');assert.ok(t.includes(base.answer));assert.ok(!t.includes(base.url));
});
test('ограничение размера применяется к телу без Content-Length',async()=>{
 await assert.rejects(boundedJSON(new Response('x'.repeat(100)),20),/PAYLOAD_TOO_LARGE/);
});
test('пустой вопрос и слишком длинный вопрос отклоняются',async()=>{
 await assert.rejects(ask('',env),/INVALID_QUESTION/);await assert.rejects(ask('x'.repeat(1201),env),/INVALID_QUESTION/);
});
test('подписанный JWT: разрешённый email, issuer, audience, expiry',async()=>{
 const {generateKeyPair,SignJWT}=await import('jose');const {privateKey,publicKey}=await generateKeyPair('RS256');
 const auth={ACCESS_TEAM_DOMAIN:'test.cloudflareaccess.com',ACCESS_AUD:'aud-1',WEB_ALLOWED_EMAILS:'staff@example.org'};
 const token=await new SignJWT({email:'staff@example.org'}).setProtectedHeader({alg:'RS256'}).setIssuer('https://test.cloudflareaccess.com').setAudience('aud-1').setSubject('user').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 const request=new Request('https://example.org',{headers:{'Cf-Access-Jwt-Assertion':token}});
 assert.equal(await webAccess(request,auth,publicKey),true);
 assert.equal(await webAccess(request,{...auth,ACCESS_AUD:'wrong'},publicKey),false);
 assert.equal(await webAccess(request,{...auth,WEB_ALLOWED_EMAILS:'outsider@example.org'},publicKey),false);
 assert.equal(await webAccess(request,{...auth,ACCESS_TEAM_DOMAIN:'wrong.cloudflareaccess.com'},publicKey),false);
 const expired=await new SignJWT({email:'staff@example.org'}).setProtectedHeader({alg:'RS256'}).setIssuer('https://test.cloudflareaccess.com').setAudience('aud-1').setSubject('user').setIssuedAt().setExpirationTime(1).sign(privateKey);
 assert.equal(await webAccess(new Request('https://example.org',{headers:{'Cf-Access-Jwt-Assertion':expired}}),auth,publicKey),false);
});
test('HTTP 429 OpenRouter означает сбой и допускает только точный fallback',async()=>{
 const fetcher=async()=>new Response('limited',{status:429});
 assert.equal((await ask('Принимаете подростков?',env,{cards:[base],fetcher})).kind,'unavailable');
 assert.equal((await ask(base.question,env,{cards:[base],fetcher})).degraded,true);
});
test('лимит справочника не приводит к неполному ответу',async()=>{
 await assert.rejects(ask('вопрос',env,{cards:Array.from({length:41},(_,i)=>({...base,id:String(i)})),select:choose('0')}),/KNOWLEDGE_LIMIT/);
});
test('оба входа возвращают один утверждённый материал через mock HTTP интеграций',async(t)=>{
 const {generateKeyPair,SignJWT,exportJWK}=await import('jose');const {privateKey,publicKey}=await generateKeyPair('RS256');const jwk=await exportJWK(publicKey);let sent;
 const liveEnv={...env,APP_MODE:'production',ACCESS_TEAM_DOMAIN:'team.cloudflareaccess.com',ACCESS_AUD:'test-aud',WEB_ALLOWED_EMAILS:'staff@example.org'};
 const token=await new SignJWT({email:'staff@example.org'}).setProtectedHeader({alg:'RS256',kid:'k1'}).setIssuer('https://team.cloudflareaccess.com').setAudience('test-aud').setSubject('staff').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  if(String(url).includes('/cdn-cgi/access/certs'))return Response.json({keys:[{...jwk,kid:'k1',use:'sig',alg:'RS256'}]});
  if(String(url).includes('api.notion.com'))return Response.json({results:[page()],has_more:false});
  if(String(url).includes('openrouter.ai'))return Response.json({choices:[{message:{content:'{"action":"answer","ids":["age"]}'}}]});
  if(String(url).includes('api.telegram.org')){sent=JSON.parse(init.body);return Response.json({ok:true});}
  assert.fail('unexpected upstream');
 });
 const web=await worker.fetch(new Request('https://assistant.example.org/api/ask',{method:'POST',headers:{'Cf-Access-Jwt-Assertion':token,Origin:'https://assistant.example.org','Content-Type':'application/json'},body:JSON.stringify({question:'А в 17 уже можно записаться?'})}),liveEnv);
 assert.equal(web.status,200);const webResult=await web.json();
 const telegram=await worker.fetch(new Request('https://assistant.example.org/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':'fake-webhook'},body:JSON.stringify({update_id:1,message:{from:{id:123},chat:{id:123,type:'private'},text:'А в 17 уже можно записаться?'}})}),liveEnv);
 assert.equal(telegram.status,200);assert.ok(sent.text.includes(webResult.text));assert.ok(!sent.text.includes(webResult.sources[0].url));
});
test('model failure: explicit category and age retrieves only the matching approved card',async()=>{
 const a={...base,id:'cat-a',question:'Какие требования и какой транспорт относятся к категории A?',aliases:'Категория A',answer:'Мотоциклы. Экзамен с 18 лет.'};
 const b={...base,id:'cat-b',question:'Какие требования и какой транспорт относятся к категории B?',aliases:'Категория B',answer:'Автомобили.'};
 const result=await ask('со скольки лет можно учиться на кат.А',env,{cards:[a,b],select:fail});
 assert.equal(result.kind,'answer');assert.equal(result.text,a.answer);assert.equal(result.degraded,true);
 for(const q of ['сколько стоит обучение на кат.А','есть ли запись на кат.А','что входит в кат.А или кат.B'])assert.equal((await ask(q,env,{cards:[a,b],select:fail})).kind,'unavailable');
});
test('model JSON in a code fence is accepted while IDs remain checked',async()=>{
 const result=await semanticSelect('Вопрос', [base],env,async()=>Response.json({choices:[{message:{content:['```json','{"action":"answer","ids":["age"]}','```'].join('\n')}}]}));
 assert.equal(result.action,'answer');assert.deepEqual(result.ids,['age']);
});
test('model diagnostic reports safe HTTP status and never returns provider response or credential',async()=>{
 const {diagnoseModel}=await import('../src/core.js');
 let body;
 const result=await diagnoseModel(env,async(url,init)=>{body=JSON.parse(init.body);return new Response('secret provider text',{status:429});});
 assert.deepEqual(result,{ok:false,http_status:429,reason:'provider_error'});assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(body.messages[1].content.includes(base.answer),false);
});
test('model diagnostic distinguishes malformed output and missing configuration',async()=>{
 const {diagnoseModel}=await import('../src/core.js');
 assert.deepEqual(await diagnoseModel({...env,OPENROUTER_API_KEY:''}),{ok:false,http_status:null,reason:'not_configured'});
 const r=await diagnoseModel(env,async()=>Response.json({choices:[{message:{content:'not json'}}]}));assert.deepEqual(r,{ok:false,http_status:200,reason:'invalid_format'});
});
test('category fallback distinguishes A from A1 and fails closed on ambiguous requests',async()=>{
 const a={...base,id:'a',question:'Какие требования и какой транспорт относятся к категории A?',aliases:'A',answer:'A'};
 const a1={...base,id:'a1',question:'Какие требования и какой транспорт относятся к категории A1?',aliases:'A1',answer:'A1'};
 assert.equal((await ask('со скольки лет категория A1',env,{cards:[a,a1],select:fail})).text,'A1');
 assert.equal((await ask('категория A или категория A1 со скольки лет',env,{cards:[a,a1],select:fail})).kind,'unavailable');
});
test('fallback answer is concise and has no source or technical model status',()=>{
 const text=telegramText({kind:'answer',text:'Экзамен можно сдать с 18 лет.',degraded:true,sources:[{title:'Категория A',url:'https://www.notion.so/example'}]},'вопрос');
 assert.match(text,/Экзамен можно сдать/);assert.doesNotMatch(text,/Источник|https:|Модель|недоступна/);
});
test('focused category A age question returns approved first sentence, without inventing an enrolment age',async()=>{
 const a={...base,id:'category-a',question:'Какие требования и какой транспорт относятся к категории A?',aliases:'Категория A',answer:'Экзамен на категорию A можно сдать с 18 лет, тогда же можно получить права. Категория A — это мотоциклы. Когда можно записаться, уточните у старшего администратора.'};
 const q='со скольки лет можно учиться на кат.А?';
 const found=await ask(q,env,{cards:[a],select:async()=>({action:'answer',ids:['category-a']})});
 const fallback=await ask(q,env,{cards:[a],select:fail});
 assert.equal(found.text,'Экзамен на категорию A можно сдать с 18 лет, тогда же можно получить права.');assert.equal(fallback.text,found.text);
 const t=telegramText(found,q);assert.match(t,/<b>18 лет<\/b>/);assert.doesNotMatch(t,/Источник|https:/);
 const mixed=await ask('Сколько лет нужно и когда можно записаться на категорию A?',env,{cards:[a],select:async()=>({action:'answer',ids:['category-a']})});assert.match(mixed.text,/уточните у старшего администратора/);
});
test('Telegram formatting escapes untrusted text and preserves context',()=>{
 const t=telegramText({kind:'answer',text:'Экзамен с 18 лет. Для допуска нужен <документ> & проверка.',sources:[]},'q');
 assert.match(t,/<b>18 лет<\/b>/);assert.match(t,/\n\nДля допуска/);assert.match(t,/&lt;документ&gt; &amp; проверка/);assert.doesNotMatch(t,/<документ>/);
});
test('при ограничении провайдера пробует другую бесплатную модель',async()=>{
 const models=[];
 const result=await semanticSelect('Вопрос',[base],env,async(url,init)=>{const model=JSON.parse(init.body).model;models.push(model);if(models.length===1)return Response.json({error:{message:'provider busy'}},{status:429});return Response.json({choices:[{message:{content:'{"action":"answer","ids":["age"]}'}}]});});
 assert.equal(result.action,'answer');assert.equal(models.length,2);assert.ok(models.every(m=>m.endsWith(':free')));
});
