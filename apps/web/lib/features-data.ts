import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bell,
  CreditCard,
  FlaskConical,
  Layers,
  Lock,
  Plug,
  Puzzle,
  ShieldCheck,
  ShoppingBag,
} from "lucide-react";
import type { Locale } from "@/lib/i18n/config";

export const FEATURE_SLUGS = [
  "unified",
  "basket",
  "pre-auth",
  "stored-cards",
  "handler",
  "events",
  "error-codes",
  "plugins",
  "custom-providers",
  "testing",
] as const;

export type FeatureSlug = (typeof FEATURE_SLUGS)[number];

export interface FeatureDetail {
  slug: FeatureSlug;
  icon: LucideIcon;
  badge: { tr: string; en: string };
  title: { tr: string; en: string };
  headline: { tr: string; en: string };
  description: { tr: string; en: string };
  docsHref: string;
  docsLabel: { tr: string; en: string };
  benefits: Array<{
    title: { tr: string; en: string };
    desc: { tr: string; en: string };
  }>;
  codeSnippet: string;
  codeFilename: string;
  comparison: {
    without: { tr: string; en: string };
    with: { tr: string; en: string };
  };
}

export const FEATURES_DATA: Record<FeatureSlug, FeatureDetail> = {
  unified: {
    slug: "unified",
    icon: Layers,
    badge: { tr: "BİRLEŞİK APİ", en: "UNIFIED API" },
    title: { tr: "Birleşik Ödeme API'si", en: "Unified Payment API" },
    headline: {
      tr: "11 Sağlayıcı ve Banka İçin Tek Tip-Safe Arayüz",
      en: "One Type-Safe Surface for 11 Gateways & Banks",
    },
    description: {
      tr: "createPayment, initThreeDSPayment, refund, cancel ve getPayment fonksiyonları tüm sağlayıcılarda aynı istek tiplerini alır ve aynı yapıda sonuç döner. Sağlayıcı değiştirmek sadece tek bir parametreyi değiştirmekten ibarettir.",
      en: "createPayment, initThreeDSPayment, refund, cancel, and getPayment take identical types on every provider and return a uniform result shape. Switching gateways is as simple as flipping a configuration string.",
    },
    docsHref: "/docs/concepts/configuration",
    docsLabel: { tr: "Yapılandırma Dokümanları", en: "Configuration Docs" },
    benefits: [
      {
        title: { tr: "Sıfır Vendor Lock-in", en: "Zero Vendor Lock-in" },
        desc: {
          tr: "Kodunuzu iyzico veya PayTR'ın özel SDK'lerine hapsetmeyin. İstediğiniz an banka sanal POS'una veya başka bir ağ geçidine geçin.",
          en: "Never couple business logic to proprietary provider SDKs. Switch between aggregators and direct bank POS on demand.",
        },
      },
      {
        title: { tr: "Ortak İstek & Yanıt Tipleri", en: "Uniform Request & Response Shapes" },
        desc: {
          tr: "Farklı parametre adları (price vs amount vs total) ile uğraşmayın. Better Payment hepsini standartlaştırır.",
          en: "No more disparate field names (price vs amount vs total). Better Payment enforces one predictable contract.",
        },
      },
      {
        title: { tr: "Gelişmiş Tip Güvencesi", en: "Strict TypeScript Safety" },
        desc: {
          tr: "IDE içinde tam otomatik tamamlama. Eksik parametreler veya yanlış tipler henüz derleme aşamasında yakalanır.",
          en: "Full IDE autocomplete. Missing params or mismatched types are caught at compile-time before hitting production.",
        },
      },
      {
        title: { tr: "Otomatik Protokol Dönüşümü", en: "Automatic Protocol Mapping" },
        desc: {
          tr: "SOAP XML, REST JSON, form-data ve query parametreleri perde arkasında otomatik olarak formatlanır.",
          en: "SOAP XML, REST JSON, form-data and query encodings are handled behind the scenes with zero boilerplate.",
        },
      },
    ],
    codeSnippet: `import { createBetterPayment } from "better-payment";

const payment = createBetterPayment({
  defaultProvider: "iyzico",
  providers: {
    iyzico: { apiKey: "...", secretKey: "..." },
    paytr: { merchantId: "...", merchantKey: "...", merchantSalt: "..." },
    akbank: { clientId: "...", username: "...", password: "..." }
  }
});

// Same interface across all 11 providers
const result = await payment.createPayment({
  paymentCard: { cardNumber, expireMonth, expireYear, cvc },
  buyer: { id: "usr_1", email: "user@example.com" },
  paidPrice: "250.00",
  currency: "TRY"
});`,
    codeFilename: "payment.ts",
    comparison: {
      without: {
        tr: "Her sağlayıcı için ayrı npm paketi, farklı metot isimleri ve bambaşka hata objeleri.",
        en: "Separate npm packages per provider, fragmented function names, and incompatible error objects.",
      },
      with: {
        tr: "Tek npm paketi, tek createPayment metodu, sağlayıcılar arası 1 satırda dinamik geçiş.",
        en: "Single npm package, single createPayment call, 1-line provider switching with zero lock-in.",
      },
    },
  },
  basket: {
    slug: "basket",
    icon: ShoppingBag,
    badge: { tr: "SEPET VE VERGİ", en: "BASKET & TAX" },
    title: { tr: "Sepet ve Ürün Yönetimi", en: "Basket & Itemized Checkout" },
    headline: {
      tr: "E-Ticaret ve Pazar Yeri Sepetleri İçin Standartlaştırma",
      en: "Standardized Multi-Item Carts & Sub-Merchant Splits",
    },
    description: {
      tr: "Birden fazla üründen oluşan sepetler, KDV oranları, alt üye işyeri (sub-merchant) komisyon dağıtımı ve fatura/teslimat adresleri tek bir tipli şemada toplanır.",
      en: "Multi-item carts, VAT breakdowns, marketplace sub-merchant commission payouts and shipping/billing addresses normalized into one type-safe schema.",
    },
    docsHref: "/docs/payments/basket",
    docsLabel: { tr: "Sepet Dokümanlarını Oku", en: "Read Basket Docs" },
    benefits: [
      {
        title: { tr: "Pazar Yeri (Marketplace) Dağıtımı", en: "Marketplace Commission Splits" },
        desc: {
          tr: "Her ürün için alt üye işyeri anahtarı ve hakediş tutarlarını kolayca belirleyin.",
          en: "Attach sub-merchant IDs and itemized payouts per product with strict validation.",
        },
      },
      {
        title: { tr: "KDV ve Vergi Uyumlu", en: "Tax & VAT Compliance" },
        desc: {
          tr: "Ürün bazında KDV tutarları ve indirimler ödeme kuruluşunun istediği formata otomatik dönüştürülür.",
          en: "Line-item VAT percentages and discounts automatically conform to each gateway's rules.",
        },
      },
      {
        title: { tr: "Doğrulanmış Fatura ve Teslimat", en: "Validated Shipping & Billing" },
        desc: {
          tr: "Adres ve alıcı kimlik doğrulamaları sağlayıcıya iletilmeden önce yerel kurallara göre kontrol edilir.",
          en: "Billing and shipping contact schemas validated client-side and server-side.",
        },
      },
      {
        title: { tr: "Fiziksel ve Dijital Ürün Desteği", en: "Physical & Digital Goods" },
        desc: {
          tr: "Dijital ürünler için kargo adresi muafiyeti ve anında onay akışları.",
          en: "Seamless digital good workflows with optional shipping bypass rules.",
        },
      },
    ],
    codeSnippet: `const result = await payment.createPayment({
  paidPrice: "1450.00",
  currency: "TRY",
  basketItems: [
    {
      id: "item_laptop_stand",
      name: "Aluminyum Laptop Standı",
      category1: "Elektronik",
      itemType: "PHYSICAL",
      price: "1000.00",
      subMerchantKey: "sub_merchant_seller_1",
      subMerchantPrice: "900.00"
    },
    {
      id: "item_software_license",
      name: "SaaS 1 Aylık Lisans",
      category1: "Yazılım",
      itemType: "VIRTUAL",
      price: "450.00"
    }
  ]
});`,
    codeFilename: "basket-checkout.ts",
    comparison: {
      without: {
        tr: "iyzico ve PayTR sepet formatları tamamen farklı, alt satır toplamları tutmadığında açıklanamayan hatalar.",
        en: "iyzico and PayTR format baskets completely differently; line-item rounding bugs fail silently.",
      },
      with: {
        tr: "Toplam tutar ve alt ürün toplamları otomatik dengelenir, şema kuralları derleme anında kontrol edilir.",
        en: "Automatic sum balancing and type validation prevents gateway rejection.",
      },
    },
  },
  "pre-auth": {
    slug: "pre-auth",
    icon: Lock,
    badge: { tr: "ÖN PROVİZYON", en: "PRE-AUTHORIZATION" },
    title: { tr: "Ön Provizyon & Kapama", en: "Pre-Auth, Capture & Void" },
    headline: {
      tr: "Otel, Araç Kiralama ve Rezervasyonlar İçin Esnek Tahsilat",
      en: "Flexible Holds & Captures for Rentals, Hotels & Bookings",
    },
    description: {
      tr: "Karttan parayı hemen çekmek yerine bloke koyun (preAuth), hizmet tamamlandığında kesin tahsilata çevirin (capture) veya işlemi masrafsız iptal edin (void).",
      en: "Place temporary authorization holds on customer cards, capture exact amounts upon service completion, or release funds instantly with zero processing fees.",
    },
    docsHref: "/docs/payments/pre-authorization",
    docsLabel: { tr: "Ön Provizyon Dokümanları", en: "Pre-Auth Docs" },
    benefits: [
      {
        title: { tr: "Bloke Koyma (PreAuth)", en: "Authorization Holds" },
        desc: {
          tr: "Müşterinin kart limitini güvenceye alın; hesap hareketine anında çekim olarak yansımaz.",
          en: "Hold credit card limits without immediate balance deduction.",
        },
      },
      {
        title: { tr: "Kısmi & Tam Kapama (Capture)", en: "Full & Partial Capture" },
        desc: {
          tr: "Bloke edilen tutarın tamamını veya hizmet bedeli kadar kısmını tahsil edin.",
          en: "Capture either the full pre-authorized sum or a lower partial amount upon delivery.",
        },
      },
      {
        title: { tr: "Masrafsız İptal (Void)", en: "Zero-Fee Voiding" },
        desc: {
          tr: "İptal edilen rezervasyonlarda gün sonu beklemeden blokeyi anında kaldırın.",
          en: "Release authorization holds immediately before end-of-day batch settlement.",
        },
      },
      {
        title: { tr: "Tüm Sağlayıcılarda Ortak Metot", en: "Consistent Multi-Bank Support" },
        desc: {
          tr: "Akbank, Kuveyt Türk, Garanti EST ve iyzico'da aynı fonksiyon imzasıyla çalışır.",
          en: "Single API signature across direct bank virtual POS and aggregator gateways.",
        },
      },
    ],
    codeSnippet: `// 1. Hold funds for rental deposit
const preAuth = await payment.preAuth({
  paymentCard: { cardNumber, expireMonth, expireYear, cvc },
  paidPrice: "5000.00",
  currency: "TRY"
});

// 2. Capture final rental fee after drop-off
const capture = await payment.capture({
  paymentId: preAuth.paymentId,
  paidPrice: "3400.00" // remaining 1600 TRY released automatically
});`,
    codeFilename: "rental-preauth.ts",
    comparison: {
      without: {
        tr: "Banka sanal POS sistemlerinin her birinde XML SOAP tag isimleri ve capture kuralları farklıdır.",
        en: "Every bank implements distinct XML SOAP tags and differing capture timeouts.",
      },
      with: {
        tr: "Tek bir payment.preAuth() ve payment.capture() çağrısı ile tüm bankalarda kusursuz provizyon.",
        en: "One clean preAuth() and capture() abstraction across all supported payment rails.",
      },
    },
  },
  "stored-cards": {
    slug: "stored-cards",
    icon: CreditCard,
    badge: { tr: "KART SAKLAMA", en: "TOKENIZATION" },
    title: { tr: "Kayıtlı Kartlar & Tokenization", en: "Stored Cards & Tokenization" },
    headline: {
      tr: "PCI-DSS Yükü Olmadan Tek Tıkla Ödeme Deneyimi",
      en: "One-Click Checkout Without PCI-DSS Compliance Burdens",
    },
    description: {
      tr: "Kullanıcıların kartlarını doğrudan sunucunuzda tutmadan, sağlayıcı tarafında güvenle tokenize edin. Kayıtlı kart listesini sorgulayın ve tek tıkla ödeme yaptırın.",
      en: "Tokenize customer credit cards securely on provider vaults without storing raw PAN numbers on your infrastructure. Deliver friction-free 1-click purchases.",
    },
    docsHref: "/docs/payments/stored-cards",
    docsLabel: { tr: "Kart Saklama Dokümanları", en: "Tokenization Docs" },
    benefits: [
      {
        title: { tr: "Sıfır PCI Kapsamı", en: "Zero PCI Scope" },
        desc: {
          tr: "Kart numaraları sunucu diskinize veya veritabanınıza asla yazılmaz.",
          en: "Raw card digits never touch your database or application file systems.",
        },
      },
      {
        title: { tr: "Maskelenmiş Kart Gösterimi", en: "Masked Card Representation" },
        desc: {
          tr: "Kullanıcı arayüzünde güvenle gösterilecek BIN, son 4 hane ve banka logosu.",
          en: "Safe display attributes including BIN, last 4 digits, bank brand, and family.",
        },
      },
      {
        title: { tr: "Tek Tıkla Checkout", en: "One-Click Repeat Checkout" },
        desc: {
          tr: "Kayıtlı kart token'ı ile sonraki alışverişlerde CVV bile sormadan anında tahsilat.",
          en: "Execute frictionless repeat transactions using secure customer card tokens.",
        },
      },
      {
        title: { tr: "Kart Silme ve Yönetim", en: "Card Lifecycle Management" },
        desc: {
          tr: "Kullanıcının dilediği kartı silmesini veya varsayılan kart yapmasını sağlayan metotlar.",
          en: "Full CRUD APIs to delete, list, and prioritize saved customer cards.",
        },
      },
    ],
    codeSnippet: `// Store card on provider vault
const saved = await payment.storeCard({
  cardUserKey: "user_customer_42",
  paymentCard: { cardNumber, expireMonth, expireYear, cvc, cardAlias: "İş Kartım" }
});

// Later: charge stored card with zero form entry
const charge = await payment.createPayment({
  cardUserKey: "user_customer_42",
  cardToken: saved.cardToken,
  paidPrice: "89.00",
  currency: "TRY"
});`,
    codeFilename: "tokenized-checkout.ts",
    comparison: {
      without: {
        tr: "Kart saklamak için pahalı PCI-DSS Level 1 denetimleri ve karmaşık şifreleme anahtarları yönetimi.",
        en: "Expensive PCI-DSS Level 1 audits and complex HSM key rotation requirements.",
      },
      with: {
        tr: "Sağlayıcı kasası üzerinde güvenli tokenization; sıfır sunucu sorumluluğu ve 1 tıkla ödeme.",
        en: "Outsourced provider vault tokenization with zero server liability and instant checkout.",
      },
    },
  },
  handler: {
    slug: "handler",
    icon: ShieldCheck,
    badge: { tr: "GÜVENLİ HANDLER", en: "SECURE HANDLER" },
    title: { tr: "Varsayılan Olarak Güvenli HTTP Handler", en: "Secure HTTP Handler" },
    headline: {
      tr: "Next.js, Express ve Hono İçin Tek Satırda Webhook Endpoint",
      en: "One-Line Verified Webhook & Callback Handler",
    },
    description: {
      tr: "3D Secure callback'leri ve sağlayıcı bildirimleri için güvenli uç nokta. İstek gövdelerini sabit zamanda doğrular; iade ve iptal gibi hassas rotaları authorize hook'u ile korur.",
      en: "Dedicated endpoint handling 3D Secure returns and provider notifications. Validates signatures in constant time and locks administrative actions behind authorization guards.",
    },
    docsHref: "/docs/concepts/handler",
    docsLabel: { tr: "HTTP Handler Dokümanları", en: "HTTP Handler Docs" },
    benefits: [
      {
        title: { tr: "Sabit Zamanlı İmza Doğrulama", en: "Constant-Time Signature Check" },
        desc: {
          tr: "Kriptografik timing saldırılarını önleyen güvenli hash karşılaştırması.",
          en: "Timing-safe string comparisons thwarting cryptographic side-channel attacks.",
        },
      },
      {
        title: { tr: "Tek Satırda Next.js Desteği", en: "1-Line Next.js App Router" },
        desc: {
          tr: "app/api/pay/route.ts dosyasına export const { GET, POST } yazmanız yeterlidir.",
          en: "Drop into app/api/pay/route.ts and export { GET, POST } in seconds.",
        },
      },
      {
        title: { tr: "Authorize Hook Koruması", en: "Authorize Hook Protection" },
        desc: {
          tr: "İade ve iptal gibi riskli işlemler authorize kancası tanımlanmadan çalıştırılamaz.",
          en: "High-risk refund and void operations reject automatically without an explicit authorize guard.",
        },
      },
      {
        title: { tr: "Multi-Framework Desteği", en: "Multi-Framework Runtime" },
        desc: {
          tr: "Express, Fastify, Hono, Node.js http ve Web standardı Request/Response uyumu.",
          en: "Seamless compatibility with Express, Fastify, Hono, and native Web Standards.",
        },
      },
    ],
    codeSnippet: `// app/api/pay/route.ts (Next.js App Router)
import { createPaymentHandler } from "better-payment/next";
import { payment } from "@/lib/payment";

export const { GET, POST } = createPaymentHandler({
  payment,
  // Protect sensitive endpoints
  async authorize(req, action) {
    if (action === "refund" || action === "cancel") {
      const session = await getAdminSession(req);
      return session?.role === "ADMIN";
    }
    return true;
  },
  async onPaymentSuccess(result) {
    await db.orders.update({ id: result.orderId, status: "PAID" });
  }
});`,
    codeFilename: "api-handler.ts",
    comparison: {
      without: {
        tr: "Her callback için elle imza hesaplama, açıkta kalan iade endpoint'leri ve CSRF riskleri.",
        en: "Manual hashing formulas per gateway, exposed refund endpoints, and CSRF vulnerabilities.",
      },
      with: {
        tr: "Otomatik doğrulanmış, zamanlama saldırılarına karşı korumalı ve tek satırda entegre edilen handler.",
        en: "Battle-tested, timing-safe handler configured in a single declarative block.",
      },
    },
  },
  events: {
    slug: "events",
    icon: Bell,
    badge: { tr: "OLAYLAR VE KANCALAR", en: "EVENTS & HOOKS" },
    title: { tr: "Olaylar ve Yaşam Döngüsü Kancaları", en: "Events & Lifecycle Hooks" },
    headline: {
      tr: "Ödeme Başarıldığında veya İade Edildiğinde Anında Bildirim",
      en: "Real-Time Event Dispatching Across Payment Lifecycles",
    },
    description: {
      tr: "onPaymentSuccess, onPaymentFailure, onRefund, onCancel olayları ile veri tabanınızı güncelleyin, Slack bildirimi atın veya e-fatura sistemini tetikleyin.",
      en: "Hook into onPaymentSuccess, onPaymentFailure, onRefund, and onCancel to update your orders, dispatch Slack alerts, or trigger e-invoice generators.",
    },
    docsHref: "/docs/concepts/events",
    docsLabel: { tr: "Olay Sistemi Dokümanları", en: "Event System Docs" },
    benefits: [
      {
        title: { tr: "Tip Güvenli Olay Verisi", en: "Type-Safe Event Payloads" },
        desc: {
          tr: "Her olay callback'inde sipariş numarası, tutar, kart bilgisi ve sağlayıcı yanıtı tiplidir.",
          en: "Every event handler receives fully typed payloads including amounts and provider IDs.",
        },
      },
      {
        title: { tr: "Asenkron Kuyruk Entegrasyonu", en: "Async Queue Dispatching" },
        desc: {
          tr: "BullMQ, RabbitMQ veya Kafka kuyruklarına tek satırda ödeme olayı gönderin.",
          en: "Forward transaction events to BullMQ, RabbitMQ, or Kafka with zero friction.",
        },
      },
      {
        title: { tr: "Otomatik Yeniden Deneme Koruması", en: "Idempotent Event Safety" },
        desc: {
          tr: "Aynı webhook iki kez gelse dahi duplicate işlem yapılmasını engelleyen mimari.",
          en: "Idempotent callback execution protects against duplicate webhook deliveries.",
        },
      },
      {
        title: { tr: "Gözlemlenebilirlik (Observability)", en: "Full Observability" },
        desc: {
          tr: "Datadog, Sentry veya New Relic ile ödeme başarı oranlarını izleyin.",
          en: "Monitor conversion rates and gateway latency in Datadog, Sentry, or Prometheus.",
        },
      },
    ],
    codeSnippet: `const payment = createBetterPayment({
  providers: { ... },
  plugins: [
    {
      name: "order-lifecycle",
      onPaymentSuccess(result) {
        logger.info(\`Payment verified: \${result.paymentId} for order \${result.orderId}\`);
        sendSlackAlert(\`🎉 New purchase: \${result.paidPrice} TRY\`);
      },
      onPaymentFailure(err) {
        logger.warn(\`Payment failed: \${err.code} - \${err.message}\`);
      }
    }
  ]
});`,
    codeFilename: "events-plugin.ts",
    comparison: {
      without: {
        tr: "Webhook geldiğinde karmaşık if/else blokları içinde sipariş güncelleme ve kaybolan bildirimler.",
        en: "Messy spaghetti switch-case webhook parsing resulting in missed customer receipts.",
      },
      with: {
        tr: "Temiz, modüler ve güvenilir olay kancaları; kod tabanınız temiz ve sürdürülebilir kalır.",
        en: "Clean declarative lifecycle hooks that keep core business logic decoupled and elegant.",
      },
    },
  },
  "error-codes": {
    slug: "error-codes",
    icon: AlertTriangle,
    badge: { tr: "HATA NORMALİZASYONU", en: "ERROR NORMALIZATION" },
    title: { tr: "Normalize Hata Kodları", en: "Normalized Error Codes" },
    headline: {
      tr: "Banka ve Sağlayıcı Hata Kodlarını Tahmin Etmeye Son",
      en: "Unified Error Enums Across Heterogeneous Provider Specs",
    },
    description: {
      tr: "iyzico '12', Garanti '0051', PayTR '1004' dönerken Better Payment hepsini INSUFFICIENT_FUNDS koduna normalize eder. Kullanıcınıza her zaman doğru ve yerelleştirilmiş mesajı gösterin.",
      en: "While iyzico returns '12', Garanti emits '0051', and PayTR outputs '1004', Better Payment unifies them all into INSUFFICIENT_FUNDS with localized user guidance.",
    },
    docsHref: "/docs/reference/error-codes",
    docsLabel: { tr: "Hata Kodları Referansı", en: "Error Codes Reference" },
    benefits: [
      {
        title: { tr: "Ortak Hata Enum'ları", en: "Unified Error Enums" },
        desc: {
          tr: "INSUFFICIENT_FUNDS, EXPIRED_CARD, INVALID_CVV, 3D_AUTH_FAILED ve NETWORK_ERROR.",
          en: "Standard enums for card declines, invalid inputs, 3D auth failures, and timeouts.",
        },
      },
      {
        title: { tr: "Kullanıcı Dostu Açıklamalar", en: "User-Friendly Messages" },
        desc: {
          tr: "Müşterinize teknik hata kodları yerine ne yapması gerektiğini anlatan Türkçe ve İngilizce mesajlar.",
          en: "Actionable, localized error messages guiding shoppers how to resolve declines.",
        },
      },
      {
        title: { tr: "Ham Sağlayıcı Yanıtına Erişim", en: "Raw Provider Transparency" },
        desc: {
          tr: "Hata normalize edilirken sağlayıcının orijinal rawError nesnesi de hata içinde korunur.",
          en: "Normalized errors retain the raw provider code and raw payload for debug audit logs.",
        },
      },
      {
        title: { tr: "Çift Çekim Engelleme", en: "Double-Charge Immunity" },
        desc: {
          tr: "Ağ zaman aşımlarında (timeout) asla körü körüne yeniden deneme yapılmaz; durum NETWORK_ERROR döner.",
          en: "Network dropouts yield clear NETWORK_ERROR states preventing accidental repeat charges.",
        },
      },
    ],
    codeSnippet: `try {
  await payment.createPayment({ ... });
} catch (error) {
  if (error instanceof BetterPaymentError) {
    switch (error.code) {
      case "INSUFFICIENT_FUNDS":
        return showToast("Kartınızın bakiyesi yetersiz.");
      case "EXPIRED_CARD":
        return showToast("Kartınızın son kullanma tarihi geçmiş.");
      case "3D_AUTH_FAILED":
        return showToast("SMS doğrulama kodu hatalı veya onaylanmadı.");
      default:
        return showToast("Ödeme alınamadı: " + error.message);
    }
  }
}`,
    codeFilename: "error-handling.ts",
    comparison: {
      without: {
        tr: "Her bankanın farklı hata kodlarını excel tablolarından arayıp if/else zincirleri yazmak.",
        en: "Manually scouring bank PDF manuals to map cryptic 4-digit bank return codes.",
      },
      with: {
        tr: "Standart TypeScript enum'ları ile öngörülebilir ve güvenli hata yakalama blokları.",
        en: "Predictable TypeScript enum switches that make frontend decline handling trivial.",
      },
    },
  },
  plugins: {
    slug: "plugins",
    icon: Puzzle,
    badge: { tr: "EKLENTİ SİSTEMİ", en: "PLUGIN SYSTEM" },
    title: { tr: "Genişletilebilir Eklenti Mimarisi", en: "Extensible Plugin Architecture" },
    headline: {
      tr: "Ödeme Katmanına Özel Middleware ve Entegrasyonlar Ekleyin",
      en: "Compose Custom Middlewares & Third-Party Extensions",
    },
    description: {
      tr: "Ödeme akışının her aşamasına müdahale edebilen eklenti sistemi. Fraud kontrolleri, logging, vergi hesaplayıcıları ve analitik araçlarını tek satırda bağlayın.",
      en: "Hook into any phase of payment execution. Mount fraud scoring, structured audit logging, dynamic tax calculators, and analytics with plug-and-play modules.",
    },
    docsHref: "/docs/concepts/plugins",
    docsLabel: { tr: "Eklenti Dokümanlarını Oku", en: "Read Plugin Docs" },
    benefits: [
      {
        title: { tr: "Composable Pipeline", en: "Composable Pipeline" },
        desc: {
          tr: "Eklentiler dizi olarak verilir ve belirlenen sırada birbirini tetikler.",
          en: "Plugins chain sequentially through a clean middleware pipeline architecture.",
        },
      },
      {
        title: { tr: "İstek ve Yanıt Manipülasyonu", en: "Request & Response Hooks" },
        desc: {
          tr: "Ödeme gönderilmeden önce parametreleri zenginleştirin veya sonrasında maskeleyin.",
          en: "Enrich requests with tracking IDs or sanitize responses before leaving the engine.",
        },
      },
      {
        title: { tr: "Topluluk ve Özel Eklentiler", en: "Community & Custom Plugins" },
        desc: {
          tr: "Kendi eklentinizi yazın veya açık kaynak ekosistemdeki hazır paketleri kullanın.",
          en: "Author your own in-house plugins or leverage pre-built community packages.",
        },
      },
      {
        title: { tr: "Sıfır Performans Kaybı", en: "Zero Runtime Overhead" },
        desc: {
          tr: "Hafif ve saf fonksiyonlardan oluşan ultra hızlı eklenti yürütücüsü.",
          en: "Lightweight, pure-function execution that adds sub-millisecond overhead.",
        },
      },
    ],
    codeSnippet: `import { createBetterPayment, type Plugin } from "better-payment";

const fraudDetectionPlugin: Plugin = {
  name: "custom-fraud-filter",
  async beforePayment(request) {
    const isRisky = await checkIpReputation(request.clientIp);
    if (isRisky) {
      throw new Error("Fraud risk score too high.");
    }
    return request;
  }
};

const payment = createBetterPayment({
  providers: { ... },
  plugins: [fraudDetectionPlugin]
});`,
    codeFilename: "plugins-setup.ts",
    comparison: {
      without: {
        tr: "Ödeme fonksiyonunun içine logging, analitik ve fraud kodlarını karıştırıp kodu kirletmek.",
        en: "Entangling logging, telemetry, and fraud checks directly inside payment controller code.",
      },
      with: {
        tr: "Tek bir eklenti modülüyle temiz, ayrıştırılmış ve test edilebilir mimari.",
        en: "Decoupled, reusable plugins that keep core business code pristine.",
      },
    },
  },
  "custom-providers": {
    slug: "custom-providers",
    icon: Plug,
    badge: { tr: "ÖZEL SAĞLAYICILAR", en: "CUSTOM PROVIDERS" },
    title: { tr: "Özel Sağlayıcı Motoru", en: "Custom Provider Engine" },
    headline: {
      tr: "50 Satırda Kendi Banka veya Ödeme Ağ Geçidinizi Yazın",
      en: "Build Any Bank or Gateway Adapter in Under 50 Lines",
    },
    description: {
      tr: "Listenizde olmayan özel bir banka veya küresel bir ödeme kuruluşu mu var? BaseProvider sınıfını genişletin; sistemdeki tüm tiplerden, HTTP handler'dan ve hata yönetiminden otomatik yararlanın.",
      en: "Need to integrate a proprietary regional bank or global processor? Extend BaseProvider and automatically inherit all TypeScript interfaces, HTTP handlers, and error normalizations.",
    },
    docsHref: "/docs/guides/custom-providers",
    docsLabel: { tr: "Özel Sağlayıcı Rehberi", en: "Custom Provider Guide" },
    benefits: [
      {
        title: { tr: "BaseProvider Şablonu", en: "Turnkey BaseProvider Class" },
        desc: {
          tr: "createPayment, refund, cancel metotlarını doldurmanız yeterlidir.",
          en: "Simply implement the core createPayment, refund, and cancel abstract methods.",
        },
      },
      {
        title: { tr: "Otomatik Tip Uyumluluğu", en: "Inherited Type Checking" },
        desc: {
          tr: "Yazdığınız özel sağlayıcı, tüm sistem genelinde diğer sağlayıcılar gibi kullanılabilir.",
          en: "Your custom adapter functions as a first-class citizen across the entire engine.",
        },
      },
      {
        title: { tr: "Dahili Şifreleme ve Hash", en: "Built-in Crypto Utilities" },
        desc: {
          tr: "Web Crypto tabanlı HMAC, SHA-256 ve SHA-512 yardımcı araçları elinizin altında.",
          en: "Access built-in timing-safe hashing tools across HMAC, SHA-256, and SHA-512.",
        },
      },
      {
        title: { tr: "Açık Kaynak Katkı İmkânı", en: "Contribute to Open Source" },
        desc: {
          tr: "Yazdığınız sağlayıcıyı dilerseniz Better Payment ana deposuna PR olarak gönderebilirsiniz.",
          en: "Optionally upstream your custom bank adapter as a GitHub pull request.",
        },
      },
    ],
    codeSnippet: `import { BaseProvider, type PaymentRequest, type PaymentResult } from "better-payment";

export class CustomRegionalBankProvider extends BaseProvider {
  name = "regional-bank";

  async createPayment(req: PaymentRequest): Promise<PaymentResult> {
    const xmlPayload = this.buildBankXml(req);
    const response = await fetch("https://bank.com/pos", {
      method: "POST",
      body: xmlPayload
    });
    return this.normalizeBankResponse(await response.text());
  }
}`,
    codeFilename: "custom-provider.ts",
    comparison: {
      without: {
        tr: "Yeni bir banka eklerken sıfırdan HTTP istemcisi, tip tanımları ve callback rotaları oluşturmak.",
        en: "Building custom HTTP clients, error types, and callback handlers from scratch every time.",
      },
      with: {
        tr: "BaseProvider'dan türetip sadece bankanın XML/JSON formatını eşleştirmek; gerisini motor halleder.",
        en: "Implement BaseProvider methods and let Better Payment handle typing, validation, and lifecycle.",
      },
    },
  },
  testing: {
    slug: "testing",
    icon: FlaskConical,
    badge: { tr: "TEST ARAÇLARI", en: "TESTING SUITE" },
    title: { tr: "Test Araçları & Sandbox", en: "Testing Tools & Sandbox" },
    headline: {
      tr: "Gerçek Para Harcamadan Ödeme Akışlarını Uçtan Uca Test Edin",
      en: "Test Payment Workflows End-to-End With Zero Financial Risk",
    },
    description: {
      tr: "Dahili MockProvider, hazır test kartları, ağ hatası simülatörü ve Vitest/Jest yardımcı araçları ile CI/CD boru hattınızda otomatik ödeme testleri çalıştırın.",
      en: "Built-in MockProvider, sandbox card fixtures, network delay simulators, and test utilities to run automated integration tests in your CI/CD pipeline.",
    },
    docsHref: "/docs/concepts/testing",
    docsLabel: { tr: "Test Dokümanlarını Oku", en: "Read Testing Docs" },
    benefits: [
      {
        title: { tr: "Dahili MockProvider", en: "Built-in MockProvider" },
        desc: {
          tr: "Canlı veya sandbox API anahtarına ihtiyaç duymadan anında çalışan simülatör.",
          en: "Zero API credentials required: test charges and 3D redirects locally offline.",
        },
      },
      {
        title: { tr: "Hata Senaryosu Simülatörü", en: "Decline Scenario Simulator" },
        desc: {
          tr: "Yetersiz bakiye, çalınmış kart, 3D şifresi yanlış gibi senaryoları simüle edin.",
          en: "Simulate insufficient funds, expired cards, and 3D SMS failures deterministically.",
        },
      },
      {
        title: { tr: "Ağ Gecikmesi & Timeout Testi", en: "Network Jitter & Timeout Testing" },
        desc: {
          tr: "Yavaş ağlarda veya zaman aşımı anında uygulamanızın çift çekim yapmadığını doğrulayın.",
          en: "Validate that double-charge protections hold up under extreme network timeouts.",
        },
      },
      {
        title: { tr: "Vitest & Jest Uyumlu", en: "Vitest & Jest Ready" },
        desc: {
          tr: "Birim testlerinizde veya e2e testlerinizde kolayca mock'layabileceğiniz temiz yapı.",
          en: "Mock and assert payment execution states effortlessly in your test runners.",
        },
      },
    ],
    codeSnippet: `import { createBetterPayment, MockProvider } from "better-payment";
import { describe, it, expect } from "vitest";

describe("Checkout Flow", () => {
  it("handles insufficient funds gracefully", async () => {
    const payment = createBetterPayment({
      defaultProvider: "mock",
      providers: {
        mock: new MockProvider({ simulateDecline: "INSUFFICIENT_FUNDS" })
      }
    });

    await expect(payment.createPayment({ ... }))
      .rejects.toThrow("INSUFFICIENT_FUNDS");
  });
});`,
    codeFilename: "checkout.test.ts",
    comparison: {
      without: {
        tr: "Banka test ortamlarının sık sık çökmesi veya sandbox credential'larının süresinin dolması.",
        en: "Unreliable sandbox environments that go down frequently and stall pull request merges.",
      },
      with: {
        tr: "Tamamen yerel, deterministik ve milisaniyeler içinde koşan otomatik test simülasyonları.",
        en: "Deterministic local mock engines that execute in milliseconds inside GitHub Actions.",
      },
    },
  },
};

export function loc<T>(val: { tr: T; en: T }, lang: Locale): T {
  return lang === "tr" ? val.tr : val.en;
}
