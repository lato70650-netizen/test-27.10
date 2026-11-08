// No secrets or model responses are printed. Configure secrets in the process environment.
const model = process.env.OPENROUTER_MODEL || 'google/gemma-4-26b-a4b-it:free';
try {
 const response = await fetch('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('catalog');
 const {data}=await response.json();const entry=data.find(x=>x.id===model);
 if(!entry || !model.endsWith(':free') || Number(entry.pricing.prompt)!==0 || Number(entry.pricing.completion)!==0)throw Error('not_free');
 console.log('Каталог: выбранная модель бесплатна.');
 if(!process.env.OPENROUTER_API_KEY){console.log('Живой запрос не проверен: OPENROUTER_API_KEY не задан.');process.exitCode=2;}
 else {
  const r=await fetch('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENROUTER_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,max_tokens:50,provider:{data_collection:'deny',allow_fallbacks:false},messages:[{role:'user',content:'Return only JSON: {"ok":true}'}]}),signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('completion');const output=await r.json();if(!JSON.parse(output.choices[0].message.content).ok)throw Error('format');
  console.log('Живой запрос и JSON-ответ: OK.');
 }
}catch{console.error('Проверка модели не пройдена. Проверьте модель, ключ, правило Free models only и доступность провайдера.');process.exitCode=1;}
