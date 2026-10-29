export const PROVIDER_SLUGS = [
  "iyzico",
  "paytr",
  "sipay",
  "parampos",
  "akbank",
  "halkbank",
  "isbank",
  "kuveytturk",
  "sekerbank",
  "teb",
  "ziraat",
] as const;

export type ProviderSlug = (typeof PROVIDER_SLUGS)[number];

export interface ProviderDetail {
  slug: ProviderSlug;
  name: string;
  category: "gateway" | "bank";
  badge: { tr: string; en: string };
  headline: { tr: string; en: string };
  description: { tr: string; en: string };
  docsHref: string;
  features: Array<{ tr: string; en: string }>;
  configCode: string;
}

export const PROVIDERS_DATA: Record<ProviderSlug, ProviderDetail> = {
  iyzico: {
    slug: "iyzico",
    name: "iyzico",
    category: "gateway",
    badge: { tr: "ÖDEME KURULUŞU", en: "PAYMENT GATEWAY" },
    headline: {
      tr: "iyzico ile 3D Secure, Taksit ve Pazar Yeri",
      en: "Full iyzico 3D Secure, Installments & Marketplace",
    },
    description: {
      tr: "iyzico'nun karmaşık PKI imza algoritmaları, alt üye işyeri komisyon dağıtımı ve 3D Secure akışları Better Payment arkasında tek satıra indirgenir.",
      en: "iyzico's PKI signature algorithms, marketplace sub-merchant commission payouts, and 3D Secure flows simplified into a single type-safe interface.",
    },
    docsHref: "/docs/providers/iyzico",
    features: [
      { tr: "3D Secure ve Non-3D doğrudan çekim", en: "3D Secure & direct Non-3D charges" },
      { tr: "Pazar Yeri alt üye işyeri komisyon dağıtımı", en: "Marketplace sub-merchant commission payouts" },
      { tr: "BKM Express ve saklı kart ile ödeme", en: "BKM Express and stored card token checkout" },
      { tr: "Tam & kısmi iade ve gün içi iptal", en: "Full & partial refunds, same-day voids" },
      { tr: "Otomatik BIN sorgulama ve taksit tablosu", en: "Real-time BIN detection & installment table" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "iyzico",
  providers: {
    iyzico: {
      apiKey: process.env.IYZICO_API_KEY!,
      secretKey: process.env.IYZICO_SECRET_KEY!,
      baseUrl: "https://sandbox-api.iyzipay.com"
    }
  }
});`,
  },
  paytr: {
    slug: "paytr",
    name: "PayTR",
    category: "gateway",
    badge: { tr: "ÖDEME KURULUŞU", en: "PAYMENT GATEWAY" },
    headline: {
      tr: "PayTR iFrame ve Direkt API Entegrasyonu",
      en: "PayTR iFrame & Direct API Integration",
    },
    description: {
      tr: "PayTR'ın token oluşturma, iFrame 3D Secure çağrısı ve bildirim URL (webhook) HMAC-SHA256 sabit süreli imza doğrulamasını eksiksiz yönetin.",
      en: "End-to-end token generation, iFrame 3D Secure modals, and constant-time HMAC-SHA256 webhook notification validation.",
    },
    docsHref: "/docs/providers/paytr",
    features: [
      { tr: "iFrame 3D Secure ödeme sayfası token'ı", en: "iFrame 3D Secure checkout page token" },
      { tr: "Bildirim URL (webhook) HMAC-SHA256 doğrulaması", en: "Timing-safe HMAC-SHA256 webhook validation" },
      { tr: "Çoklu para birimi (TRY, USD, EUR, GBP)", en: "Multi-currency processing (TRY, USD, EUR, GBP)" },
      { tr: "Taksit oranları ve komisyon sorgulama", en: "Dynamic installment matrix & commission lookup" },
      { tr: "Kısmi ve tam iade desteği", en: "Full and partial refund execution" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "paytr",
  providers: {
    paytr: {
      merchantId: process.env.PAYTR_MERCHANT_ID!,
      merchantKey: process.env.PAYTR_MERCHANT_KEY!,
      merchantSalt: process.env.PAYTR_MERCHANT_SALT!
    }
  }
});`,
  },
  sipay: {
    slug: "sipay",
    name: "Sipay",
    category: "gateway",
    badge: { tr: "ÖDEME KURULUŞU", en: "PAYMENT GATEWAY" },
    headline: {
      tr: "Sipay Yeni Nesil Ödeme ve Cüzdan Altyapısı",
      en: "Sipay Next-Gen Gateway & Digital Wallet",
    },
    description: {
      tr: "Sipay ile 3D Secure, Non-3D, QR kod ile ödeme, dijital cüzdan entegrasyonu ve tekrarlayan abonelik ödemelerini tek arayüzden yönetin.",
      en: "Orchestrate Sipay 3D Secure, Non-3D, QR code payments, digital wallet tokenization, and recurring subscriptions seamlessly.",
    },
    docsHref: "/docs/providers/sipay",
    features: [
      { tr: "3D Secure ve Non-3D ödeme seçenekleri", en: "3D Secure & Non-3D direct debit options" },
      { tr: "Dijital cüzdan ve kart saklama", en: "Digital wallet & card vault tokenization" },
      { tr: "Tekrarlayan (recurring) abonelik ödemeleri", en: "Recurring subscription billing engine" },
      { tr: "Taksit tablosu ve komisyon hesaplama", en: "Real-time installment and fee calculators" },
      { tr: "Anında iade ve iptal akışları", en: "Instant refund and cancellation workflows" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "sipay",
  providers: {
    sipay: {
      appKey: process.env.SIPAY_APP_KEY!,
      appSecret: process.env.SIPAY_APP_SECRET!,
      merchantKey: process.env.SIPAY_MERCHANT_KEY!
    }
  }
});`,
  },
  parampos: {
    slug: "parampos",
    name: "Parampos",
    category: "gateway",
    badge: { tr: "ÖDEME KURULUŞU", en: "PAYMENT GATEWAY" },
    headline: {
      tr: "Parampos Elektronik Para ve Sanal POS",
      en: "Parampos Electronic Money & Virtual POS",
    },
    description: {
      tr: "Parampos SOAP tabanlı TP_WMD_Pay ve UCD protokollerini temiz bir REST/TypeScript arayüzüne çevirir. Taksit ve komisyon sorgulama dahildir.",
      en: "Translates Parampos SOAP TP_WMD_Pay and UCD protocols into clean, modern TypeScript function calls.",
    },
    docsHref: "/docs/providers/parampos",
    features: [
      { tr: "3D Secure TP_WMD_UCD ve Pay akışı", en: "3D Secure TP_WMD_UCD & Pay workflow" },
      { tr: "Non-3D doğrudan çekim (TRY)", en: "Non-3D direct debit (TRY)" },
      { tr: "Ödeme başına taksit komisyonu hesabı", en: "Installment fee and commission computation" },
      { tr: "İade ve gün içi iptal desteği", en: "Refund and same-day void capability" },
      { tr: "BIN sorgulama ve kart ailesi tespiti", en: "BIN detection & card brand family resolution" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "parampos",
  providers: {
    parampos: {
      clientCode: process.env.PARAM_CLIENT_CODE!,
      clientUsername: process.env.PARAM_USERNAME!,
      clientPassword: process.env.PARAM_PASSWORD!,
      guid: process.env.PARAM_GUID!
    }
  }
});`,
  },
  akbank: {
    slug: "akbank",
    name: "Akbank",
    category: "bank",
    badge: { tr: "BANKA SANAL POS", en: "BANK VIRTUAL POS" },
    headline: {
      tr: "Akbank Sanal POS ve 3D_PAY Entegrasyonu",
      en: "Akbank Virtual POS & 3D_PAY Integration",
    },
    description: {
      tr: "Akbank'ın güncel HMAC-SHA512 imzalı JSON API'si ve 3D_PAY protokolü ile doğrudan banka üzerinden komisyonsuz tahsilat yapın.",
      en: "Connect directly to Akbank's HMAC-SHA512 signed JSON API with 3D_PAY callback verification without third-party fees.",
    },
    docsHref: "/docs/banks/akbank",
    features: [
      { tr: "3D_PAY ve Non-3D çekim desteği", en: "3D_PAY & Non-3D direct charge support" },
      { tr: "HMAC-SHA512 imzalı güvenli istekler", en: "HMAC-SHA512 signed secure requests" },
      { tr: "Sabit zamanlı callback doğrulaması", en: "Timing-safe 3D callback verification" },
      { tr: "Sipariş durumu sorgulama ve iade", en: "Order status lookup, refund & void" },
      { tr: "Axess kartlara özel taksit desteği", en: "Special installment logic for Axess cards" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "akbank",
  providers: {
    akbank: {
      clientId: process.env.AKBANK_CLIENT_ID!,
      username: process.env.AKBANK_USERNAME!,
      password: process.env.AKBANK_PASSWORD!,
      storeKey: process.env.AKBANK_STORE_KEY!
    }
  }
});`,
  },
  isbank: {
    slug: "isbank",
    name: "İş Bankası",
    category: "bank",
    badge: { tr: "BANKA SANAL POS", en: "BANK VIRTUAL POS" },
    headline: {
      tr: "Türkiye İş Bankası EST / VPAY Sanal POS",
      en: "İş Bankası EST / VPAY Virtual POS",
    },
    description: {
      tr: "Maximum özellikli İş Bankası Sanal POS sistemi için 3D Secure 2.x ve 3D_PAY entegrasyonu.",
      en: "Full 3D Secure 2.x and 3D_PAY integration for İş Bankası Maximum virtual POS systems.",
    },
    docsHref: "/docs/banks/isbank",
    features: [
      { tr: "EST / VPAY 3D Secure protokolü", en: "EST / VPAY 3D Secure protocol" },
      { tr: "Maximum kart taksit programı", en: "Maximum installment program support" },
      { tr: "Sabit zamanlı hash doğrulaması", en: "Timing-safe signature checking" },
      { tr: "İade ve iptal fonksiyonları", en: "Refund and cancellation actions" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "isbank",
  providers: {
    isbank: {
      clientId: process.env.ISBANK_CLIENT_ID!,
      username: process.env.ISBANK_USERNAME!,
      password: process.env.ISBANK_PASSWORD!,
      storeKey: process.env.ISBANK_STORE_KEY!
    }
  }
});`,
  },
  halkbank: {
    slug: "halkbank",
    name: "Halkbank",
    category: "bank",
    badge: { tr: "KAMU BANKASI POS", en: "PUBLIC BANK POS" },
    headline: {
      tr: "Halkbank EST Sanal POS Entegrasyonu",
      en: "Halkbank EST Virtual POS Integration",
    },
    description: {
      tr: "Halkbank Paraf kart programı ve kurumsal üye işyeri sanal POS protokolü tam desteklenir.",
      en: "Full Paraf card loyalty program and merchant virtual POS protocol support.",
    },
    docsHref: "/docs/banks/halkbank",
    features: [
      { tr: "3D Secure 2.x doğrulaması", en: "3D Secure 2.x authentication" },
      { tr: "Paraf kart taksit seçenekleri", en: "Paraf installment schedules" },
      { tr: "Tam & kısmi iade desteği", en: "Full and partial refund support" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "halkbank",
  providers: {
    halkbank: {
      clientId: process.env.HALKBANK_CLIENT_ID!,
      username: process.env.HALKBANK_USERNAME!,
      password: process.env.HALKBANK_PASSWORD!,
      storeKey: process.env.HALKBANK_STORE_KEY!
    }
  }
});`,
  },
  kuveytturk: {
    slug: "kuveytturk",
    name: "Kuveyt Türk",
    category: "bank",
    badge: { tr: "KATILIM BANKASI", en: "PARTICIPATION BANK" },
    headline: {
      tr: "Kuveyt Türk Katılım Bankası Sanal POS",
      en: "Kuveyt Türk Participation Bank POS",
    },
    description: {
      tr: "Kuveyt Türk'ün özel XML/SOAP 3D Secure protokolü ve Sağlam Kart taksit altyapısı.",
      en: "Kuveyt Türk's XML/SOAP 3D Secure protocol and Sağlam Kart installment integration.",
    },
    docsHref: "/docs/banks/kuveytturk",
    features: [
      { tr: "Katılım bankacılığı uyumlu çekim", en: "Participation-compliant charges" },
      { tr: "Sağlam Kart taksit desteği", en: "Sağlam Kart installment options" },
      { tr: "Özel XML SOAP imzalama", en: "Custom XML SOAP signature signing" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "kuveytturk",
  providers: {
    kuveytturk: {
      merchantId: process.env.KUVEYT_MERCHANT_ID!,
      customerNumber: process.env.KUVEYT_CUSTOMER_NO!,
      username: process.env.KUVEYT_USERNAME!,
      password: process.env.KUVEYT_PASSWORD!
    }
  }
});`,
  },
  sekerbank: {
    slug: "sekerbank",
    name: "Şekerbank",
    category: "bank",
    badge: { tr: "BANKA SANAL POS", en: "BANK VIRTUAL POS" },
    headline: {
      tr: "Şekerbank EST Sanal POS",
      en: "Şekerbank EST Virtual POS",
    },
    description: {
      tr: "Şekerbank üye işyerleri için 3D Secure ve direkt sanal POS entegrasyonu.",
      en: "3D Secure and direct virtual POS integration for Şekerbank merchants.",
    },
    docsHref: "/docs/banks/sekerbank",
    features: [
      { tr: "EST 3D_PAY protokolü", en: "EST 3D_PAY protocol" },
      { tr: "İade ve iptal yönetimi", en: "Refund and void management" },
      { tr: "Taksit oranları desteği", en: "Installment rates support" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "sekerbank",
  providers: {
    sekerbank: {
      clientId: process.env.SEKERBANK_CLIENT_ID!,
      username: process.env.SEKERBANK_USERNAME!,
      password: process.env.SEKERBANK_PASSWORD!,
      storeKey: process.env.SEKERBANK_STORE_KEY!
    }
  }
});`,
  },
  teb: {
    slug: "teb",
    name: "TEB",
    category: "bank",
    badge: { tr: "BANKA SANAL POS", en: "BANK VIRTUAL POS" },
    headline: {
      tr: "Türk Ekonomi Bankası (TEB) Sanal POS",
      en: "TEB Virtual POS Integration",
    },
    description: {
      tr: "TEB Bonus kart taksit programı ve EST 3D Secure sanal POS entegrasyonu.",
      en: "TEB Bonus loyalty card installments and EST 3D Secure merchant integration.",
    },
    docsHref: "/docs/banks/teb",
    features: [
      { tr: "Bonus kart taksit tablosu", en: "Bonus card installment matrix" },
      { tr: "3D Secure 2.x desteği", en: "3D Secure 2.x support" },
      { tr: "Güvenli hash doğrulaması", en: "Secure hash verification" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "teb",
  providers: {
    teb: {
      clientId: process.env.TEB_CLIENT_ID!,
      username: process.env.TEB_USERNAME!,
      password: process.env.TEB_PASSWORD!,
      storeKey: process.env.TEB_STORE_KEY!
    }
  }
});`,
  },
  ziraat: {
    slug: "ziraat",
    name: "Ziraat Bankası",
    category: "bank",
    badge: { tr: "KAMU BANKASI POS", en: "PUBLIC BANK POS" },
    headline: {
      tr: "Ziraat Bankası Bankkart Sanal POS",
      en: "Ziraat Bankası Bankkart Virtual POS",
    },
    description: {
      tr: "Türkiye'nin en geniş kart tabanına sahip Ziraat Bankkart için EST 3D Secure sanal POS entegrasyonu.",
      en: "EST 3D Secure virtual POS integration for Turkey's largest cardholder base, Ziraat Bankkart.",
    },
    docsHref: "/docs/banks/ziraat",
    features: [
      { tr: "Bankkart taksit programı", en: "Bankkart installment schedules" },
      { tr: "EST 3D_PAY güvenli ödeme", en: "EST 3D_PAY secure transactions" },
      { tr: "Tam ve kısmi iade desteği", en: "Full and partial refund support" },
    ],
    configCode: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "ziraat",
  providers: {
    ziraat: {
      clientId: process.env.ZIRAAT_CLIENT_ID!,
      username: process.env.ZIRAAT_USERNAME!,
      password: process.env.ZIRAAT_PASSWORD!,
      storeKey: process.env.ZIRAAT_STORE_KEY!
    }
  }
});`,
  },
};
