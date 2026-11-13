import test from 'node:test';
import assert from 'node:assert/strict';
import { telegramText } from '../src/worker.js';
const answer=(text,q='вопрос')=>telegramText({kind:'answer',text,sources:[]},q);
test('formats multi-sentence answers without rewriting facts',()=>{
 const text='Подача машины не входит в курс. Первая попытка стоит 1 000 ₽. Пересдача стоит 1 000 ₽.';
 const rendered=answer(text,'Сколько стоит подача машины?');
 assert.match(rendered,/💰 /);assert.match(rendered,/<b>не входит<\/b>/);assert.equal((rendered.match(/<b>1 000 ₽<\/b>/g)||[]).length,2);
 assert.equal(rendered.replace(/^💰 /,'').replace(/<\/?b>/g,'').replace(/\n\n/g,' '),text);
});
test('preserves lists, Notion line breaks, decimals, addresses and initials',()=>{
 const t=answer('Заявление на имя Малинниковой В. М.\n\n• паспорт<br />• СНИЛС\n\nАдрес: Варшавское шоссе, 166, вл. 1. Срок — 2,5 месяца.');
 assert.match(t,/В\. М\./);assert.match(t,/• паспорт\n• СНИЛС/);assert.match(t,/вл\. 1\./);assert.match(t,/<b>2,5 месяца<\/b>/);assert.doesNotMatch(t,/&lt;br/);
});
test('highlights full ranges and meaningful timing, adds one appropriate emoji',()=>{
 const t=answer('Пересдача через 6–9 месяцев. Отменить можно за день. Занятие длится 90 минут.','Когда можно пересдать?');
 assert.match(t,/<b>6–9 месяцев<\/b>/);assert.match(t,/<b>за день<\/b>/);assert.match(t,/<b>90 минут<\/b>/);
 assert.match(answer('Да, бензин включён.','Бензин включён?'),/^✅ /);
 assert.equal(answer('✅ Бензин включён.','Бензин включён?'),'✅ Бензин включён.');
 assert.doesNotMatch(answer('Нет, пересдача платная.','Можно бесплатно?'),/✅/);
 assert.doesNotMatch(answer('Нет, нужна доплата.','Всё включено?'),/✅/);
 assert.match(answer('Срок — 7–30 календарных дней.'),/<b>7–30 календарных дней<\/b>/);
});
test('HTML is escaped and error messages do not get celebratory formatting',()=>{
 const t=answer('<b>Сумма</b> <script> & 1000 ₽.');
 assert.match(t,/&lt;b&gt;/);assert.match(t,/&lt;script&gt;/);assert.doesNotMatch(t,/<script>/);
 const t2=telegramText({kind:'unavailable',text:'Сервис недоступен. Попробуйте позже.',sources:[]},'Цена?');
 assert.equal(t2,'Сервис недоступен. Попробуйте позже.');
 const clarify=telegramText({kind:'clarify',text:'Уточните категорию',sources:[{title:'A < B'}]},'A & B?');
 assert.match(clarify,/• A &lt; B/);assert.match(clarify,/Вопрос: A &amp; B\?$/);
});
