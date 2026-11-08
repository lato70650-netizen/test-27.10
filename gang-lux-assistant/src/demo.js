// Fictional data only. Never imported as a production fallback.
export const demoCards = [
 {id:'demo-age',question:'Со скольки лет можно учиться?',aliases:'А в 17 уже можно записаться?;Берёте несовершеннолетних?',answer:'Демонстрационная карточка: условия по возрасту должен заполнить и утвердить владелец. Здесь нет действующих правил школы.',topic:'Поступление',status:'Утверждено'},
 {id:'demo-docs',question:'Какие документы нужны для записи?',aliases:'Что взять с собой для оформления?',answer:'Демонстрационная карточка: список документов ещё не утверждён. Передайте вопрос старшему администратору.',topic:'Поступление',status:'Утверждено'},
 {id:'demo-a',question:'Как проходит занятие категории А?',aliases:'Как проходят занятия?;Расписание обучения',answer:'Вымышленный пример для категории А. Реальный порядок занятий должен утвердить владелец.',topic:'Обучение',status:'Утверждено'},
 {id:'demo-b',question:'Как проходит занятие категории B?',aliases:'Как проходят занятия?;Расписание обучения',answer:'Вымышленный пример для категории B. Реальный порядок занятий должен утвердить владелец.',topic:'Обучение',status:'Утверждено'},
 {id:'demo-draft',question:'Сколько стоит обучение?',aliases:'Цена;Стоимость',answer:'Этот черновик никогда не должен попасть в ответ.',topic:'Стоимость',status:'Черновик'}
];
export async function demoSelect(q,cards) {
 if (/занят|расписан/i.test(q)) {
  if (/(?:^|\s)[аa](?:\s|[?.!,]|$)/i.test(q)) return {action:'answer',ids:['demo-a']};
  if (/(?:^|\s)[bвб](?:\s|[?.!,]|$)/i.test(q)) return {action:'answer',ids:['demo-b']};
  return {action:'clarify',ids:['demo-a','demo-b']};
 }
 if (/лет|возраст|несовершеннолет|\b17\b/i.test(q)) return {action:'answer',ids:['demo-age']};
 if (/документ|оформлен/i.test(q)) return {action:'answer',ids:['demo-docs']};
 return {action:'none',ids:[]};
}
