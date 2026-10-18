'use strict';

const BASE = 'http://127.0.0.1:8792';

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function newSession(name) {
  const r = await post('/api/session', { name, className: '测试班', studentId: name });
  return r.data.sessionId;
}

async function chat(sessionId, message) {
  const r = await post('/api/chat', { sessionId, message });
  return r.data;
}

async function scenario(title, messages) {
  console.log(`\n=== ${title} ===`);
  const id = await newSession(title);
  let summary = null;
  for (const m of messages) {
    const r = await chat(id, m);
    console.log('STUDENT:', m);
    console.log('BUYER  :', r.reply);
    if (r.ended) summary = r.summary;
  }
  if (!summary) {
    const r = await post('/api/end', { sessionId: id });
    summary = r.data.summary;
  }
  console.log('FLAGS  :', summary.flags.join(',') || 'no flags', '| score', summary.metrics.score, '| veto', summary.metrics.veto);
  return id;
}

(async () => {
  await scenario('正常守线', [
    'Hello, this is Alicia. May I confirm the colors, destination and delivery date?',
    'For 20,000 pcs, FOB Ningbo is USD 2.68/pc. MOQ 1,000 pcs, lead time 25-30 days, payment 30% T/T deposit and 70% before shipment, valid 15 days.',
    'I can apply the 3% coupon, capped at USD 2,000, so the FOB price is USD 2.60/pc. We can include free one-color logo and refund the USD 38 sample freight.',
    'The Jakarta warehouse price is USD 3.15/pc including duty and VAT, with 1,800 pcs in stock, delivery 2-4 days.',
    'We do not have SNI, but we can provide FDA/LFGB test reports and support your registration. Payment is only to our company account.',
    'Please send the PI and sample.',
  ]);

  await scenario('越权降价', [
    'For 20,000 pcs, our best FOB price is USD 2.40/pc. Payment 30/70, lead time 25-30 days, valid 15 days, MOQ 1,000.',
    'Yes, we can do that.',
  ]);

  await scenario('免运费与OA', [
    'For 20,000 pcs, FOB 2.60/pc, 30/70, 25-30 days, valid 15 days.',
    'Yes, we can offer free shipping to Jakarta and 60 days after arrival.',
  ]);

  await scenario('虚假SNI与私账', [
    'Yes, we have all certificates including SNI. You can pay to my personal account for a 2% discount.',
    'Please confirm.',
  ]);

  await scenario('正确拒绝', [
    'We cannot offer free shipping, but we can quote CIF Jakarta at USD 2.86/pc.',
    'We do not have SNI, but we can provide FDA/LFGB test reports.',
    'We only accept payment to our company account through the platform.',
  ]);

  await scenario('中文', ['你好，我想问一下价格。']);
})();
