import { Shield, Zap, CreditCard, Lock, ChevronRight } from "lucide-react";
import Link from "next/link";
import Image from "next/image";
import Code from "@/components/Code";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";

const highlightIcons = [Lock, CreditCard, Shield, Zap];

const codeSnippet = `import { betterPayment, akbank } from "better-payment";

const payment = betterPayment({
  providers: {
    akbank: akbank({
      merchantSafeId: process.env.AKBANK_MERCHANT_SAFE_ID!,
      terminalSafeId: process.env.AKBANK_TERMINAL_SAFE_ID!,
      secretKey:      process.env.AKBANK_SECRET_KEY!,
    }),
  },
});

// 3D Secure initialization
const init = await payment.akbank.initThreeDSPayment({
  price: "250.00",
  paidPrice: "250.00",
  currency: "TRY",
  conversationId: "ORDER123",
  callbackUrl: "https://yoursite.com/api/pay/akbank/payment/complete-3ds",
  paymentCard: { ... },
  buyer: { ... },
  ...
});

// Complete in callback route: pass the bank's POST body as is
const result = await payment.akbank.completeThreeDSPayment(body);`;

const roadmap = [
  { name: "Garanti BBVA", href: "https://github.com/czaydev/better-payment/issues/37" },
  { name: "Yapı Kredi", href: "https://github.com/czaydev/better-payment/issues/38" },
  { name: "İş Bankası", href: "https://github.com/czaydev/better-payment/issues/36" },
  { name: "Ziraat Bankası", href: "https://github.com/czaydev/better-payment/issues/36" },
];

export default function Banks({ lang, t }: { lang: Locale; t: Dictionary["banks"] }) {
  const highlights = t.highlights.map((h, i) => ({ ...h, icon: highlightIcons[i] }));
  return (
    <section id="banks" className="py-24 px-5 sm:px-8 bg-muted/30 border-y border-border">
      <div className="max-w-6xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-muted-foreground mb-3">
              {t.eyebrow}
            </p>
            <h2 className="text-3xl sm:text-4xl font-bold text-foreground tracking-tight leading-tight">
              {t.titleLine1}
              <br />
              <span className="text-muted-foreground font-medium">{t.titleLine2}</span>
            </h2>
          </div>
          <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
            {t.lead}
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.4fr] divide-y lg:divide-y-0 lg:divide-x divide-border">
            <div className="p-8 lg:p-10 flex flex-col gap-7">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-xl bg-white border border-border flex items-center justify-center shrink-0 p-2 overflow-hidden">
                  <Image src="/akbank.svg" alt="Akbank" width={48} height={48} className="w-full h-full object-contain" />
                </div>
                <div>
                  <h3 className="text-xl font-semibold text-foreground leading-tight">Akbank</h3>
                  <p className="text-sm text-muted-foreground mt-0.5">{t.akbankTagline}</p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed">
                {t.akbankDescription}
              </p>

              <div className="grid grid-cols-2 gap-3">
                {highlights.map((h) => (
                  <div
                    key={h.label}
                    className="flex items-start gap-3 p-3 rounded-lg bg-muted/40 border border-border"
                  >
                    <h.icon className="w-4 h-4 text-foreground/70 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs font-semibold text-foreground">{h.label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{h.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <Link
                href={localePath(lang, "/docs/banks/akbank")}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground hover:underline underline-offset-4 group w-fit"
              >
                {t.viewDocs}
                <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </div>

            <div className="p-8 lg:p-10 min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground mb-4">
                {t.example}
              </p>
              <Code code={codeSnippet} file="lib/akbank.ts" />
            </div>
          </div>
        </div>

        <div className="mt-6">
          <p className="text-[11px] font-mono text-muted-foreground uppercase tracking-[0.18em] mb-3 ml-1">
            {t.roadmap}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {roadmap.map((bank) => (
              <a
                key={bank.name}
                href={bank.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <span className="w-7 h-7 rounded-md bg-muted border border-border flex items-center justify-center shrink-0 text-[9px] font-semibold">
                  {bank.name.slice(0, 2).toUpperCase()}
                </span>
                {bank.name}
              </a>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
