/**
 * Runs the built bundle (dist/index.mjs) inside the Vercel Edge Runtime VM
 * (@edge-runtime/vm: no Buffer, process or require; WebCrypto and fetch only) and
 * exercises every provider's signing and verification code against reference
 * values computed here with node:crypto.
 *
 *   pnpm build && pnpm test:edge-smoke
 */
import crypto from 'node:crypto';
import { build } from 'esbuild';
import { EdgeVM } from '@edge-runtime/vm';

const bundle = await build({
  entryPoints: ['dist/index.mjs'],
  bundle: true,
  format: 'iife',
  globalName: 'BP',
  platform: 'neutral',
  write: false,
  logLevel: 'silent',
});

const vm = new EdgeVM();
const env = vm.evaluate(
  '({ buffer: typeof Buffer, process: typeof process, require: typeof require })'
);
if (env.buffer !== 'undefined' || env.process !== 'undefined' || env.require !== 'undefined') {
  throw new Error(`Not an edge-like runtime: ${JSON.stringify(env)}`);
}
vm.evaluate(bundle.outputFiles[0].text);

const PAYTR = { merchantId: '123456', merchantKey: 'KEY', merchantSalt: 'SALT' };
const PARAM_GUID = '0c13d406-873b-403b-9c09-a5766840d98c';
const AKBANK = {
  merchantSafeId: '2023090417500272654BD9A49CF07574',
  terminalSafeId: '2023090417500284633D137A249DBBEB',
  secretKey:
    '3230323330393034313735303032363031353172675f357637355f3273387373745f7233725f73323333383737335f323272383774767276327672323531355f',
};
// Reference 3D_PAY callback (mews/pos Akbank test-suite)
const AKBANK_CALLBACK = {
  txnCode: '1000',
  responseCode: 'VPS-0000',
  responseMessage: 'BAŞARILI',
  hostResponseCode: '00',
  hostMessage: '000 ONAY KODU XXXXXX',
  txnDateTime: '2024-04-18T20:27:45.000',
  merchantSafeId: AKBANK.merchantSafeId,
  terminalSafeId: AKBANK.terminalSafeId,
  cardHolderName: 'TD**',
  orderId: '2024041811DA',
  authCode: '306456',
  rrn: '411024360235',
  batchNumber: '43',
  stan: '86',
  additionalInstallCount: '0',
  deferingMonth: '2',
  ccbEarnedRewardAmount: '0.01',
  ccbBalanceRewardAmount: '215.62',
  ccbRewardDesc: 'CHIP PARA',
  pcbEarnedRewardAmount: '0.00',
  pcbBalanceRewardAmount: '0.00',
  pcbRewardDesc: '',
  xcbEarnedRewardAmount: '0.00',
  xcbBalanceRewardAmount: '0.00',
  xcbRewardDesc: '',
  hashParams:
    'txnCode+responseCode+responseMessage+hostResponseCode+hostMessage+txnDateTime+merchantSafeId+terminalSafeId+orderId+cardHolderName+authCode+rrn+batchNumber+stan+additionalInstallCount+deferingMonth+ccbEarnedRewardAmount+ccbBalanceRewardAmount+ccbRewardDesc+pcbEarnedRewardAmount+pcbBalanceRewardAmount+xcbEarnedRewardAmount+xcbBalanceRewardAmount',
  hash: 'PO/pybfGrY7fesPoAq2U2B1bkpudx659yMyjTnnfP/Cw5MKR1t7mKvRnZdPBxu9nCC7qJFdr3mJSPTdMwYc3SA==',
};
const PARAM_CALLBACK = {
  islemGUID: '35513153-9902-4a4c-a256-af6ed9cadc52',
  md: '581877:A65A349B0BAE27FC6567294215158DD8AE223843B5C96462F04A750CA7E8B165:3680:##500100000',
  mdStatus: '1',
  orderId: '2025011749D1',
  islemHash: 'b1D7+nI3j4k3WGJuhW5IuPOFpEE=',
};

const paytrSign = (data) =>
  crypto.createHmac('sha256', PAYTR.merchantKey).update(data).digest('base64');
const paytrNotification = (status, total) =>
  new URLSearchParams({
    merchant_oid: 'ORDER1',
    status,
    total_amount: total,
    hash: paytrSign('ORDER1' + PAYTR.merchantSalt + status + total),
  }).toString();

const input = {
  PAYTR,
  PARAM_GUID,
  AKBANK,
  AKBANK_CALLBACK,
  PARAM_CALLBACK,
  paytrOk: paytrNotification('success', '10000'),
  paytrForged: paytrNotification('success', '10000').replace(/hash=[^&]+/, 'hash=forged'),
  threeDSHtml: Buffer.from('<form>Ödeme ş</form>', 'utf8').toString('base64'),
};

const scenario = `(async (input) => {
  const calls = [];
  const replies = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: init.body });
    return new Response(replies.shift() ?? '{}');
  };
  const buyer = {
    id: 'B1', name: 'Ali', surname: 'Yılmaz', gsmNumber: '+905350000000', email: 'ali@example.com',
    identityNumber: '74300864791', registrationAddress: 'İstanbul', ip: '85.34.78.112', city: 'İstanbul', country: 'Turkey',
  };
  const address = { contactName: 'Ali Yılmaz', city: 'İstanbul', country: 'Turkey', address: 'Merdivenköy' };
  const order = {
    price: '1000.01', paidPrice: '1000.01', currency: 'TRY', basketId: 'B1', conversationId: '202412293F4E',
    paymentCard: { cardHolderName: 'Ali Yılmaz', cardNumber: '5528790000000008', expireMonth: '12', expireYear: '2030', cvc: '123' },
    buyer, shippingAddress: address, billingAddress: address,
    basketItems: [{ id: 'I1', name: 'Ürün', category1: 'Genel', itemType: 'PHYSICAL', price: '1000.01' }],
  };
  const notified = [];
  const events = [];
  const bp = BP.betterPayment({
    mode: 'sandbox',
    fetch: fetchImpl,
    providers: {
      iyzico: BP.iyzico({ apiKey: 'API', secretKey: 'SECRET' }),
      paytr: BP.paytr(input.PAYTR),
      parampos: BP.parampos({ clientCode: '10738', clientUsername: 'Test', clientPassword: 'Test', guid: input.PARAM_GUID }),
      akbank: BP.akbank(input.AKBANK),
    },
    plugins: [{ id: 'events', events: { '*': (event) => { events.push(event.type); } } }],
    handler: { onCallback: async (result) => { notified.push(result.status); } },
  });
  const out = { version: BP.VERSION };

  // iyzico: HMAC-SHA256 request signature, base64 3DS HTML decoding
  replies.push(JSON.stringify({ status: 'success', paymentId: '42', paymentStatus: 'SUCCESS', fraudStatus: 1 }));
  out.iyzicoPayment = (await bp.use('iyzico').createPayment(order)).status;
  out.iyzicoRequest = calls.at(-1);
  replies.push(JSON.stringify({ status: 'success', threeDSHtmlContent: input.threeDSHtml }));
  out.iyzico3DS = (await bp.use('iyzico').initThreeDSPayment({ ...order, callbackUrl: 'https://example.com/cb' })).threeDSHtmlContent;

  // PayTR: notification HMAC through the HTTP handler, replayed once (idempotency fingerprint)
  const notify = (body) => bp.handler.handle({
    method: 'POST', url: '/api/pay/paytr/callback',
    headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  out.paytrNotification = [await notify(input.paytrOk), await notify(input.paytrOk), await notify(input.paytrForged)]
    .map((r) => r.status + ':' + r.body);
  out.paytrOnCallback = notified;
  out.events = [...events];

  // Parampos: SHA-1 payment hash, 3D callback verification (reference vector)
  replies.push('<Envelope/>');
  await bp.use('parampos').createPayment({ ...order, installment: 3 });
  out.paramposRequest = calls.at(-1).body;
  const before = calls.length;
  out.paramposForged = (await bp.use('parampos').completeThreeDSPayment({ ...input.PARAM_CALLBACK, mdStatus: '1', islemHash: 'forged' })).errorCode;
  replies.push('<Envelope/>');
  await bp.use('parampos').completeThreeDSPayment(input.PARAM_CALLBACK);
  out.paramposGenuineCalledParam = calls.length === before + 1 && calls.at(-1).body.includes('TP_WMD_Pay');

  // Akbank: HMAC-SHA512 callback (reference vector) confirmed by an order history query, request auth-hash
  replies.push(JSON.stringify({ responseCode: 'VPS-0000', txnDetailList: [{ txnCode: '3000', responseCode: 'VPS-0000', txnStatus: 'N', orderId: input.AKBANK_CALLBACK.orderId }] }));
  out.akbankCallback = (await bp.use('akbank').completeThreeDSPayment(input.AKBANK_CALLBACK)).status;
  out.akbankForged = (await bp.use('akbank').completeThreeDSPayment({ ...input.AKBANK_CALLBACK, responseCode: 'VPS-1000' })).errorCode;
  replies.push(JSON.stringify({ responseCode: 'VPS-0000', hostResponseCode: '00', order: { orderId: 'A1' } }));
  await bp.use('akbank').createPayment({ ...order, conversationId: 'A1' });
  out.akbankRequest = calls.at(-1);

  return JSON.stringify(out);
})`;

const out = JSON.parse(await vm.evaluate(scenario)(input));

const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  if (!ok) failures.push(name);
};

// iyzico IYZWSv2: base64("apiKey:..&randomKey:..&signature:hex(HMAC-SHA256(rnd + uri + body))")
{
  const req = out.iyzicoRequest;
  const auth = Buffer.from(req.headers.Authorization.replace('IYZWSv2 ', ''), 'base64').toString();
  const signature = /signature:([0-9a-f]+)/.exec(auth)?.[1];
  const expected = crypto
    .createHmac('sha256', 'SECRET')
    .update(req.headers['x-iyzi-rnd'] + '/payment/auth' + req.body)
    .digest('hex');
  check('iyzico request signature (HMAC-SHA256)', signature === expected, auth);
  check('iyzico payment result', out.iyzicoPayment === 'success', out.iyzicoPayment);
  check(
    'iyzico 3DS HTML base64/UTF-8 decoding',
    out.iyzico3DS === '<form>Ödeme ş</form>',
    out.iyzico3DS
  );
}
check(
  'PayTR notification: verified, replayed once, forged rejected',
  out.paytrNotification[0] === '200:OK' &&
    out.paytrNotification[1] === '200:OK' &&
    out.paytrNotification[2].startsWith('400:'),
  JSON.stringify(out.paytrNotification)
);
check(
  'Plugin events: iyzico payment, PayTR notification once, nothing for the forged one',
  JSON.stringify(out.events) === '["payment.succeeded","payment.succeeded"]',
  JSON.stringify(out.events)
);
check(
  'PayTR onCallback ran once',
  JSON.stringify(out.paytrOnCallback) === '["success"]',
  JSON.stringify(out.paytrOnCallback)
);
{
  // Islem_Hash = base64(sha1(CLIENT_CODE + GUID + Taksit + Islem_Tutar + Toplam_Tutar + Siparis_ID))
  const field = (name) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(out.paramposRequest)?.[1];
  const expected = crypto
    .createHash('sha1')
    .update(
      Buffer.from(
        '10738' +
          PARAM_GUID +
          field('Taksit') +
          field('Islem_Tutar') +
          field('Toplam_Tutar') +
          field('Siparis_ID'),
        'latin1'
      )
    )
    .digest('base64');
  check('Parampos payment hash (SHA-1)', field('Islem_Hash') === expected, field('Islem_Hash'));
}
check(
  'Parampos forged 3D callback rejected',
  out.paramposForged === 'INVALID_HASH',
  out.paramposForged
);
check(
  'Parampos genuine 3D callback finalized with TP_WMD_Pay',
  out.paramposGenuineCalledParam === true
);
check(
  'Akbank 3D callback (HMAC-SHA512 reference vector)',
  out.akbankCallback === 'success',
  out.akbankCallback
);
check('Akbank tampered callback rejected', out.akbankForged === 'INVALID_HASH', out.akbankForged);
{
  const req = out.akbankRequest;
  const expected = crypto.createHmac('sha512', AKBANK.secretKey).update(req.body).digest('base64');
  check('Akbank request auth-hash (HMAC-SHA512)', req.headers['auth-hash'] === expected);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} edge runtime check(s) failed`);
  process.exit(1);
}
console.log(`\nbetter-payment ${out.version} runs in the edge runtime`);
