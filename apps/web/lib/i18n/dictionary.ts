import { DEFAULT_LOCALE, type Locale } from "./config";

const en = {
  accessibility: {
    skipToContent: "Skip to content",
  },
  notFound: {
    title: "This page is out of reach.",
    description: "The link may have changed, or the page may no longer exist. Let's get you back on track.",
    home: "Back to home",
    docs: "Explore the docs",
  },
  meta: {
    title: "Better Payment — Unified Payment Gateway for Node.js",
    description:
      "A unified, type-safe payment gateway library for Node.js and edge runtimes. Integrate iyzico, PayTR, Parampos and Akbank with a single consistent API and verified callbacks.",
    docsTitleSuffix: "Better Payment docs",
    socialImageAlt: "Better Payment — One API for Turkish payments.",
  },
  nav: {
    features: "Features",
    providers: "Providers",
    quickStart: "Quick Start",
    docs: "Docs",
    getStarted: "Get started",
    openMenu: "Open menu",
    language: "Language",
    theme: "Toggle dark mode",
    menu: {
      product: {
        label: "Product",
        desc: "Everything you need to take payments in Turkey with one typed interface.",
        cta: "Explore the product",
        groups: { payment: "Payment layer", security: "Security & events", extend: "Extensibility" },
        items: {
          unified: "Unified API", basket: "Baskets & items", preAuth: "Pre-authorization", storedCards: "Stored cards",
          handler: "HTTP handler", events: "Events & callbacks", errorCodes: "Normalized errors",
          plugins: "Plugins", customProviders: "Custom providers", testing: "Testing utilities",
        },
      },
      providers: {
        label: "Providers",
        desc: "Eleven providers behind one API: payment gateways and bank virtual POS.",
        cta: "Compare providers",
        tagline: "11 providers, one API.",
        groups: { gateways: "Payment gateways", banks: "Bank virtual POS", more: "Go further" },
        items: {
          iyzico: "iyzico", paytr: "PayTR", sipay: "Sipay", parampos: "Parampos",
          akbank: "Akbank", halkbank: "Halkbank (EST)", isbank: "İş Bankası (EST)", kuveytturk: "Kuveyt Türk",
          sekerbank: "Şekerbank (EST)", teb: "TEB (EST)", ziraat: "Ziraat Bankası (EST)",
          customProviders: "Add your own provider", testCards: "Sandbox test cards",
        },
      },
      developers: {
        label: "Developers",
        desc: "Typed APIs, clear docs and a sandbox for every provider. Ship your first payment today.",
        cta: "Open the docs",
        groups: { start: "Get started", integrations: "Integrations", reference: "Reference" },
        items: {
          quickStart: "Quick start", installation: "Installation", configuration: "Configuration",
          nextjs: "Next.js", edge: "Edge runtimes", frameworks: "Express, Hono & more",
          api: "API reference", types: "Types", errorCodes: "Error codes", testCards: "Test cards",
        },
      },
      resources: {
        label: "Resources",
        desc: "Release notes, migration guides and the open source community behind the project.",
        cta: "Read the changelog",
        groups: { releases: "Releases", community: "Community" },
        items: {
          blog: "Blog", changelog: "Changelog", whatsNew: "Upgrading from 3.x", migration: "Migration guide",
          github: "GitHub repository", npm: "npm package", issues: "Report an issue",
        },
      },
    },
  },
  hero: {
    titleLine1: "One API for",
    titleLine2: "Turkish payments.",
    lead: "gives iyzico, PayTR, Sipay, Parampos and seven banks one type-safe interface, with signature-verified callbacks and a secure-by-default HTTP handler.",
    getStarted: "Get Started",
    star: "Star on GitHub",
    badge: "See what's new",
    proof: {
      label: "One API for",
      more: "+2 more",
      stats: [
        { value: "11", label: "providers, one interface" },
        { value: "0", label: "runtime dependencies" },
        { value: "MIT", label: "open source license" },
        { value: "Node + Edge", label: "runs anywhere JS runs" },
      ],
    },
    network: {
      label: "How a payment moves through Better Payment",
      request: "request",
      verified: "verified",
      all: "11 providers",
      idle: "One API · 11 providers",
      caps: {
        iyzico: "3D Secure · Non-3D · Refund · Cancel · BIN · Installments",
        paytr: "3D Secure (iFrame) · Non-3D · Refund · BIN · Installments",
        parampos: "3D Secure · Non-3D (TRY) · Refund · Cancel · BIN · Installments",
        akbank: "3D Secure (3D_PAY) · Non-3D · Refund · Cancel",
      },
    },
  },
  code: {
    copy: "Copy",
    copied: "Copied",
  },
  compare: {
    titleLine1: "Every gateway has a",
    titleLine2: "completely different API.",
    lead: "Different request shapes, signatures, error formats and callback rules. Better Payment implements each one against the provider's specification and gives you one set of types to work with.",
    without: "Without",
    with: "With Better Payment",
  },
  features: {
    titleLine1: "Everything you need,",
    titleLine2: "nothing you don't.",
    learnMore: "Learn more",
    items: {
      unified: {
        title: "Unified API surface",
        description:
          "createPayment, initThreeDSPayment, refund, cancel and getPayment take the same request types on every provider and return the same result shape.",
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
    },
  },
  providers: {
    capabilities: "Capabilities",
    drag: "Drag to compare",
    gateway: "Payment gateway",
    virtualPos: "Virtual POS (SOAP)",
    summary: "11 banks and payment institutions, one API",
    pick: "Pick one to compare its API",
    estBanks: "Same integration for",
    groups: {
      gateway: "Payment institutions",
      virtualPos: "Virtual POS",
      bankPos: "Bank virtual POS",
    },
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
    akbank: {
      description:
        "Akbank's Sanal POS JSON API with HMAC-SHA512 signed requests, signature-verified 3D Secure (3D_PAY) callbacks, refunds, voids and order status queries.",
      features: [
        "3D Secure (3D_PAY)",
        "Non-3D payments",
        "HMAC-SHA512 signed requests",
        "Refund & void",
        "Order status queries",
        "Signature-verified callbacks",
      ],
    },
    sipay: {
      description:
        "Sipay's ccpayment API with a Bearer token and an AES-256-CBC hash_key on every payment. 3D Secure callbacks are trusted only through their signed hash_key.",
      features: [
        "Non-3D & 3D Secure",
        "Pre-authorization & capture",
        "BIN & installment queries",
        "Refund & cancel",
        "Status queries",
        "TRY, USD, EUR, GBP",
      ],
    },
    kuveytturk: {
      description:
        "Kuveyt Türk's KT Pay Gate with an HMAC-SHA512 hashData on every request. The unsigned callback is confirmed at the bank before the card is charged with Provision.",
      features: [
        "3D Secure",
        "Bank-confirmed callbacks",
        "Charge with Provision",
        "Cancel & partial refund",
        "Order status queries",
        "TRY, USD, EUR",
      ],
    },
    est: {
      description:
        "One provider for the EST (Asseco) virtual POS that five banks share: hash version 3 signed forms, all four 3D models, and payments confirmed with the bank.",
      features: [
        "3D, 3D Pay, 3D Host, 3D Pay Hosting",
        "Non-3D payments (XML API)",
        "Hash v3 verified callbacks",
        "mdStatus control",
        "Refund & void",
        "Order status queries",
      ],
    },
  },
  banks: {
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
    roadmap: "On the roadmap",
    roadmapHint: "Scroll to explore what's next",
    previous: "Previous providers",
    next: "Next providers",
    roadmapBanks: "Bank virtual POS",
    roadmapInstitutions: "Payment institutions",
    live: "Live",
    beta: "Beta",
    planned: "Planned",
  },
  contributors: {
    owner: "CODEOWNER",
    titleLine1: "Want to contribute?",
    titleLine2: "Let's build the next part together.",
    lead: "A new provider, a clearer guide, a test that catches a bug. Every contribution makes Better Payment better for everyone.",
    guide: "Read the contribution guide",
    issues: "Find your first issue",
    people: "Built by our contributors",
    thanks: "Built in the open. Improved together.",
    all: "All contributors on GitHub",
    you: "You?",
    join: "Your first contribution starts here",
  },
  blog: {
    metaTitle: "Blog",
    metaDescription:
      "Guides on integrating iyzico, PayTR, Parampos and bank virtual POS with Node.js: 3D Secure, callbacks, refunds and error handling.",
    titleLine1: "Payments,",
    titleLine2: "explained for developers.",
    lead: "Practical guides for taking payments in Turkey with Node.js: 3D Secure, callbacks, timeouts and provider differences.",
    latest: "Latest",
    allPosts: "All posts",
    toc: "On this page",
    readMore: "Read the article",
    minutes: "min read",
    updated: "Updated",
    by: "By",
    moreTitle: "Keep reading",
    rss: "RSS feed",
    empty: "No posts yet.",
    cta: {
      title: "Try it in your project",
      lead: "One typed API for iyzico, PayTR, Sipay, Parampos and seven banks.",
      docs: "Read the docs",
      github: "Star on GitHub",
    },
  },
  quickStart: {
    titleLine1: "Up and running",
    titleLine2: "in minutes.",
    lead: "Install the package, configure one provider and take your first 3D Secure payment. No adapters, no glue code.",
    steps: ["Install the package", "Configure your providers", "Start a 3D Secure payment"],
    fullDocs: "View full documentation",
  },
  cta: {
    titleLine1: "Stop rewriting",
    titleLine2: "payment logic.",
    lead: "One package for iyzico, PayTR, Sipay, Parampos and seven banks, with full TypeScript support. Upgrading from 3.x? Read",
    whatsNew: "the upgrade guide",
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
      blog: "Blog",
      introduction: "Introduction",
      installation: "Installation",
      configuration: "Configuration",
      apiReference: "API Reference",
      issues: "Issues",
      whatsNew: "Upgrading from 3.x",
      changelog: "Changelog",
    },
    license: "Released under the MIT License.",
    builtWith: "Built with Next.js, Tailwind CSS & shadcn/ui",
  },
  docs: {
    fallbackNotice: "This page has not been translated yet, so the English version is shown.",
    apiReference: "Open the generated API reference",
    betaNotice: {
      title: "You are viewing the beta docs",
      install: "Install the beta with",
      link: "Go to the stable docs",
    },
  },
  fumadocs: {
    displayName: "English",
  },
};

export type Dictionary = typeof en;

const tr: Dictionary = {
  accessibility: {
    skipToContent: "İçeriğe geç",
  },
  notFound: {
    title: "Bu sayfaya ulaşamadık.",
    description: "Bağlantı değişmiş veya sayfa kaldırılmış olabilir. Aradığınız yere başka bir yoldan ulaşalım.",
    home: "Ana sayfaya dön",
    docs: "Dokümantasyona göz at",
  },
  meta: {
    title: "Better Payment — Node.js için birleşik ödeme altyapısı",
    description:
      "Node.js ve edge ortamları için tip güvenli, birleşik ödeme kütüphanesi. iyzico, PayTR, Parampos ve Akbank'ı tek bir tutarlı API ve doğrulanmış callback'lerle entegre edin.",
    docsTitleSuffix: "Better Payment dokümantasyonu",
    socialImageAlt: "Better Payment — Türk ödeme sistemleri için tek API.",
  },
  nav: {
    features: "Özellikler",
    providers: "Sağlayıcılar",
    quickStart: "Hızlı Başlangıç",
    docs: "Dokümantasyon",
    getStarted: "Başlayın",
    openMenu: "Menüyü aç",
    language: "Dil",
    theme: "Karanlık modu aç/kapat",
    menu: {
      product: {
        label: "Ürün",
        desc: "Türkiye'de ödeme almak için gereken her şey, tek bir tipli arayüzde.",
        cta: "Ürünü inceleyin",
        groups: { payment: "Ödeme katmanı", security: "Güvenlik ve olaylar", extend: "Genişletilebilirlik" },
        items: {
          unified: "Birleşik API", basket: "Sepet ve ürünler", preAuth: "Ön provizyon", storedCards: "Kayıtlı kartlar",
          handler: "HTTP handler", events: "Olaylar ve callback'ler", errorCodes: "Normalize hatalar",
          plugins: "Eklentiler", customProviders: "Özel sağlayıcılar", testing: "Test araçları",
        },
      },
      providers: {
        label: "Sağlayıcılar",
        desc: "Tek API arkasında on bir sağlayıcı: ödeme altyapıları ve banka sanal POS'ları.",
        cta: "Sağlayıcıları karşılaştırın",
        tagline: "11 sağlayıcı, tek API.",
        groups: { gateways: "Ödeme altyapıları", banks: "Banka sanal POS", more: "Daha fazlası" },
        items: {
          iyzico: "iyzico", paytr: "PayTR", sipay: "Sipay", parampos: "Parampos",
          akbank: "Akbank", halkbank: "Halkbank (EST)", isbank: "İş Bankası (EST)", kuveytturk: "Kuveyt Türk",
          sekerbank: "Şekerbank (EST)", teb: "TEB (EST)", ziraat: "Ziraat Bankası (EST)",
          customProviders: "Kendi sağlayıcınızı ekleyin", testCards: "Sandbox test kartları",
        },
      },
      developers: {
        label: "Geliştiriciler",
        desc: "Tipli API'ler, net dokümantasyon ve her sağlayıcı için sandbox. İlk ödemenizi bugün alın.",
        cta: "Dokümantasyonu açın",
        groups: { start: "Başlangıç", integrations: "Entegrasyonlar", reference: "Referans" },
        items: {
          quickStart: "Hızlı başlangıç", installation: "Kurulum", configuration: "Yapılandırma",
          nextjs: "Next.js", edge: "Edge ortamları", frameworks: "Express, Hono ve diğerleri",
          api: "API referansı", types: "Tipler", errorCodes: "Hata kodları", testCards: "Test kartları",
        },
      },
      resources: {
        label: "Kaynaklar",
        desc: "Sürüm notları, geçiş rehberleri ve projenin arkasındaki açık kaynak topluluğu.",
        cta: "Sürüm notlarını okuyun",
        groups: { releases: "Sürümler", community: "Topluluk" },
        items: {
          blog: "Blog", changelog: "Değişiklik günlüğü", whatsNew: "3.x'ten geçiş", migration: "Geçiş rehberi",
          github: "GitHub deposu", npm: "npm paketi", issues: "Sorun bildirin",
        },
      },
    },
  },
  hero: {
    titleLine1: "Türk ödeme sistemleri",
    titleLine2: "için tek API.",
    lead: "iyzico, PayTR, Sipay, Parampos ve yedi bankayı tek bir tip güvenli arayüzde toplar; imzası doğrulanan callback'ler ve varsayılan olarak güvenli bir HTTP handler sunar.",
    getStarted: "Başlayın",
    star: "GitHub'da yıldızlayın",
    badge: "Yenilikleri görün",
    proof: {
      label: "Tek API ile",
      more: "+2 daha",
      stats: [
        { value: "11", label: "sağlayıcı, tek arayüz" },
        { value: "0", label: "çalışma zamanı bağımlılığı" },
        { value: "MIT", label: "açık kaynak lisansı" },
        { value: "Node + Edge", label: "JS'in çalıştığı her yerde" },
      ],
    },
    network: {
      label: "Bir ödemenin Better Payment içindeki yolu",
      request: "istek",
      verified: "doğrulandı",
      all: "11 sağlayıcı",
      idle: "Tek API · 11 sağlayıcı",
      caps: {
        iyzico: "3D Secure · Non-3D · İade · İptal · BIN · Taksit",
        paytr: "3D Secure (iFrame) · Non-3D · İade · BIN · Taksit",
        parampos: "3D Secure · Non-3D (TRY) · İade · İptal · BIN · Taksit",
        akbank: "3D Secure (3D_PAY) · Non-3D · İade · İptal",
      },
    },
  },
  code: {
    copy: "Kopyala",
    copied: "Kopyalandı",
  },
  compare: {
    titleLine1: "Her ödeme sağlayıcısının",
    titleLine2: "API'si bambaşka.",
    lead: "İstek yapıları, imzalar, hata formatları ve callback kuralları farklı. Better Payment her birini sağlayıcının kendi spesifikasyonuna göre uygular ve size tek bir tip seti sunar.",
    without: "Olmadan",
    with: "Better Payment ile",
  },
  features: {
    titleLine1: "İhtiyacınız olan her şey,",
    titleLine2: "fazlası değil.",
    learnMore: "Detaylı incele",
    items: {
      unified: {
        title: "Birleşik API",
        description:
          "createPayment, initThreeDSPayment, refund, cancel ve getPayment her sağlayıcıda aynı istek tiplerini alır ve aynı yapıda sonuç döner.",
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
    },
  },
  providers: {
    capabilities: "Yetenekler",
    drag: "Karşılaştırmak için sürükleyin",
    gateway: "Ödeme sağlayıcısı",
    virtualPos: "Sanal POS (SOAP)",
    summary: "11 banka ve ödeme kuruluşu, tek API",
    pick: "API'sini karşılaştırmak için birini seçin",
    estBanks: "Aynı entegrasyonla",
    groups: {
      gateway: "Ödeme kuruluşları",
      virtualPos: "Sanal POS",
      bankPos: "Banka sanal POS'ları",
    },
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
    akbank: {
      description:
        "Akbank Sanal POS JSON API'si: HMAC-SHA512 imzalı istekler, imzası doğrulanan 3D Secure (3D_PAY) callback'leri, iadeler, iptaller ve sipariş durumu sorguları.",
      features: [
        "3D Secure (3D_PAY)",
        "3D'siz ödemeler",
        "HMAC-SHA512 imzalı istekler",
        "İade ve iptal",
        "Sipariş durumu sorgusu",
        "İmzası doğrulanan callback'ler",
      ],
    },
    sipay: {
      description:
        "Sipay ccpayment API'si: her istekte Bearer token, her ödemede AES-256-CBC ile şifrelenmiş hash_key. 3D Secure callback'lerinde yalnızca imzalı hash_key'e güvenilir.",
      features: [
        "3D'siz ve 3D Secure",
        "Ön provizyon ve kapama",
        "BIN ve taksit sorguları",
        "İade ve iptal",
        "Durum sorguları",
        "TRY, USD, EUR, GBP",
      ],
    },
    kuveytturk: {
      description:
        "Kuveyt Türk KT Pay Gate: her istekte HMAC-SHA512 hashData. İmzasız callback, kart Provision ile çekilmeden önce bankada doğrulanır.",
      features: [
        "3D Secure",
        "Bankada doğrulanan callback'ler",
        "Provision ile tahsilat",
        "İptal ve kısmi iade",
        "Sipariş durumu sorgusu",
        "TRY, USD, EUR",
      ],
    },
    est: {
      description:
        "Beş bankanın ortak kullandığı EST (Asseco) sanal POS'u için tek sağlayıcı: hash v3 imzalı formlar, dört 3D modelinin tamamı ve bankayla teyit edilen ödemeler.",
      features: [
        "3D, 3D Pay, 3D Host, 3D Pay Hosting",
        "3D'siz ödemeler (XML API)",
        "Hash v3 ile doğrulanan callback'ler",
        "mdStatus kontrolü",
        "İade ve iptal",
        "Sipariş durumu sorgusu",
      ],
    },
  },
  banks: {
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
    roadmap: "Yol haritasında",
    roadmapHint: "Sıradaki adımları kaydırarak keşfedin",
    previous: "Önceki sağlayıcılar",
    next: "Sonraki sağlayıcılar",
    roadmapBanks: "Banka sanal POS'ları",
    roadmapInstitutions: "Ödeme kuruluşları",
    live: "Canlı",
    beta: "Beta",
    planned: "Planlanıyor",
  },
  contributors: {
    owner: "CODEOWNER",
    titleLine1: "Katkı sağlamak ister misin?",
    titleLine2: "Sıradaki adımı birlikte atalım.",
    lead: "Yeni bir sağlayıcı, daha anlaşılır bir rehber, bir hatayı yakalayan test. Her katkı, Better Payment’ı herkes için biraz daha iyi yapıyor.",
    guide: "Katkı rehberini oku",
    issues: "İlk issue’nu bul",
    people: "Katkıda bulunanlar",
    thanks: "Açık kaynak. Ortak emek.",
    all: "GitHub’da tüm katkıcılar",
    you: "Sen?",
    join: "İlk katkın burada başlıyor",
  },
  blog: {
    metaTitle: "Blog",
    metaDescription:
      "iyzico, PayTR, Parampos ve banka sanal POS entegrasyonu için Node.js rehberleri: 3D Secure, callback'ler, iade ve hata yönetimi.",
    titleLine1: "Ödeme altyapıları,",
    titleLine2: "geliştiriciler için anlatıldı.",
    lead: "Node.js ile Türkiye'de ödeme almak için pratik rehberler: 3D Secure, callback'ler, zaman aşımları ve sağlayıcı farkları.",
    latest: "En yeni",
    allPosts: "Tüm yazılar",
    toc: "Bu sayfada",
    readMore: "Yazıyı oku",
    minutes: "dk okuma",
    updated: "Güncellendi",
    by: "Yazar:",
    moreTitle: "Okumaya devam edin",
    rss: "RSS beslemesi",
    empty: "Henüz yazı yok.",
    cta: {
      title: "Kendi projenizde deneyin",
      lead: "iyzico, PayTR, Sipay, Parampos ve yedi banka için tek tipli API.",
      docs: "Dokümantasyonu okuyun",
      github: "GitHub'da yıldızlayın",
    },
  },
  quickStart: {
    titleLine1: "Dakikalar içinde",
    titleLine2: "çalışır durumda.",
    lead: "Paketi kurun, bir sağlayıcı yapılandırın ve ilk 3D Secure ödemenizi alın. Adaptör yok, yapıştırma kod yok.",
    steps: ["Paketi kurun", "Sağlayıcılarınızı yapılandırın", "3D Secure ödeme başlatın"],
    fullDocs: "Tüm dokümantasyonu görün",
  },
  cta: {
    titleLine1: "Ödeme kodunu",
    titleLine2: "yeniden yazmayı bırakın.",
    lead: "iyzico, PayTR, Sipay, Parampos ve yedi banka için tam TypeScript destekli tek paket. 3.x'ten mi geçiyorsunuz? Okuyun:",
    whatsNew: "geçiş rehberi",
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
      blog: "Blog",
      introduction: "Giriş",
      installation: "Kurulum",
      configuration: "Yapılandırma",
      apiReference: "API Referansı",
      issues: "Issue'lar",
      whatsNew: "3.x'ten geçiş",
      changelog: "Sürüm notları",
    },
    license: "MIT lisansı ile yayınlanmıştır.",
    builtWith: "Next.js, Tailwind CSS ve shadcn/ui ile yapıldı",
  },
  docs: {
    fallbackNotice: "Bu sayfa henüz Türkçeye çevrilmedi; İngilizce hâli gösteriliyor.",
    apiReference: "Otomatik API referansını aç (İngilizce)",
    betaNotice: {
      title: "Beta sürümün dokümanını görüntülüyorsunuz",
      install: "Beta sürümü kurmak için",
      link: "Stabil dokümana geç",
    },
  },
  fumadocs: {
    displayName: "Türkçe",
  },
};

/**
 * A dictionary may list only the keys a language has translated so far; every other key
 * falls back to English. Only the enabled languages with `docs: "required"` in
 * locales.json must be typed as a full `Dictionary` (like `tr` above) so the compiler
 * enforces completeness.
 */
type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

/** Locale code -> partial dictionary. A language missing here is served fully in English. */
export type PartialDictionary = DeepPartial<Dictionary>;

/** Enabled languages with their own copy. A language may be added per key, not all at once. */
const translations: Partial<Record<Locale, PartialDictionary>> = {
  tr,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copies the base record and overwrites every key the patch provides. */
function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? merge(current, value) : value;
  }
  return result;
}

const cache = new Map<Locale, Dictionary>();

export function getDictionary(lang: Locale): Dictionary {
  const cached = cache.get(lang);
  if (cached) return cached;
  const translation = translations[lang];
  const dictionary =
    lang === DEFAULT_LOCALE || !translation ? en : (merge(en, translation) as Dictionary);
  cache.set(lang, dictionary);
  return dictionary;
}
