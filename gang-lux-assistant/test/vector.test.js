import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vectorAnswer } from '../src/core.js';
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
