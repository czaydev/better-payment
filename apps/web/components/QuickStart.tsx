import Link from "next/link";
import { ChevronRight } from "lucide-react";
import Code from "@/components/Code";
import SectionHeading from "@/components/SectionHeading";
import type { Dictionary } from "@/lib/i18n/dictionary";
import { localePath, type Locale } from "@/lib/i18n/config";

const steps = [
  {
    number: "01",
    file: "terminal",
    shell: true,
    code: "npm install better-payment",
  },
  {
    number: "02",
    file: "lib/payment.ts",
    code: `import { betterPayment, iyzico } from "better-payment";

export const payment = betterPayment({
  mode: "sandbox", // test URLs and provider test modes
  providers: {
    iyzico: iyzico({
      apiKey: process.env.IYZICO_API_KEY!,
      secretKey: process.env.IYZICO_SECRET_KEY!,
    }),
  },
});`,
  },
  {
    number: "03",
    file: "app/checkout.ts",
    code: `import { payment } from "@/lib/payment";

const result = await payment.iyzico.initThreeDSPayment({
  price: "100.00",
  paidPrice: "100.00",
  currency: "TRY",
  basketId: "B1",
  callbackUrl: "https://yoursite.com/api/pay/iyzico/payment/complete-3ds",
  paymentCard: { ... },
  buyer: { ... },
  shippingAddress: { ... },
  billingAddress: { ... },
  basketItems: [ ... ],
});

// Render result.threeDSHtmlContent. The bank posts back to callbackUrl,
// where the handler verifies the result before you mark the order paid.`,
  },
];

export default function QuickStart({ lang, t, code }: { lang: Locale; t: Dictionary["quickStart"]; code: Dictionary["code"] }) {
  return (
    <section id="quickstart" className="scroll-mt-20 px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] lg:gap-20">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <SectionHeading line1={t.titleLine1} line2={t.titleLine2} lead={t.lead} className="mb-8" />
          <Link
            href={localePath(lang, "/docs")}
            className="bp-reveal group inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text"
          >
            {t.fullDocs}
            <ChevronRight className="size-4 transition-transform duration-(--bp-d-md) ease-spring group-hover:translate-x-[3px]" />
          </Link>
        </div>

        <ol className="flex min-w-0 flex-col">
          {steps.map((step, idx) => (
            <li key={step.number} className="bp-reveal flex gap-5 sm:gap-6">
              <div className="flex shrink-0 flex-col items-center pt-1">
                <div className="flex size-9 items-center justify-center rounded-lg bg-tint">
                  <span className="font-mono text-label font-semibold text-accent-text">{step.number}</span>
                </div>
                {idx < steps.length - 1 && <div className="my-3 w-px flex-1 bg-border" />}
              </div>

              <div className={`min-w-0 flex-1 ${idx < steps.length - 1 ? "pb-10" : ""}`}>
                <h3 className="mt-1.5 mb-4 text-body font-semibold text-foreground">{t.steps[idx]}</h3>
                <Code code={step.code} file={step.file} shell={step.shell} copy={code} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
