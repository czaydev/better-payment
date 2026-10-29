import type { ReactNode } from "react";
import { ArrowRight, Bell, Check, CreditCard, Lock, ShieldCheck, X } from "lucide-react"
import type { FeatureSlug } from "@/lib/features-data";
import type { Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils"
import ProviderSwitcher from "./ProviderSwitcher";

type L = Locale;
const t = (lang: L, tr: string, en: string) => (lang === "tr" ? tr : en);

function Frame({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-card border border-border bg-card p-3", className)}>
      <div className="flex items-center justify-between px-4 pt-2 pb-3">
        <span className="text-caption font-medium text-muted-foreground">{title}</span>
        <span className="flex gap-1" aria-hidden>
          <i className="size-2 rounded-full bg-border" />
          <i className="size-2 rounded-full bg-border" />
          <i className="size-2 rounded-full bg-border" />
        </span>
      </div>
      <div className="rounded-[26px] border border-border bg-surface p-5">{children}</div>
    </div>
  );
}

const Mono = ({ children, className }: { children: ReactNode; className?: string }) => (
  <span className={cn("font-mono text-meta", className)}>{children}</span>
);

function Basket({ lang }: { lang: L }) {
  const rows = [
    ["Mechanical keyboard", "1 ×", "1.890,00"],
    ["USB-C dock", "2 ×", "1.240,00"],
    [t(lang, "Kargo", "Shipping"), "", "59,90"],
  ];
  const split = [
    { name: "seller_a", pct: 62, tone: "bg-primary" },
    { name: "seller_b", pct: 28, tone: "bg-accent-text/70" },
    { name: t(lang, "Komisyon", "Fee"), pct: 10, tone: "bg-line-strong" },
  ];
  return (
    <Frame title={t(lang, "Sepet ve dağıtım", "Basket and payout split")}>
      <ul className="divide-y divide-border text-body-sm">
        {rows.map(([name, qty, price]) => (
          <li key={name} className="flex items-center justify-between gap-3 py-2.5">
            <span className="text-foreground">{name}</span>
            <span className="flex gap-4 text-muted-foreground"><Mono>{qty}</Mono><Mono className="text-foreground">₺{price}</Mono></span>
          </li>
        ))}
        <li className="flex items-center justify-between py-2.5 text-muted-foreground">
          <span>{t(lang, "KDV %20 (dahil)", "VAT 20% (incl.)")}</span><Mono>₺ 589,98</Mono>
        </li>
      </ul>
      <p className="mt-4 text-caption text-muted-foreground">{t(lang, "Alt üye işyeri dağıtımı", "Sub-merchant split")}</p>
      <div className="mt-2 flex h-3 gap-1 overflow-hidden rounded-full">
        {split.map((s) => <span key={s.name} className={cn("h-full rounded-full", s.tone)} style={{ width: `${s.pct}%` }} />)}
      </div>
      <div className="mt-2 flex justify-between">
        {split.map((s) => <Mono key={s.name} className="text-muted-foreground">{s.name} {s.pct}%</Mono>)}
      </div>
    </Frame>
  );
}

function PreAuth({ lang }: { lang: L }) {
  const nodes = [
    { label: "preAuth", sub: t(lang, "₺ 4.500 bloke", "₺ 4,500 held"), on: true },
    { label: "capture", sub: t(lang, "₺ 3.850 çekilir", "₺ 3,850 charged"), on: true },
    { label: "void", sub: t(lang, "kalan serbest", "rest released"), on: false },
  ];
  return (
    <Frame title={t(lang, "Provizyon yaşam döngüsü", "Authorization lifecycle")}>
      <div className="flex items-center gap-2">
        {nodes.map((n, i) => (
          <div key={n.label} className="flex flex-1 items-center gap-2">
            <div className={cn("flex-1 rounded-2xl border p-3", n.on ? "border-primary bg-card" : "border-dashed border-border-strong bg-transparent")}>
              <Mono className="text-foreground">{n.label}</Mono>
              <p className="mt-1 text-caption text-muted-foreground">{n.sub}</p>
            </div>
            {i < nodes.length - 1 && <ArrowRight className="size-4 shrink-0 text-muted-foreground" />}
          </div>
        ))}
      </div>
      <p className="mt-5 text-caption text-muted-foreground">{t(lang, "Bloke edilen tutar", "Held amount")}</p>
      <div className="mt-2 h-3 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-[86%] rounded-full bg-primary" />
      </div>
      <div className="mt-2 flex justify-between"><Mono className="text-muted-foreground">₺ 0</Mono><Mono className="text-foreground">86%</Mono><Mono className="text-muted-foreground">₺ 4.500</Mono></div>
      <div className="mt-4 flex items-center gap-2 rounded-2xl bg-card px-4 py-3 text-body-sm text-muted-foreground">
        <Lock className="size-4 text-accent-text" />
        {t(lang, "Otel check-out'ta gerçek tutar kapatılır.", "The real amount is captured at hotel check-out.")}
      </div>
    </Frame>
  );
}

function StoredCards({ lang }: { lang: L }) {
  return (
    <Frame title={t(lang, "Kasa", "Card vault")}>
      <div className="grid gap-4 sm:grid-cols-[1.1fr_1fr] sm:items-center">
        <div className="panel-dark relative aspect-[1.6] overflow-hidden rounded-3xl p-5">
          <CreditCard className="size-6 text-accent-text" />
          <Mono className="absolute bottom-14 left-5 text-body tracking-[0.18em] text-foreground">•••• •••• •••• 4242</Mono>
          <div className="absolute bottom-5 left-5 right-5 flex justify-between text-caption text-muted-foreground"><span>AYŞE YILMAZ</span><span>08/29</span></div>
        </div>
        <div className="space-y-2">
          <div className="rounded-2xl border border-border bg-card p-3">
            <p className="text-caption text-muted-foreground">{t(lang, "Uygulamanıza dönen", "What your app stores")}</p>
            <Mono className="mt-1 block truncate text-foreground">card_tok_8f3a…c91</Mono>
          </div>
          <div className="flex items-center gap-2 rounded-2xl bg-tint px-3 py-2.5 text-body-sm text-accent-text">
            <Check className="size-4" /> {t(lang, "Ham kart verisi sunucunuza uğramaz", "Raw card data never touches your server")}
          </div>
        </div>
      </div>
    </Frame>
  );
}

function Handler({ lang }: { lang: L }) {
  const steps = [
    { label: t(lang, "Banka callback'i", "Bank callback"), mono: "POST /api/payment/callback" },
    { label: t(lang, "İmza doğrulama", "Signature check"), mono: "timingSafeEqual(hash)" },
    { label: t(lang, "Sipariş eşleşmesi", "Order match"), mono: "invoice_id === order_id" },
    { label: t(lang, "Kodunuz", "Your code"), mono: "onPaymentSuccess()" },
  ];
  return (
    <Frame title="createPaymentHandler()">
      <ol className="relative space-y-3">
        <span aria-hidden className="absolute top-4 bottom-4 left-[15px] w-px bg-border" />
        {steps.map((s, i) => (
          <li key={s.label} className="relative flex items-center gap-4">
            <span className={cn("z-10 grid size-8 shrink-0 place-items-center rounded-full border text-meta", i === 1 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground")}>
              {i === 1 ? <ShieldCheck className="size-4" /> : i + 1}
            </span>
            <div className="flex-1 rounded-2xl border border-border bg-card px-4 py-2.5">
              <p className="text-body-sm font-medium text-foreground">{s.label}</p>
              <Mono className="text-muted-foreground">{s.mono}</Mono>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex items-center gap-2 text-caption text-muted-foreground">
        <X className="size-3.5 text-danger" /> {t(lang, "Geçersiz imza → 400, kodunuz hiç çalışmaz", "Bad signature → 400, your code never runs")}
      </div>
    </Frame>
  );
}

function Events({ lang }: { lang: L }) {
  const log = [
    ["payment.created", "10:42:01", "bg-muted-foreground"],
    ["payment.3ds_started", "10:42:03", "bg-warning"],
    ["payment.success", "10:42:19", "bg-success"],
    ["refund.created", "10:51:40", "bg-accent-text"],
  ];
  return (
    <Frame title={t(lang, "Olay akışı", "Event stream")}>
      <ul className="space-y-2">
        {log.map(([name, time, dot], i) => (
          <li key={name} className={cn("flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-2.5", i === 2 && "border-primary")}>
            <span className="flex items-center gap-3"><i className={cn("size-2 rounded-full", dot)} /><Mono className="text-foreground">{name}</Mono></span>
            <Mono className="text-muted-foreground">{time}</Mono>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Bell className="size-4 text-muted-foreground" />
        {["Slack", "Discord", "Webhook", "DB"].map((c) => (
          <span key={c} className="rounded-full border border-border bg-card px-3 py-1 text-caption text-foreground">{c}</span>
        ))}
      </div>
    </Frame>
  );
}

function ErrorCodes({ lang }: { lang: L }) {
  const rows = [
    ["iyzico", "10051", "INSUFFICIENT_FUNDS"],
    ["akbank", "51", "INSUFFICIENT_FUNDS"],
    ["paytr", "failed_reason_code 6", "INSUFFICIENT_FUNDS"],
    ["ziraat", "ProcReturnCode 51", "INSUFFICIENT_FUNDS"],
  ];
  return (
    <Frame title={t(lang, "Hata normalizasyonu", "Error normalization")}>
      <ul className="space-y-2">
        {rows.map(([p, raw]) => (
          <li key={p} className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5">
            <span className="text-caption text-muted-foreground">{p}</span>
            <Mono className="truncate text-muted-foreground">{raw}</Mono>
            <ArrowRight className="size-3.5 text-muted-foreground" />
          </li>
        ))}
      </ul>
      <div className="mt-3 rounded-2xl bg-primary px-4 py-3 text-center text-primary-foreground">
        <Mono>error.code === &quot;INSUFFICIENT_FUNDS&quot;</Mono>
      </div>
    </Frame>
  );
}

function Plugins({ lang }: { lang: L }) {
  const chain = ["logger", "fraud-check", "retry", "metrics"];
  return (
    <Frame title={t(lang, "Eklenti hattı", "Plugin pipeline")}>
      <div className="flex flex-col">
        <div className="rounded-2xl border border-border bg-card px-4 py-2.5 text-center"><Mono className="text-foreground">createPayment(order)</Mono></div>
        {chain.map((c) => (
          <div key={c}>
            <span className="mx-auto block h-3 w-px bg-border-strong" aria-hidden />
            <div className="rounded-2xl border border-dashed border-border-strong bg-tint/50 px-4 py-2.5 text-center"><Mono className="text-accent-text">use({c})</Mono></div>
          </div>
        ))}
        <span className="mx-auto block h-3 w-px bg-border-strong" aria-hidden />
        <div className="rounded-2xl bg-primary px-4 py-2.5 text-center text-primary-foreground"><Mono>provider.request()</Mono></div>
      </div>
    </Frame>
  );
}

function CustomProviders({ lang }: { lang: L }) {
  const files = [
    { f: "index.ts", note: "extends BaseProvider" },
    { f: "types.ts", note: "config + raw response" },
    { f: "utils.ts", note: "hash + mapper" },
  ];
  const methods = ["createPayment", "initThreeDSPayment", "refund", "cancel", "getPayment"];
  return (
    <Frame title={t(lang, "Kendi sağlayıcınız", "Your own provider")}>
      <ul className="space-y-2">
        {files.map((x) => (
          <li key={x.f} className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-2.5">
            <Mono className="text-foreground">{x.f}</Mono><Mono className="text-muted-foreground">{x.note}</Mono>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {methods.map((m) => (
          <span key={m} className="inline-flex items-center gap-1 rounded-full bg-tint px-2.5 py-1 font-mono text-meta text-accent-text"><Check className="size-3" />{m}</span>
        ))}
      </div>
      <p className="mt-4 text-caption text-muted-foreground">{t(lang, "≈ 50 satırda sözleşme tamam.", "≈ 50 lines to fulfil the contract.")}</p>
    </Frame>
  );
}

function Testing({ lang }: { lang: L }) {
  const cases = [
    ["4111 1111 1111 1111", t(lang, "başarılı ödeme", "approved"), true],
    ["4000 0000 0000 0002", t(lang, "yetersiz bakiye", "insufficient funds"), false],
    ["4000 0000 0000 3220", t(lang, "3D Secure zorunlu", "3D Secure required"), true],
  ] as const;
  return (
    <Frame title="vitest · better-payment/testing">
      <ul className="space-y-2">
        {cases.map(([card, label, ok]) => (
          <li key={card} className="flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5">
            <span className={cn("grid size-5 place-items-center rounded-full", ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger")}>
              {ok ? <Check className="size-3" /> : <X className="size-3" />}
            </span>
            <Mono className="text-foreground">{card}</Mono>
            <span className="ml-auto text-caption text-muted-foreground">{label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 flex items-center justify-between text-caption text-muted-foreground">
        <span>3 passed · 0 failed</span><Mono>12 ms</Mono>
      </p>
    </Frame>
  );
}

export function FeatureVisual({ slug, lang }: { slug: FeatureSlug; lang: L }) {
  switch (slug) {
    case "unified":
      return <ProviderSwitcher resultLabel={t(lang, "Aynı sonuç yapısı", "Same result shape")} />;
    case "basket":
      return <Basket lang={lang} />;
    case "pre-auth":
      return <PreAuth lang={lang} />;
    case "stored-cards":
      return <StoredCards lang={lang} />;
    case "handler":
      return <Handler lang={lang} />;
    case "events":
      return <Events lang={lang} />;
    case "error-codes":
      return <ErrorCodes lang={lang} />;
    case "plugins":
      return <Plugins lang={lang} />;
    case "custom-providers":
      return <CustomProviders lang={lang} />;
    case "testing":
      return <Testing lang={lang} />;
  }
}
