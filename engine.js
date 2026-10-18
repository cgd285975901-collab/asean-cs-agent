'use strict';

/**
 * Deterministic buyer engine for the ASEAN bulk-purchase negotiation practicum.
 *
 * The engine is intentionally rule-based:
 *  - same scenario and same price boundaries for every student;
 *  - no hallucinated prices, stock or certificates;
 *  - every turn is explainable and auditable.
 *
 * It can later be wrapped by an LLM "natural language layer", but the commercial
 * state machine and red-line checks stay deterministic.
 */

const PRODUCT = {
  sku: 'YP-800',
  name: '800ml stainless steel lunch box',
  material: '304 stainless steel inner and outer, food-grade PP lid',
  colors: '6 colors',
  carton: '24 pcs / carton',
  moq: 1000,
  mixedMin: 500,
  tiers: [
    { min: 1000, max: 2999, price: 2.95 },
    { min: 3000, max: 9999, price: 2.82 },
    { min: 10000, max: 29999, price: 2.68 },
    { min: 30000, max: Infinity, price: 2.55 },
  ],
  coupon: { minOrder: 20000, pct: 0.03, cap: 2000, incoterm: 'FOB' },
  sample: { free: 1, freight: 38, refundMin: 10000, extra: 12 },
  warehouse: { price: 3.15, moq: 200, stock: 1800, lead: '2-4 working days', tax: 'import duty and 11% VAT included' },
  cifAdd: 0.18,
  lead: '25-30 days',
  payment: '30% T/T deposit, 70% before shipment',
  validity: 15,
  reservation: 2.62,
  floor20: 2.60,
  floor30: 2.47,
};

const OPENING =
  'Hi, this is Rizky from CV Sinar Jaya Grosir in Jakarta. We supply wholesalers in Tanah Abang. ' +
  'I need 20,000 pcs of your 800ml stainless steel lunch box for the Ramadan season. ' +
  'Please give me your best FOB price, MOQ, coupon, sample policy, and tell me if you have stock ' +
  'in your Indonesia warehouse. My target is USD 2.20 per piece. Can you do that?';

const VETO_FLAGS = [
  'below_floor',
  'free_shipping_promise',
  'ddp_promise',
  'oa_promise',
  'fake_cert_claim',
  'off_platform_payment',
];

const FLAG_LABELS = {
  below_floor: '低于底价',
  free_shipping_promise: '承诺免运费',
  ddp_promise: '承诺 DDP/包税',
  oa_promise: '承诺 OA/超长账期',
  fake_cert_claim: '虚假/夸大认证',
  off_platform_payment: '私下收款',
  exclusivity_promise: '轻率承诺独家',
  penalty_overcommit: '违约金过度承诺',
  warehouse_price_mismatch: '海外仓与 FOB 价格混用',
  sample_overconcession: '样品过度让步',
  unrealistic_lead_time: '交期过度承诺',
  non_english: '使用中文',
  rude: '失礼/攻击',
};

const DISCOVERY = [
  {
    key: 'colors',
    re: /colou?r|colour|color/,
    answer:
      'Six colors, about 3,000 pcs each. We need mixed colors. What is your FOB price for 20,000 pcs?',
  },
  {
    key: 'destination',
    re: /destination|which port|what port|jakarta|indonesia/,
    answer:
      'Destination Jakarta. We sell through three stalls in Tanah Abang and supply about 120 small retailers in Jabodetabek. Can you quote FOB Ningbo?',
  },
  {
    key: 'timeline',
    re: /when|deadline|arrive|delivery date|how soon|ship within/,
    answer:
      'The container must ship within 30 days. Ramadan is coming, so I cannot wait longer. Can you meet that?',
  },
  {
    key: 'certification',
    re: /certif|sni|fda|lfgb|test report|inspection/,
    answer:
      'My buyers ask for SNI, but FDA or LFGB test reports are also useful. What exactly can you provide?',
  },
  {
    key: 'payment',
    re: /payment|deposit|credit|lc|t\/t|terms of payment/,
    answer:
      'Normally 30% deposit and 70% before shipment. But I would prefer 60 days after arrival. What can you offer?',
  },
  {
    key: 'channel',
    re: /sell|retail|wholesale|channel|market/,
    answer:
      'We supply 120 small retailers in Jabodetabek through three wholesale stalls in Tanah Abang. That is why I need a stable supplier.',
  },
  {
    key: 'packaging',
    re: /pack|carton|color box|colour box/,
    answer:
      '24 pcs per carton is fine. Can you do a color box and a free logo for 20,000 pcs?',
  },
  {
    key: 'quantity',
    re: /quantity|how many|order size/,
    answer:
      '20,000 pcs for the first order. If it sells well, I can repeat 30,000 pcs. Can you quote both volumes?',
  },
];

function now() {
  return new Date().toISOString();
}

function createSession(meta = {}) {
  return {
    version: 1,
    sessionId: meta.sessionId || null,
    student: meta.student || {},
    createdAt: meta.createdAt || now(),
    opening: OPENING,
    buyerName: 'Rizky',
    company: 'CV Sinar Jaya Grosir',
    turn: 0,
    studentTurns: 0,
    buyerTurns: 1,
    stage: 'opening',
    quantity: 20000,
    destination: 'Jakarta',
    deadline: '30 days',
    quote: {
      product: PRODUCT.name,
      quantity: 20000,
      price: null,
      incoterm: null,
      currency: null,
      moq: null,
      lead: null,
      payment: null,
      validity: null,
      total: null,
      accepted: false,
      belowFloor: false,
    },
    lastOffer: null,
    asked: {
      colors: false,
      destination: false,
      timeline: false,
      certification: false,
      payment: false,
      channel: false,
      packaging: false,
      quantity: false,
      target: false,
    },
    flags: [],
    promises: {
      freeShipping: false,
      ddp: false,
      oa: false,
      fakeCert: false,
      privateAccount: false,
      exclusivity: false,
      penalty: false,
      leadTime: false,
    },
    concessions: {
      coupon: false,
      logo: false,
      sample: false,
      spareParts: false,
      priceProtection: false,
      priority: false,
    },
    pendingAsk: null,
    sampleAgreed: false,
    warehouseDiscussed: false,
    certDiscussed: false,
    paymentDiscussed: false,
    exclusivityDiscussed: false,
    penaltyDiscussed: false,
    deal: false,
    ended: false,
    endReason: null,
    notes: [],
    managerApproval: null,
  };
}

function addFlag(state, flag, note) {
  if (!state.flags.includes(flag)) {
    state.flags.push(flag);
    state.notes.push({ flag, label: FLAG_LABELS[flag] || flag, note: note || '', at: state.turn });
  }
}

function containsChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function hasAny(text, patterns) {
  return patterns.some((p) => (p instanceof RegExp ? p.test(text) : text.includes(p)));
}

function isQuestion(text) {
  return /\?/.test(text) || /^(what|how|when|where|which|who|can you|could you|do you|are you|is it|may i|would you)/i.test(text.trim());
}

function isAffirmative(text) {
  return /^(yes|yeah|yep|sure|ok|okay|no problem|we can|we do|absolutely|of course|confirmed|agree|fine|deal)\b/i.test(text.trim()) ||
    /\b(we can|we do|no problem|of course|sure)\b/i.test(text);
}

function isNegative(text) {
  return /^(no|nope|sorry|we can't|we cannot|we don't|we do not|not available|unfortunately|afraid not)\b/i.test(text.trim());
}

function isRude(text) {
  return /\b(fuck|fucking|shit|bitch|idiot|stupid|moron|asshole)\b/i.test(text);
}

function isNegated(text, re) {
  const idx = text.search(re);
  if (idx < 0) return false;
  const window = text.slice(Math.max(0, idx - 42), Math.min(text.length, idx + 42));
  return /\b(cannot|can't|can not|unable|not|no|without|don't|do not|never)\b/i.test(window);
}

function pick(state, arr) {
  const i = (state.turn * 7 + state.studentTurns * 3 + arr.length) % arr.length;
  return arr[i];
}

function parseQuantity(text) {
  const cleaned = text.replace(/,/g, '');
  const candidates = [];
  const explicit = [...cleaned.matchAll(/(\d+(?:\.\d+)?)\s*(k|thousand|pcs|pieces|units)\b/gi)];
  for (const m of explicit) {
    let n = Number(m[1]);
    const unit = (m[2] || '').toLowerCase();
    if (unit === 'k' || unit === 'thousand') n *= 1000;
    const before = cleaned.slice(Math.max(0, m.index - 38), m.index).toLowerCase();
    const after = cleaned.slice(m.index + m[0].length, m.index + m[0].length + 30).toLowerCase();
    // "1,800 pcs in stock" is stock, not the order quantity.
    if (/(stock|available|inventory|warehouse|sample|freight|deposit|coupon|cap|refund)/.test(before + ' ' + after)) continue;
    if (n >= 1000 && n <= 500000) candidates.push(n);
  }
  if (candidates.length) return Math.max(...candidates);

  // "for 20,000" / "order of 30,000" without a unit. Only accept five digits or more,
  // so a USD 2,000 coupon cap is not mistaken for an order quantity.
  const order = cleaned.match(/(?:quantity|order(?:\s+of)?|for)\s*(?:of\s*)?(\d{5,})/i);
  if (order) return Number(order[1]);
  return null;
}

function parsePrice(text) {
  // Remove percentages and quantities so "3%" or "20,000 pcs" are not read as prices.
  const cleaned = text
    .replace(/\d+(?:\.\d+)?\s*%/g, ' ')
    .replace(/\b\d{1,3}(?:,\d{3})+\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ');
  const strong = [
    ...cleaned.matchAll(/(?:usd|us\$|\$|@|price(?:\s+is)?|at|for)\s*([0-9]+(?:\.[0-9]{1,2})?)/gi),
  ];
  if (strong.length) {
    const n = Number(strong[strong.length - 1][1]);
    if (n >= 0.5 && n <= 10) return n;
  }
  const decimals = [...cleaned.matchAll(/\b([0-9]+\.[0-9]{1,2})\b/g)].map((m) => Number(m[1]));
  const valid = decimals.filter((n) => n >= 0.5 && n <= 10);
  return valid.length ? valid[valid.length - 1] : null;
}

function parseIncoterm(text) {
  const m = text.match(/\b(FOB|CIF|DDP|EXW|CFR)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function getTier(qty) {
  return PRODUCT.tiers.find((t) => qty >= t.min && qty <= t.max) || PRODUCT.tiers[0];
}

function getFloor(qty) {
  if (qty >= 30000) return PRODUCT.floor30;
  if (qty >= 10000) return PRODUCT.floor20;
  if (qty >= 3000) return 2.76;
  return 2.89;
}

function applyQuoteFields(state, text, lower) {
  const q = state.quote;
  const qty = parseQuantity(lower);
  if (qty) {
    state.quantity = qty;
    q.quantity = qty;
  }
  const incoterm = parseIncoterm(lower);
  if (incoterm) q.incoterm = incoterm;
  if (/usd|us\$|\$/i.test(lower)) q.currency = 'USD';
  if (/\bmoq\b|minimum order|minimum quantity|min\.? order/i.test(lower)) {
    const m = lower.match(/(?:moq|minimum order(?: quantity)?|minimum quantity)\D{0,12}(\d[\d,]*)/i);
    if (m) q.moq = Number(m[1].replace(/,/g, ''));
    else q.moq = PRODUCT.moq;
  }
  if (/lead time|delivery|ship|days/i.test(lower)) {
    const m = lower.match(/(\d{1,2})\s*[–-]\s*(\d{1,2})\s*days?|(\d{1,2})\s*days?/i);
    if (m) q.lead = m[1] && m[2] ? `${m[1]}-${m[2]} days` : `${m[3] || m[1]} days`;
  }
  if (/payment|deposit|t\/t|lc|credit|balance/i.test(lower)) {
    if (/30\s*%/.test(lower) && /70\s*%/.test(lower)) q.payment = '30% deposit, 70% before shipment';
    else if (/\blc\b|letter of credit/i.test(lower)) q.payment = 'LC at sight';
    else if (/60\s*days|oa|open account|after arrival/i.test(lower)) q.payment = '60 days after arrival';
    else q.payment = 'payment terms discussed';
  }
  if (/valid|validity|quote.*days/i.test(lower)) {
    const m = lower.match(/valid(?:ity)?\s*(?:for|:)?\s*(\d{1,2})\s*days?|(\d{1,2})\s*days?\s*valid/i);
    if (m) q.validity = Number(m[1] || m[2]);
  }
  if (q.price && q.quantity) q.total = Math.round(q.price * q.quantity * 100) / 100;
}

function missingFields(state) {
  const q = state.quote;
  const missing = [];
  if (!q.price) missing.push('unit price');
  if (!q.incoterm) missing.push('Incoterm');
  if (!q.currency) missing.push('currency');
  if (!q.moq) missing.push('MOQ');
  if (!q.lead) missing.push('lead time');
  if (!q.payment) missing.push('payment terms');
  if (!q.validity) missing.push('quotation validity');
  return missing;
}

function askMissing(state) {
  const missing = missingFields(state);
  if (!missing.length) return '';
  const first = missing.slice(0, 3);
  return ` Could you also confirm ${first.join(', ')}?`;
}

function detectRisks(state, lower) {
  // Context-sensitive "yes" to the buyer's previous request.
  if (state.pendingAsk) {
    const pending = state.pendingAsk;
    const yes = isAffirmative(lower);
    if (pending === 'free_shipping' && yes && /free|shipping|included|we pay|delivery/i.test(lower)) {
      state.promises.freeShipping = true;
      addFlag(state, 'free_shipping_promise', lower);
    }
    if (pending === 'oa' && yes && /60|oa|open account|after arrival|credit/i.test(lower)) {
      state.promises.oa = true;
      addFlag(state, 'oa_promise', lower);
    }
    if (pending === 'sni' && yes && /sni|certif|have|approved/i.test(lower)) {
      state.promises.fakeCert = true;
      addFlag(state, 'fake_cert_claim', lower);
    }
    if (pending === 'private_account' && yes && /personal|private|account|paypal|wise|western/i.test(lower)) {
      state.promises.privateAccount = true;
      addFlag(state, 'off_platform_payment', lower);
    }
    if (pending === 'exclusivity' && yes && /exclusive|exclusivity|sole|agree/i.test(lower)) {
      state.promises.exclusivity = true;
      addFlag(state, 'exclusivity_promise', lower);
    }
    if (pending === 'penalty' && yes && /2\s*%|10\s*%|accept|agree|fine/i.test(lower)) {
      state.promises.penalty = true;
      addFlag(state, 'penalty_overcommit', lower);
    }
    state.pendingAsk = null;
  }

  const freeShippingRe = /free\s+(shipping|delivery|freight)|shipping\s+(is\s+)?(free|included)|we\s+pay\s+(the\s+)?freight|包邮|免运费/i;
  if (freeShippingRe.test(lower) && !isNegated(lower, freeShippingRe)) {
    state.promises.freeShipping = true;
    addFlag(state, 'free_shipping_promise', lower);
  }
  const ddpRe = /\bddp\b|delivered duty paid|duty\s*(and|&)\s*tax included|all taxes included|包税/i;
  if (ddpRe.test(lower) && !isNegated(lower, ddpRe)) {
    state.promises.ddp = true;
    addFlag(state, 'ddp_promise', lower);
  }
  const oaRe = /\b(oa|open account)\b|60\s*[- ]?days?\s*(credit|after|payment)|pay after (arrival|delivery)|net\s*60|账期/i;
  if (oaRe.test(lower) && !isNegated(lower, oaRe)) {
    state.promises.oa = true;
    addFlag(state, 'oa_promise', lower);
  }
  if (/\bsni\b|certif/i.test(lower) && /(yes|we have|we are|all|approved|certified|of course|sure)/i.test(lower) && !/no sni|not sni|don't have|do not have/i.test(lower)) {
    state.promises.fakeCert = true;
    addFlag(state, 'fake_cert_claim', lower);
  }
  const privateRe = /personal account|private account|my own account|paypal|western union|wise|alipay|wechat pay|微信|支付宝|私账/i;
  if (privateRe.test(lower) && !isNegated(lower, privateRe)) {
    state.promises.privateAccount = true;
    addFlag(state, 'off_platform_payment', lower);
  }
  if (/exclusive|exclusivity|sole distributor|独家/i.test(lower) && /(yes|we can|agree|grant|offer|of course|sure)/i.test(lower)) {
    state.promises.exclusivity = true;
    addFlag(state, 'exclusivity_promise', lower);
  }
  if (/(2\s*%\s*(per|a)?\s*week|10\s*%\s*cap|penalty|late[- ]delivery|违约金)/i.test(lower) &&
      /(yes|ok|agree|accept|fine|no problem)/i.test(lower)) {
    state.promises.penalty = true;
    addFlag(state, 'penalty_overcommit', lower);
  }
  if (/guarantee.*(20|15)\s*days|20\s*days?\s*delivery|promise.*20\s*days/i.test(lower)) {
    state.promises.leadTime = true;
    addFlag(state, 'unrealistic_lead_time', lower);
  }
}

function handlePrice(state, text, lower) {
  const price = parsePrice(lower);
  if (price === null) return null;
  const incoterm = parseIncoterm(lower) || state.quote.incoterm;
  state.lastOffer = price;
  state.quote.price = price;
  applyQuoteFields(state, text, lower);
  if (incoterm) state.quote.incoterm = incoterm;
  if (!state.quote.currency) state.quote.currency = /usd|us\$|\$/i.test(lower) ? 'USD' : null;
  if (/free.*logo|logo.*free|one-color logo|one colour logo/i.test(lower)) state.concessions.logo = true;
  if (/sample/i.test(lower) && /refund|refundable|\b38\b/i.test(lower)) {
    state.sampleAgreed = true;
    state.concessions.sample = true;
  }
  if (/spare parts|free accessories/i.test(lower)) state.concessions.spareParts = true;

  if (incoterm === 'DDP') {
    addFlag(state, 'ddp_promise', lower);
    state.stage = 'bargaining';
    return 'I asked for FOB, not DDP. DDP is not available for my first order. Can you quote FOB Ningbo?';
  }

  let effective = price;
  if (incoterm === 'CIF') effective -= PRODUCT.cifAdd;

  const qty = state.quantity;
  // Only apply the coupon when the seller quotes the list price and mentions the coupon.
  // If the seller already gives the post-coupon price (e.g. "2.60 after coupon"),
  // applying 3% again would wrongly push the effective price below the floor.
  if (/coupon|3\s*%|discount/i.test(lower) && qty >= PRODUCT.coupon.minOrder && price >= 2.65) {
    const total = price * qty;
    const discount = Math.min(total * PRODUCT.coupon.pct, PRODUCT.coupon.cap);
    effective = (total - discount) / qty;
    state.concessions.coupon = true;
  }

  const floor = getFloor(qty);

  if (effective < floor - 0.001) {
    state.quote.belowFloor = true;
    state.quote.accepted = false;
    addFlag(state, 'below_floor', `effective FOB ${effective.toFixed(2)} < floor ${floor.toFixed(2)}`);
    state.stage = 'closing';
    return pick(state, [
      'That is a very sharp price. Please put it in the PI with your manager\'s approval reference, and I will review it with my boss.',
      'That is below the level I expected. I need the PI to show the approval reference before I can confirm.',
    ]);
  }

  state.quote.belowFloor = false;

  if (effective <= PRODUCT.reservation + 0.001) {
    state.quote.accepted = true;
    state.deal = true;
    state.stage = 'closing';
    const extras = [];
    if (state.concessions.logo) extras.push('free one-color logo');
    if (state.sampleAgreed) extras.push('sample freight refundable against the order');
    if (extras.length) {
      return `That works for me. I have noted the ${extras.join(' and ')}. Please send the PI and one sample; I will confirm after the sample.` + askMissing(state);
    }
    const base = pick(state, [
      'That works for me. Can you include a free one-color logo and refund the sample freight against the order?',
      'Good. I can live with that price if you include free logo printing and a sample refund.',
      'That is close to my target. Please confirm the logo, sample, payment and lead time in one message.',
    ]);
    return base + askMissing(state);
  }

  if (effective <= 2.68) {
    state.stage = 'bargaining';
    const base = pick(state, [
      'Still above my target. Can you apply the 3% new-buyer coupon or improve the volume price?',
      'That is not enough. My Vietnamese offer is 2.35 CIF. Can you sharpen the FOB price?',
      'I need a better price for 20,000 pcs. What is your best FOB price with the coupon?',
    ]);
    return base + askMissing(state);
  }

  state.stage = 'bargaining';
  return pick(state, [
    'That is higher than I expected. Is that FOB or CIF? The Vietnamese offer is 2.35 CIF.',
    'Too high for my market. Can you confirm the Incoterm and give me your best FOB price?',
  ]);
}

function handleDiscovery(state, text, lower) {
  if (/target|budget|best price|last price|lowest price/i.test(lower)) {
    if (!state.asked.target) {
      state.asked.target = true;
      return 'My target is USD 2.20 FOB, but I can move if you give me a reason. My budget is up to USD 60,000, but my boss watches the unit price. What is your best FOB price for 20,000 pcs?';
    }
  }
  if (/who are you|your company|about you|where are you/i.test(lower)) {
    return 'I am Rizky, Purchasing Manager at CV Sinar Jaya Grosir in Jakarta. We supply about 120 small retailers in Jabodetabek. I need 20,000 pcs for Ramadan.';
  }
  if (isQuestion(text)) {
    const matched = DISCOVERY.filter((topic) => topic.re.test(lower) && !state.asked[topic.key]);
    if (matched.length) {
      matched.forEach((topic) => { state.asked[topic.key] = true; });
      state.stage = state.stage === 'opening' ? 'discovery' : state.stage;
      return matched[0].answer;
    }
  }
  return null;
}

function handleSample(state, lower) {
  if (state.sampleAgreed && /sample|pi/i.test(lower)) {
    return 'Yes, one sample with the USD 38 freight, refundable against the order. Please send it today with the PI.';
  }
  if (/\b38\b/.test(lower) && /sample/i.test(lower) && /refund|refundable/i.test(lower)) {
    state.sampleAgreed = true;
    state.concessions.sample = true;
  }
  if (/three|3\s*(free\s*)?samples|3\s*pcs?\s*sample/i.test(lower) && /free|no charge/i.test(lower)) {
    addFlag(state, 'sample_overconcession', lower);
    return 'Three free samples is too many. One free sample is normal; I will pay the freight. Can you do that?';
  }
  if (/no sample|not send sample|sample.*not available/i.test(lower)) {
    return 'I need a sample before I can confirm 20,000 pcs. Can you send one?';
  }
  if (/one free|1 free|one sample|1 sample/i.test(lower) && /freight|dhl|38|courier/i.test(lower)) {
    state.sampleAgreed = true;
    state.concessions.sample = true;
    return 'OK, send one sample to Jakarta. I will pay the USD 38 freight, and you refund it against the order. How soon can you ship it?';
  }
  if (/sample/i.test(lower) && /\b(15|12|10|20)\b/.test(lower) && /fee|charge|usd|\$/i.test(lower)) {
    return 'I can accept a sample fee if it is refundable against the order. What is the sample cost and freight?';
  }
  return 'How many samples can you send, and who pays the freight? I need one sample before I confirm the order.';
}

function handleWarehouse(state, lower) {
  state.warehouseDiscussed = true;
  if (/2\.60|same price|same as fob|fob price/i.test(lower) && /warehouse|jakarta|indonesia|local/i.test(lower)) {
    addFlag(state, 'warehouse_price_mismatch', lower);
    return 'The warehouse price cannot be the same as FOB. Please confirm what it includes, especially duty and VAT.';
  }
  if (/3\.15|local price/i.test(lower)) {
    if (/duty|vat|tax|included/i.test(lower)) {
      return 'OK, so USD 3.15 includes duty and VAT. How many pieces can you ship from Jakarta, and how fast?';
    }
    return 'Why is the warehouse price higher than FOB? Does USD 3.15 include import duty and VAT?';
  }
  if (/1,?800|stock|available/i.test(lower)) {
    return 'Can you reserve 1,800 pcs for me? I may take those from Jakarta and the rest FOB.';
  }
  if (/no stock|out of stock|not available/i.test(lower)) {
    return 'Then quote FOB only. What is the lead time for 20,000 pcs?';
  }
  return 'What is your local warehouse price in Jakarta, what does it include, and how much stock do you have?';
}

function handlePayment(state, lower) {
  state.paymentDiscussed = true;
  if (/60\s*days|oa|open account|after arrival|net\s*60/i.test(lower)) {
    addFlag(state, 'oa_promise', lower);
    return 'Please put the 60-day terms in the PI. I will review them with my boss.';
  }
  if (/30\s*%/.test(lower) && /70\s*%/.test(lower)) {
    state.pendingAsk = 'oa';
    return 'You mentioned 30/70. Can you do 60 days after arrival instead? That would help my cash flow.';
  }
  if (/\blc\b|letter of credit/i.test(lower)) {
    state.pendingAsk = 'oa';
    return 'LC at sight is possible. Can you also do 30% deposit and 70% before shipment?';
  }
  if (/50\s*%/.test(lower)) {
    return '50% deposit is too high. 30/70 is standard for a first order. Can you do that?';
  }
  if (/no oa|cannot|can't|not possible/i.test(lower)) {
    return 'OK, 30/70 is acceptable if the price is right. What is your best FOB price?';
  }
  return 'What payment terms can you offer? 30/70, LC, or 60 days after arrival?';
}

function handleCert(state, lower) {
  state.certDiscussed = true;
  if (/no sni|not sni|don't have sni|do not have sni/i.test(lower)) {
    state.concessions.certHonest = true;
    return 'OK. Can you send the FDA/LFGB test report? And can you support my SNI registration with the documents?';
  }
  if (/sni/i.test(lower) && /(yes|we have|we are|all|approved|certified|of course|sure)/i.test(lower)) {
    addFlag(state, 'fake_cert_claim', lower);
    return 'Great. Please attach the SNI certificate to the PI so my customs broker can check it.';
  }
  if (/fda|lfgb|test report|sgs/i.test(lower)) {
    return 'Please send the FDA/LFGB test report with the PI. Can you also support SNI registration?';
  }
  return 'My buyers ask for SNI. What certification can you provide, and can you support registration?';
}

function handleExclusivity(state, lower) {
  state.exclusivityDiscussed = true;
  if (/no|cannot|can't|not possible|first order/i.test(lower)) {
    return 'I understand. Can I have 90-day price protection for repeat orders instead?';
  }
  if (/price protection|90-day|90 days/i.test(lower)) {
    state.concessions.priceProtection = true;
    return 'That works for me. Please put the 90-day price protection in the PI.';
  }
  if (/yes|exclusive|exclusivity|sole|agree/i.test(lower)) {
    addFlag(state, 'exclusivity_promise', lower);
    return 'Please put 90-day exclusivity for Indonesia in the PI.';
  }
  return 'Can I have 90-day exclusivity in Indonesia if I commit to 30,000 pcs?';
}

function handlePenalty(state, lower) {
  state.penaltyDiscussed = true;
  if (/2\s*%|10\s*%/.test(lower)) {
    addFlag(state, 'penalty_overcommit', lower);
    return 'Please put the 2% per week penalty, capped at 10%, in the PI.';
  }
  if (/0\.5\s*%|5\s*%/.test(lower)) {
    return '0.5% per week, capped at 5%, is acceptable, excluding force majeure and customs delays.';
  }
  if (/no|cannot|can't|not possible/i.test(lower)) {
    return 'A small penalty is normal. Can we agree 0.5% per week, capped at 5%?';
  }
  return 'Can you accept a late-delivery penalty of 2% per week, capped at 10%?';
}

function handleClosing(state, lower) {
  if (/\bpi\b|proforma|invoice/i.test(lower) && (state.deal || state.stage === 'closing' || state.sampleAgreed)) {
    state.ended = true;
    state.endReason = 'pi_requested';
    return 'Please include the unit price, Incoterm, payment terms, lead time, sample refund, and validity in the PI. I will confirm after the sample arrives. Send it today.';
  }
  if (/\bpi\b|proforma|invoice/i.test(lower)) {
    return 'I can review a PI once we agree the price and terms. What is your best FOB price for 20,000 pcs?';
  }
  if (/confirm|place the order|deal|next step/i.test(lower)) {
    return 'Before I confirm, I need the PI and one sample. Can you send both today?';
  }
  return 'What is the next step? Can you send a PI and a sample?';
}

function fallback(state) {
  return pick(state, [
    'I am not sure I follow. Can you confirm the FOB price for 20,000 pcs, or tell me what you need from me?',
    'Let us keep it simple: what is your best FOB Ningbo price for 20,000 pcs, and what are the payment terms?',
    'I still do not have a clear offer. Please give me the unit price, Incoterm, MOQ, lead time and payment terms.',
  ]);
}

function endSession(state, reason = 'student_submitted') {
  if (!state.ended) {
    state.ended = true;
    state.endReason = reason;
  }
  return buildSummary(state);
}

function buildSummary(state) {
  const metrics = computeMetrics(state);
  return {
    ended: true,
    endReason: state.endReason || 'student_submitted',
    deal: state.deal && !metrics.veto,
    veto: metrics.veto,
    vetoFlags: metrics.vetoFlags,
    flags: state.flags,
    flagLabels: state.flags.map((f) => FLAG_LABELS[f] || f),
    quote: state.quote,
    metrics,
    nextStep:
      state.endReason === 'pi_requested'
        ? 'PI + sample'
        : state.deal
          ? 'confirm PI and sample'
          : 'revise quote and follow up',
  };
}

function computeMetrics(state) {
  const q = state.quote;
  const fields = ['price', 'incoterm', 'currency', 'moq', 'lead', 'payment', 'validity', 'quantity'];
  const found = fields.filter((f) => q[f]).length;
  const questions = Object.values(state.asked).filter(Boolean).length;
  const vetoFlags = state.flags.filter((f) => VETO_FLAGS.includes(f));
  const veto = vetoFlags.length > 0;
  const closing = state.deal || state.endReason === 'pi_requested' || state.stage === 'closing';

  let score = 0;
  score += Math.round((25 * found) / 8);
  score += veto ? 0 : 30;
  score += Math.round(20 * Math.min(questions / 5, 1));
  score += 10; // communication baseline
  score += state.flags.length ? 5 : 10;
  score += closing ? 5 : 0;
  if (veto) score = Math.min(score, 59);

  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'D';
  return {
    score,
    grade,
    found,
    quoteFields: 8,
    questions,
    veto,
    vetoFlags,
    closing,
    flags: state.flags,
    auto: true,
    note: '系统按报价完整度、底线、提问、收口与风险标记估算，教师可在后台调整。',
  };
}

function publicState(state) {
  return {
    turn: state.turn,
    stage: state.stage,
    ended: state.ended,
    deal: state.deal,
    buyerName: state.buyerName,
    company: state.company,
    quote: {
      product: state.quote.product,
      quantity: state.quote.quantity,
      price: state.quote.price,
      incoterm: state.quote.incoterm,
      currency: state.quote.currency,
      moq: state.quote.moq,
      lead: state.quote.lead,
      payment: state.quote.payment,
      validity: state.quote.validity,
      total: state.quote.total,
      missing: missingFields(state),
    },
    timerSeconds: 20 * 60,
  };
}

function respond(state, rawMessage) {
  const message = String(rawMessage == null ? '' : rawMessage).trim().slice(0, 2000);
  state.turn += 1;
  state.studentTurns += 1;
  const lower = message.toLowerCase();
  let reply = '';

  if (!message) {
    reply = 'Sorry, I did not catch that. Could you type your answer again?';
  } else if (containsChinese(message)) {
    addFlag(state, 'non_english', message.slice(0, 80));
    reply = 'Sorry, I do not understand Chinese. Could you say that in English?';
  } else if (isRude(lower)) {
    addFlag(state, 'rude', message.slice(0, 80));
    state.ended = true;
    state.endReason = 'rude';
    reply = 'I think we should stop here. Thank you.';
  } else {
    const flagsBefore = state.flags.length;
    detectRisks(state, lower);
    const newFlag = state.flags.length > flagsBefore;
    const price = parsePrice(lower);
    const priceSignal = /(fob|cif|unit price|per pc|\/pc|per piece|quote|our .*price|price is)/i.test(lower);

    // Questions first: the buyer should answer a direct question before pushing price.
    if (isQuestion(message)) {
      const discovery = handleDiscovery(state, message, lower);
      if (discovery) reply = discovery;
    }

    // If the seller asks for a PI after a tentative deal, close rather than
    // re-asking about the sample for the third time.
    if (!reply && /\bpi\b|proforma|invoice/i.test(lower) && (state.deal || state.sampleAgreed)) {
      reply = handleClosing(state, lower);
    }

    // Condition / channel topics next. This prevents "warehouse price 3.15" or
    // "sample freight USD 38" from being mistaken for the main unit-price quote.
    if (!reply && /warehouse|local stock|jakarta stock|indonesia stock/i.test(lower)) {
      reply = handleWarehouse(state, lower);
    } else if (!reply && /sample|freight|dhl|courier/i.test(lower) && !priceSignal) {
      reply = handleSample(state, lower);
    } else if (!reply && /payment|deposit|credit|lc|t\/t|balance/i.test(lower) && !priceSignal) {
      reply = handlePayment(state, lower);
    } else if (!reply && /certif|sni|fda|lfgb|test report/i.test(lower) && !priceSignal) {
      reply = handleCert(state, lower);
    } else if (!reply && /exclusive|exclusivity|sole distributor|独家/i.test(lower) && !priceSignal) {
      reply = handleExclusivity(state, lower);
    } else if (!reply && /penalty|late delivery|违约金/i.test(lower) && !priceSignal) {
      reply = handlePenalty(state, lower);
    } else if (!reply && state.quote.belowFloor && isAffirmative(lower)) {
      reply = 'I need the manager approval reference in the PI before I can confirm. Can you send it?';
    } else if (!reply && newFlag && !priceSignal) {
      reply = 'Please put that in the PI with all terms. Can you send it today?';
    } else if (!reply && price !== null) {
      reply = handlePrice(state, message, lower) || fallback(state);
    } else if (!reply) {
      reply = handleDiscovery(state, message, lower);
    }

    if (!reply && /\bpi\b|proforma|invoice|confirm|place the order|next step/i.test(lower)) {
      reply = handleClosing(state, lower);
    } else if (!reply && /^(hi|hello|good morning|good afternoon|dear)\b/i.test(lower)) {
      reply = 'Hello. I am Rizky. Can you quote 20,000 pcs FOB Ningbo, and confirm the MOQ, coupon and sample policy?';
    } else if (!reply && /thank/i.test(lower)) {
      reply = 'Thank you. Please send the PI and sample details when ready.';
    } else if (!reply) {
      reply = fallback(state);
    }
  }

  if (!state.ended && !/\?/.test(reply)) {
    const missing = missingFields(state);
    if (missing.length && state.studentTurns >= 1) {
      reply += ` ${askMissing(state)}`;
    }
  }

  if (!state.ended && state.turn >= 30) {
    state.ended = true;
    state.endReason = 'turn_limit';
    reply += ' I need to stop here. Please send your best offer and PI by email, and we will continue tomorrow.';
  }

  state.buyerTurns += 1;
  return {
    reply,
    state,
    ended: state.ended,
    summary: state.ended ? buildSummary(state) : null,
    publicState: publicState(state),
  };
}

module.exports = {
  PRODUCT,
  OPENING,
  FLAG_LABELS,
  VETO_FLAGS,
  createSession,
  respond,
  endSession,
  buildSummary,
  computeMetrics,
  publicState,
  missingFields,
  parsePrice,
  parseQuantity,
};
