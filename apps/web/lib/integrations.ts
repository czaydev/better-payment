/**
 * Before/after snippets for the homepage comparison. "Before" is a shortened
 * sketch of calling each provider's own API by hand; "after" is the same job
 * with Better Payment. Lines stay short so both layers align in the slider.
 */
export type IntegrationId = "iyzico" | "paytr" | "parampos" | "sipay" | "akbank" | "kuveytturk" | "est";

export const integrations: {
  id: IntegrationId;
  name: string;
  logo: string;
  kind: "gateway" | "virtualPos" | "bankPos";
  before: { file: string; code: string };
  after: { file: string; code: string };
}[] = [
  {
    id: "iyzico",
    name: "iyzico",
    logo: "/iyzico.svg",
    kind: "gateway",
    before: {
      file: "iyzico-checkout.ts",
      code: `// JSON body + IYZWSv2 signature on every request
const rnd = Date.now() + "123456789";
const uri = "/payment/iyzipos/checkoutform/initialize/auth/ecom";
const signature = createHmac("sha256", secretKey)
  .update(rnd + uri + JSON.stringify(body))
  .digest("hex");
const auth = btoa(
  \`apiKey:\${apiKey}&randomKey:\${rnd}&signature:\${signature}\`,
);

const res = await fetch(baseUrl + uri, {
  method: "POST",
  headers: {
    Authorization: "IYZWSv2 " + auth,
    "x-iyzi-rnd": rnd,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});
// Map iyzico's status and error codes yourself`,
    },
    after: {
      file: "checkout.ts",
      code: `// Hosted checkout form
const result = await payment.iyzico.initCheckoutForm({
  price: "100.00",
  paidPrice: "100.00",
  currency: "TRY",
  basketId: "B1",
  callbackUrl: "https://yoursite.com/checkout/callback",
  buyer: { ... },
  basketItems: [ ... ],
});

// Render result.checkoutFormContent on your page
result.status; // "success" | "failure" | "pending"`,
    },
  },
  {
    id: "paytr",
    name: "PayTR",
    logo: "/paytr.svg",
    kind: "gateway",
    before: {
      file: "paytr-token.ts",
      code: `// Form-encoded request, HMAC-SHA256 token
const hashStr = merchantId + userIp + merchantOid
  + email + paymentAmount + userBasket
  + noInstallment + maxInstallment
  + currency + testMode;
const paytrToken = createHmac("sha256", merchantKey)
  .update(hashStr + merchantSalt)
  .digest("base64");

const res = await fetch(
  "https://www.paytr.com/odeme/api/get-token",
  {
    method: "POST",
    body: new URLSearchParams({ ...fields, paytr_token: paytrToken }),
  },
);
// Notification URL: rebuild the hash, compare it
// in constant time, then answer with "OK"`,
    },
    after: {
      file: "paytr.ts",
      code: `// iFrame payment page
const result = await payment.paytr.initThreeDSPayment({
  price: "250.00",
  paidPrice: "250.00",
  currency: "TRY",
  conversationId: "ORDER123", // becomes merchant_oid
  callbackUrl: "https://yoursite.com/orders/ORDER123",
  buyer: { ... },
  basketItems: [ ... ],
});

// Render result.threeDSHtmlContent (the iFrame).
// The handler verifies the notification and replies "OK".`,
    },
  },
  {
    id: "parampos",
    name: "Parampos",
    logo: "/param.svg",
    kind: "virtualPos",
    before: {
      file: "parampos-soap.ts",
      code: `// SOAP envelope, SHA1 hash over ISO-8859-9 bytes
const hash = sha1Base64(toIso88599(hashFields.join("")));

const envelope = \`<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="...">
  <soap:Body>
    <!-- payment method, card, amount and order fields -->
    <Islem_Hash>\${hash}</Islem_Hash>
  </soap:Body>
</soap:Envelope>\`;

const res = await fetch(endpoint, {
  method: "POST",
  headers: { "Content-Type": "text/xml; charset=utf-8" },
  body: envelope,
});
// Parse the XML response; finalize 3D payments with
// a second call (TP_WMD_Pay) after checking the callback`,
    },
    after: {
      file: "parampos.ts",
      code: `// Non-3D payment, SOAP handled for you
const result = await payment.parampos.createPayment({
  price: "500.00",
  paidPrice: "500.00",
  currency: "TRY",
  conversationId: "ORDER123", // becomes Siparis_ID
  paymentCard: { ... },
  buyer: { ... },
  basketItems: [ ... ],
});

result.paymentId; // "ORDER123"`,
    },
  },
  {
    id: "sipay",
    name: "Sipay",
    logo: "/brand/institutions/sipay.svg",
    kind: "gateway",
    before: {
      file: "sipay-3d.ts",
      code: `// 1. Bearer token from app id + app secret
const { data } = await fetch(base + "/ccpayment/api/token", {
  method: "POST",
  body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
}).then((r) => r.json());

// 2. hash_key: AES-256-CBC over the request fields,
//    key derived from the app secret + random salt
const fields = [total, installment, currency, merchantKey, invoiceId];
const hashKey = aesEncrypt(fields.join("|"), appSecret);

// 3. paySmart3D with the token and hash_key
const res = await fetch(base + "/ccpayment/api/paySmart3D", {
  method: "POST",
  headers: { Authorization: "Bearer " + data.token },
  body: JSON.stringify({ ...order, hash_key: hashKey }),
});
// Callback: decrypt its hash_key and check the status`,
    },
    after: {
      file: "sipay.ts",
      code: `// 3D Secure, token and hash_key handled for you
const init = await payment.sipay.initThreeDSPayment({
  price: "250.00",
  paidPrice: "250.00",
  currency: "TRY",
  conversationId: "ORDER123", // becomes invoice_id
  callbackUrl: "https://yoursite.com/api/pay/sipay/...",
  paymentCard: { ... },
  buyer: { ... },
});

// Callback route: only the signed hash_key is trusted
const result = await payment.sipay.completeThreeDSPayment(body);`,
    },
  },
  {
    id: "akbank",
    name: "Akbank",
    logo: "/akbank.svg",
    kind: "bankPos",
    before: {
      file: "akbank-pos.ts",
      code: `// JSON API, HMAC-SHA512 signature in a header
const body = JSON.stringify({
  terminal: { merchantSafeId, terminalSafeId },
  order: { orderId },
  transaction: { amount, currencyCode: 949 },
  // card, request time, random number, ...
});
const authHash = createHmac("sha512", secretKey)
  .update(body)
  .digest("base64");

const res = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "auth-hash": authHash,
  },
  body,
});
// 3D_PAY callback: recompute and compare its hash`,
    },
    after: {
      file: "akbank.ts",
      code: `// 3D Secure initialization
const init = await payment.akbank.initThreeDSPayment({
  price: "250.00",
  paidPrice: "250.00",
  currency: "TRY",
  conversationId: "ORDER123",
  callbackUrl: "https://yoursite.com/api/pay/akbank/...",
  paymentCard: { ... },
  buyer: { ... },
});

// Callback route: pass the bank's POST body as is
const result = await payment.akbank.completeThreeDSPayment(body);`,
    },
  },
  {
    id: "kuveytturk",
    name: "Kuveyt Türk",
    logo: "/brand/banks/kuveyt-turk.svg",
    kind: "bankPos",
    before: {
      file: "kuveytturk-pos.ts",
      code: `// KT Pay Gate: hashData on every request
const hashPassword = base64(sha1(password));
const hashData = base64(
  hmacSha512(
    merchantId + orderId + amount + okUrl + failUrl
      + userName + hashPassword,
    hashPassword,
  ),
);

const res = await fetch(base + "/KTPay/Payment", {
  method: "POST",
  body: JSON.stringify({ ...order, HashData: hashData }),
});
// The callback is not signed: look the order up at
// the bank, then charge it with a Provision request`,
    },
    after: {
      file: "kuveytturk.ts",
      code: `// 3D Secure initialization
const init = await payment.kuveytturk.initThreeDSPayment({
  price: "250.00",
  paidPrice: "250.00",
  currency: "TRY",
  conversationId: "ORDER123",
  callbackUrl: "https://yoursite.com/api/pay/kuveytturk/...",
  paymentCard: { ... },
  buyer: { ... },
});

// Callback route: verified at the bank, charged with Provision
const result = await payment.kuveytturk.completeThreeDSPayment(body);`,
    },
  },
  {
    id: "est",
    name: "EST",
    logo: "/brand/banks/is-bankasi.svg",
    kind: "bankPos",
    before: {
      file: "est-3d.ts",
      code: `// EST (Asseco) hash version 3: values sorted by
// field name, store key last, joined with "|"
const keys = Object.keys(form).sort((a, b) =>
  a.localeCompare(b, "en", { sensitivity: "base" }));
const plain = [...keys.map((k) => escape(form[k])), storeKey]
  .join("|");
const hash = createHash("sha512").update(plain).digest("base64");

// Auto-submit a form with the hash to the bank's 3D gate
const html = renderForm(gateUrl, { ...form, hash });

// Callback: verify HASHPARAMSVAL, check mdStatus,
// then charge with an XML API <CC5Request> Auth`,
    },
    after: {
      file: "est.ts",
      code: `// One provider for every EST bank
const payment = betterPayment({
  providers: {
    isbank: est({ bank: "isbank", clientId, username, password, storeKey }),
  },
});

const init = await payment.isbank.initThreeDSPayment({
  price: "250.00",
  paidPrice: "250.00",
  currency: "TRY",
  callbackUrl: "https://yoursite.com/api/pay/isbank/...",
  paymentCard: { ... },
});`,
    },
  },
];

export type ProviderGroup = "gateway" | "virtualPos" | "bankPos";

/**
 * The providers shown on the homepage, in order. EST banks share one
 * integration; `bank` swaps the provider key in its snippet.
 */
export const providerTiles: {
  key: string;
  name: string;
  logo?: string;
  integration: IntegrationId;
  group: ProviderGroup;
  bank?: "isbank" | "ziraat" | "halkbank" | "teb" | "sekerbank";
  // akbank.svg carries its own padding, so it needs more room to match the others
  tall?: boolean;
}[] = [
  { key: "iyzico", name: "iyzico", logo: "/iyzico.svg", integration: "iyzico", group: "gateway" },
  { key: "paytr", name: "PayTR", logo: "/paytr.svg", integration: "paytr", group: "gateway" },
  { key: "sipay", name: "Sipay", logo: "/brand/institutions/sipay.svg", integration: "sipay", group: "gateway" },
  { key: "parampos", name: "Parampos", logo: "/param.svg", integration: "parampos", group: "virtualPos" },
  { key: "akbank", name: "Akbank", logo: "/akbank.svg", integration: "akbank", group: "bankPos", tall: true },
  { key: "kuveytturk", name: "Kuveyt Türk", logo: "/brand/banks/kuveyt-turk.svg", integration: "kuveytturk", group: "bankPos" },
  { key: "isbank", name: "İş Bankası", logo: "/brand/banks/is-bankasi.svg", integration: "est", group: "bankPos", bank: "isbank" },
  { key: "ziraat", name: "Ziraat Bankası", logo: "/brand/banks/ziraat.svg", integration: "est", group: "bankPos", bank: "ziraat" },
  { key: "halkbank", name: "Halkbank", logo: "/brand/banks/halkbank.svg", integration: "est", group: "bankPos", bank: "halkbank" },
  { key: "teb", name: "TEB", logo: "/brand/banks/teb.png", integration: "est", group: "bankPos", bank: "teb" },
  { key: "sekerbank", name: "Şekerbank", integration: "est", group: "bankPos", bank: "sekerbank" },
];
