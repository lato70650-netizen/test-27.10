import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vectorAnswer, vectorItems } from '../src/core.js';
const card=(id,question,answer)=>({id,question,answer,aliases:'',status:'Утверждено'});
const a=card('a','Какие требования и какой транспорт относятся к категории A?','A');
const a1=card('a1','Какие требования и какой транспорт относятся к категории A1?','A1');
const mos=card('mos','Сколько стоит обучение на категорию B в Московском?','Московский');
const sol=card('sol','Сколько стоит обучение на категорию B в Солнцево и Ново-Переделкино?','Солнцево');
const env={VECTOR_URL:'https://vector.example',VECTOR_TOKEN:'test'};
const get=(...cards)=>async()=>Response.json({result:cards.map((c,i)=>({id:c.id,score:0.9-i*0.01,metadata:{index_text:c.question+'\n'}}))});
test('отличает A и A1 даже если сначала пришла другая категория',async()=>{
 assert.equal((await vectorAnswer('со скольки лет на категорию A1',[a,a1],env,get(a,a1))).text,'A1');
 assert.equal((await vectorAnswer('со скольки лет на категорию A',[a,a1],env,get(a1,a))).text,'A');
});
test('цена без филиала требует филиал; указанный филиал не заменяется другим',async()=>{
 assert.equal((await vectorAnswer('сколько стоит обучение?',[mos,sol],env,get(mos,sol))).kind,'clarify');
 assert.equal((await vectorAnswer('сколько стоит обучение в Солнцево?',[mos,sol],env,get(mos,sol))).text,'Солнцево');
});
test('снятые с публикации или изменённые карточки не выбираются из старого индекса',async()=>{
 assert.equal((await vectorAnswer('вопрос',[{...a,question:'Изменено'}],env,get(a))).kind,'unavailable');
 assert.equal((await vectorAnswer('вопрос',[],env,get(a))).kind,'unavailable');
});

test('exact approved alias answers despite low vector similarity, without losing checklist',async()=>{
 const c={...card('docs','Пакет документов администратора для ГИБДД','Паспорт и СНИЛС, справка, свидетельство, госпошлина.'),aliases:'Какие документы нужны для оформления в ГИБДД?'};
 const noNetwork=async()=>{throw Error('should not query vector');};
 assert.equal((await vectorAnswer('какие документы нужны для оформления в гибдд?',[c],env,noNetwork)).text,c.answer);
 assert.equal((await vectorAnswer(c.aliases,[{...c,status:'Черновик'}],env,async()=>Response.json({result:[]}))).kind,'unavailable');
 assert.equal((await vectorAnswer(c.aliases,[c,{...c,id:'other'}],env,noNetwork)).kind,'clarify');
});

test('independent phrasing vectors resolve to current approved page and deduplicate',async()=>{
 const c={...card('ab-cd','Сколько длится обучение в автошколе?','2,5–3 месяца'),aliases:'Как долго учиться?; Как долго учиться?'};
 const items=vectorItems([c]);assert.equal(items.length,3);assert.equal(items[1].metadata.page_id,'abcd');
 assert.equal(items[2].data,'Как долго учиться?');
 const response=async()=>Response.json({result:[{id:items[2].id,score:0.9,metadata:items[2].metadata},{id:items[1].id,score:0.89,metadata:items[1].metadata}]});
 assert.equal((await vectorAnswer('За какое время я пройду обучение?',[c],env,response)).text,c.answer);
 assert.equal((await vectorAnswer('За какое время я пройду обучение?',[{...c,aliases:'Изменено'}],env,response)).kind,'unavailable');
 assert.deepEqual(vectorItems([{...c,status:'Черновик'}]),[]);
});
test('general duration never chooses an arbitrary category and close different answers clarify',async()=>{
 const specific=card('d','Сколько длится обучение на категорию D?','3 месяца');
 const general=card('all','Сколько длится обучение в автошколе?','2,5–3 месяца');
 assert.equal((await vectorAnswer('Как долго длится обучение?',[specific,general],env,get(specific,general))).text,general.answer);
 const x=card('x','Первая тема','Первый ответ'),y=card('y','Вторая тема','Второй ответ');
 assert.equal((await vectorAnswer('Неоднозначный вопрос',[x,y],env,get(x,y))).kind,'clarify');
});
test('bare Cyrillic category selects C without mixing D or C1',async()=>{
 const c=card('c','Где проходят занятия на категорию C?','Адрес C');
 const d=card('d','Где проходят занятия на категорию D?','Адрес D');
 assert.equal((await vectorAnswer('А где проходят занятия на С?',[c,d],env,get(d,c))).text,'Адрес C');
});
