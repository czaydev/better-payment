import type { Locale } from "./config";

const en = {
  meta: {
    title: "better-payment — Unified Payment Gateway for Node.js",
    description:
      "A unified, type-safe payment gateway library for Node.js and edge runtimes. Integrate iyzico, PayTR, Parampos and Akbank with a single consistent API and verified callbacks.",
    docsTitleSuffix: "better-payment docs",
  },
  nav: {
    features: "Features",
    providers: "Providers",
    quickStart: "Quick Start",
    docs: "Docs",
    openMenu: "Open menu",
    language: "Language",
  },
  hero: {
    badge: "A fresh start: see what changed",
    titleLine1: "One API for",
    titleLine2: "Turkish payments.",
    lead: "gives iyzico, PayTR, Parampos and Akbank one type-safe interface, with signature-verified callbacks and a secure-by-default HTTP handler.",
    getStarted: "Get Started",
    star: "Star on GitHub",
    stats: [
      { value: "4", label: "Providers" },
      { value: "0", label: "Runtime dependencies" },
      { value: "TS", label: "Typed end to end" },
      { value: "MIT", label: "License" },
    ],
  },
  trustBar: {
    title: "Works with Node.js and edge runtimes",
  },
  compare: {
    eyebrow: "The problem",
    titleLine1: "Every gateway has a",
    titleLine2: "completely different API.",
    lead: "Different request shapes, signatures, error formats and callback rules. better-payment implements each one against the provider's specification and gives you one set of types to work with.",
    without: "Without",
    with: "With better-payment",
    points: [
      "One interface, four providers",
      "Shared result statuses",
      "Callbacks verified for you",
      "TypeScript-first",
    ],
  },
  features: {
    eyebrow: "Features",
    titleLine1: "Everything you need,",
    titleLine2: "nothing you don't.",
    items: {
      unified: {
        title: "Unified API surface",
        description:
          "createPayment, initThreeDSPayment, refund, cancel and getPayment take the same request types on every provider and return the same result shape.",
      },
      typescript: {
        title: "TypeScript-first",
        description: "Typed requests, results and configuration, with no any types in the public API.",
      },
      footprint: {
        title: "Zero dependencies",
        description:
          "No runtime dependencies, ESM and CJS builds, and a browser-safe client. Runs on Node.js, Vercel Edge, Cloudflare Workers, Deno and Bun.",
      },
      callbacks: {
        title: "Verified callbacks",
        description:
          "3D Secure callbacks and PayTR notifications are checked against your own credentials, in constant time, before anything counts as paid.",
      },
      handler: {
        title: "Secure-by-default handler",
        description:
          "The HTTP handler exposes only callbacks and card queries by default. Refunds, cancels and lookups require an authorize hook.",
      },
      doubleCharge: {
        title: "No double charges",
        description:
          "A timeout returns pending with NETWORK_ERROR instead of guessing. Payment, refund and cancel requests are never retried automatically.",
      },
      iyzico: {
        title: "iyzico extras",
        description:
          "Hosted checkout form, pay with IBAN (PWI) and subscription billing: products, pricing plans and card updates. These are iyzico-only APIs.",
      },
      multi: {
        title: "Several providers, one config",
        description:
          "Enable multiple providers and choose one per call with payment.use(). Provider-specific setup, like callback URLs, still applies.",
      },
    },
  },
  providers: {
    eyebrow: "Payment gateways",
    titleLine1: "Three gateways,",
    titleLine2: "one set of types.",
    capabilities: "Capabilities",
    example: "Example",
    gateway: "Payment gateway",
    virtualPos: "Virtual POS (SOAP)",
    iyzico: {
      description:
        "IYZWSv2-signed JSON API with non-3D and 3D Secure payments, a hosted checkout form, pay with IBAN (PWI), subscriptions, and BIN and installment queries.",
      features: [
        "Non-3D & 3D Secure",
        "Hosted checkout form",
        "Pay with IBAN (PWI)",
        "Subscriptions",
        "BIN & installment queries",
        "Refund, cancel, status",
      ],
    },
    paytr: {
      description:
        "iFrame payment page with HMAC-signed requests. Results arrive as server notifications, which the handler verifies and answers with OK.",
      features: [
        "iFrame payment page",
        "Verified notifications",
        "BIN & installment rates",
        "Partial & full refunds",
        "Status queries",
        "Test mode",
      ],
    },
    parampos: {
      description:
        "The SOAP API behind the same interface: 3D payments finalized with TP_WMD_Pay, non-3D payments, refunds, cancels, and status and BIN queries. TRY only.",
      features: [
        "3D Secure (TP_WMD_UCD / Pay)",
        "Non-3D payments",
        "Installment count per payment",
        "Refund & cancel",
        "Status queries",
        "BIN lookup",
      ],
    },
  },
  banks: {
    eyebrow: "Direct bank integrations",
    titleLine1: "Bank virtual POS,",
    titleLine2: "same interface.",
    lead: "Talk to a bank's virtual POS directly, without a payment institution in between, using the same request and result types.",
    akbankTagline: "Sanal POS · direct integration",
    akbankDescription:
      "Akbank's Sanal POS JSON API with HMAC-SHA512 signed requests, signature-verified 3D Secure (3D_PAY) callbacks, refunds, voids and order status queries.",
    highlights: [
      { label: "HMAC-SHA512", desc: "Signed requests & callbacks" },
      { label: "2D & 3D Secure", desc: "Both flows supported" },
      { label: "Verified Callbacks", desc: "3D results checked with your key" },
      { label: "Direct API", desc: "No third-party middleware" },
    ],
    viewDocs: "View Akbank docs",
    example: "Example",
    roadmap: "On the roadmap",
  },
  quickStart: {
    eyebrow: "Quick start",
    titleLine1: "Up and running",
    titleLine2: "in minutes.",
    steps: ["Install the package", "Configure your providers", "Start a 3D Secure payment"],
    fullDocs: "View full documentation",
  },
  cta: {
    eyebrow: "Open Source · MIT License",
    titleLine1: "Stop rewriting",
    titleLine2: "payment logic.",
    lead: "One package for iyzico, PayTR, Parampos and Akbank, with full TypeScript support. Upgrading from 3.x? Read",
    whatsNew: "what's new since the reset",
    readDocs: "Read the Docs",
    github: "View on GitHub",
  },
  footer: {
    tagline: "A unified, type-safe payment gateway library for Node.js, edge runtimes and TypeScript.",
    groups: {
      product: "Product",
      documentation: "Documentation",
      providers: "Providers",
      resources: "Resources",
    },
    links: {
      features: "Features",
      providers: "Providers",
      quickStart: "Quick Start",
      docs: "Docs",
      introduction: "Introduction",
      installation: "Installation",
      configuration: "Configuration",
      apiReference: "API Reference",
      issues: "Issues",
      whatsNew: "What's new",
      changelog: "Changelog",
    },
    license: "Released under the MIT License.",
    builtWith: "Built with Next.js, Tailwind CSS & shadcn/ui",
  },
  docs: {
    fallbackNotice:
      "This page has not been translated into English yet, so it is shown in Turkish.",
  },
  fumadocs: {
    displayName: "English",
  },
};

export type Dictionary = typeof en;

const tr: Dictionary = {
  meta: {
    title: "better-payment — Node.js için birleşik ödeme altyapısı",
    description:
      "Node.js ve edge ortamları için tip güvenli, birleşik ödeme kütüphanesi. iyzico, PayTR, Parampos ve Akbank'ı tek bir tutarlı API ve doğrulanmış callback'lerle entegre edin.",
    docsTitleSuffix: "better-payment dokümantasyonu",
  },
  nav: {
    features: "Özellikler",
    providers: "Sağlayıcılar",
    quickStart: "Hızlı Başlangıç",
    docs: "Dokümantasyon",
    openMenu: "Menüyü aç",
    language: "Dil",
  },
  hero: {
    badge: "Yeni bir başlangıç: nelerin değiştiğini görün",
    titleLine1: "Türk ödeme sistemleri",
    titleLine2: "için tek API.",
    lead: "iyzico, PayTR, Parampos ve Akbank'ı tek bir tip güvenli arayüzde toplar; imzası doğrulanan callback'ler ve varsayılan olarak güvenli bir HTTP handler sunar.",
    getStarted: "Başlayın",
    star: "GitHub'da yıldızlayın",
    stats: [
      { value: "4", label: "Sağlayıcı" },
      { value: "0", label: "Runtime bağımlılığı" },
      { value: "TS", label: "Uçtan uca tipli" },
      { value: "MIT", label: "Lisans" },
    ],
  },
  trustBar: {
    title: "Node.js ve edge ortamlarında çalışır",
  },
  compare: {
    eyebrow: "Sorun",
    titleLine1: "Her ödeme sağlayıcısının",
    titleLine2: "API'si bambaşka.",
    lead: "İstek yapıları, imzalar, hata formatları ve callback kuralları farklı. better-payment her birini sağlayıcının kendi spesifikasyonuna göre uygular ve size tek bir tip seti sunar.",
    without: "Olmadan",
    with: "better-payment ile",
    points: [
      "Tek arayüz, dört sağlayıcı",
      "Ortak sonuç durumları",
      "Callback'ler sizin için doğrulanır",
      "Önce TypeScript",
    ],
  },
  features: {
    eyebrow: "Özellikler",
    titleLine1: "İhtiyacınız olan her şey,",
    titleLine2: "fazlası değil.",
    items: {
      unified: {
        title: "Birleşik API",
        description:
          "createPayment, initThreeDSPayment, refund, cancel ve getPayment her sağlayıcıda aynı istek tiplerini alır ve aynı yapıda sonuç döner.",
      },
      typescript: {
        title: "Önce TypeScript",
        description: "İstekler, sonuçlar ve yapılandırma tipli; public API'de hiç any yok.",
      },
      footprint: {
        title: "Sıfır bağımlılık",
        description:
          "Runtime bağımlılığı yok; ESM ve CJS build'leri ve tarayıcıda güvenle kullanılabilen bir client var. Node.js, Vercel Edge, Cloudflare Workers, Deno ve Bun'da çalışır.",
      },
      callbacks: {
        title: "Doğrulanmış callback'ler",
        description:
          "3D Secure callback'leri ve PayTR bildirimleri, ödeme alındı sayılmadan önce sizin kimlik bilgilerinizle sabit sürede doğrulanır.",
      },
      handler: {
        title: "Varsayılan olarak güvenli handler",
        description:
          "HTTP handler varsayılan olarak yalnızca callback'leri ve kart sorgularını açar. İade, iptal ve sorgulama için bir authorize hook'u gerekir.",
      },
      doubleCharge: {
        title: "Çift çekim yok",
        description:
          "Zaman aşımında tahmin yürütülmez; sonuç NETWORK_ERROR ile pending döner. Ödeme, iade ve iptal istekleri asla otomatik olarak tekrarlanmaz.",
      },
      iyzico: {
        title: "iyzico'ya özel özellikler",
        description:
          "Hazır ödeme formu (checkout form), IBAN ile ödeme (PWI) ve abonelik: ürünler, ödeme planları ve kart güncelleme. Bunlar yalnızca iyzico'da bulunan API'ler.",
      },
      multi: {
        title: "Birden çok sağlayıcı, tek yapılandırma",
        description:
          "Birden fazla sağlayıcıyı etkinleştirin, her çağrıda payment.use() ile birini seçin. Callback URL'leri gibi sağlayıcıya özel ayarlar yine geçerli.",
      },
    },
  },
  providers: {
    eyebrow: "Ödeme sağlayıcıları",
    titleLine1: "Üç sağlayıcı,",
    titleLine2: "tek tip seti.",
    capabilities: "Yetenekler",
    example: "Örnek",
    gateway: "Ödeme sağlayıcısı",
    virtualPos: "Sanal POS (SOAP)",
    iyzico: {
      description:
        "IYZWSv2 imzalı JSON API: 3D'siz ve 3D Secure ödemeler, hazır ödeme formu, IBAN ile ödeme (PWI), abonelikler, BIN ve taksit sorguları.",
      features: [
        "3D'siz ve 3D Secure",
        "Hazır ödeme formu",
        "IBAN ile ödeme (PWI)",
        "Abonelikler",
        "BIN ve taksit sorguları",
        "İade, iptal, durum sorgusu",
      ],
    },
    paytr: {
      description:
        "HMAC imzalı isteklerle iFrame ödeme sayfası. Sonuçlar sunucu bildirimi olarak gelir; handler bunları doğrular ve OK ile yanıtlar.",
      features: [
        "iFrame ödeme sayfası",
        "Doğrulanmış bildirimler",
        "BIN ve taksit oranları",
        "Kısmi ve tam iade",
        "Durum sorguları",
        "Test modu",
      ],
    },
    parampos: {
      description:
        "SOAP API'si aynı arayüzün arkasında: TP_WMD_Pay ile tamamlanan 3D ödemeler, 3D'siz ödemeler, iadeler, iptaller, durum ve BIN sorguları. Yalnızca TRY.",
      features: [
        "3D Secure (TP_WMD_UCD / Pay)",
        "3D'siz ödemeler",
        "Ödeme başına taksit sayısı",
        "İade ve iptal",
        "Durum sorguları",
        "BIN sorgusu",
      ],
    },
  },
  banks: {
    eyebrow: "Doğrudan banka entegrasyonları",
    titleLine1: "Banka sanal POS'u,",
    titleLine2: "aynı arayüz.",
    lead: "Arada bir ödeme kuruluşu olmadan bankanın sanal POS'una doğrudan bağlanın; aynı istek ve sonuç tiplerini kullanın.",
    akbankTagline: "Sanal POS · doğrudan entegrasyon",
    akbankDescription:
      "Akbank Sanal POS JSON API'si: HMAC-SHA512 imzalı istekler, imzası doğrulanan 3D Secure (3D_PAY) callback'leri, iadeler, iptaller ve sipariş durumu sorguları.",
    highlights: [
      { label: "HMAC-SHA512", desc: "İmzalı istekler ve callback'ler" },
      { label: "2D ve 3D Secure", desc: "İki akış da destekleniyor" },
      { label: "Doğrulanmış callback'ler", desc: "3D sonuçları anahtarınızla kontrol edilir" },
      { label: "Doğrudan API", desc: "Aracı yazılım yok" },
    ],
    viewDocs: "Akbank dokümantasyonu",
    example: "Örnek",
    roadmap: "Yol haritasında",
  },
  quickStart: {
    eyebrow: "Hızlı başlangıç",
    titleLine1: "Dakikalar içinde",
    titleLine2: "çalışır durumda.",
    steps: ["Paketi kurun", "Sağlayıcılarınızı yapılandırın", "3D Secure ödeme başlatın"],
    fullDocs: "Tüm dokümantasyonu görün",
  },
  cta: {
    eyebrow: "Açık kaynak · MIT lisansı",
    titleLine1: "Ödeme kodunu",
    titleLine2: "yeniden yazmayı bırakın.",
    lead: "iyzico, PayTR, Parampos ve Akbank için tam TypeScript destekli tek paket. 3.x'ten mi geçiyorsunuz? Okuyun:",
    whatsNew: "sıfırlamadan bu yana yenilikler",
    readDocs: "Dokümantasyonu okuyun",
    github: "GitHub'da görün",
  },
  footer: {
    tagline: "Node.js, edge ortamları ve TypeScript için tip güvenli, birleşik ödeme kütüphanesi.",
    groups: {
      product: "Ürün",
      documentation: "Dokümantasyon",
      providers: "Sağlayıcılar",
      resources: "Kaynaklar",
    },
    links: {
      features: "Özellikler",
      providers: "Sağlayıcılar",
      quickStart: "Hızlı Başlangıç",
      docs: "Dokümantasyon",
      introduction: "Giriş",
      installation: "Kurulum",
      configuration: "Yapılandırma",
      apiReference: "API Referansı",
      issues: "Issue'lar",
      whatsNew: "Yenilikler",
      changelog: "Sürüm notları",
    },
    license: "MIT lisansı ile yayınlanmıştır.",
    builtWith: "Next.js, Tailwind CSS ve shadcn/ui ile yapıldı",
  },
  docs: {
    fallbackNotice: "Bu sayfa henüz Türkçeye çevrilmedi; İngilizce hâli gösteriliyor.",
  },
  fumadocs: {
    displayName: "Türkçe",
  },
};

const dictionaries: Record<Locale, Dictionary> = { en, tr };

export function getDictionary(lang: Locale): Dictionary {
  return dictionaries[lang];
}
