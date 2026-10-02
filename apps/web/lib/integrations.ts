/**
 * Before/after snippets for the homepage comparison. "Before" is a shortened
 * sketch of calling each provider's own API by hand; "after" is the same job
 * with Better Payment. Lines stay short so both layers align in the slider.
 */
export type IntegrationId = "iyzico" | "paytr" | "parampos" | "akbank";

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
];
