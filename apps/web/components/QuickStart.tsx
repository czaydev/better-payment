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
    <section id="quickstart" className="py-24 px-5 sm:px-8">
      <div className="max-w-4xl mx-auto">
        <SectionHeading line1={t.titleLine1} line2={t.titleLine2} className="mb-14" />

        <ol className="flex flex-col">
          {steps.map((step, idx) => (
            <li key={step.number} className="bp-reveal flex gap-6 sm:gap-8">
              <div className="flex flex-col items-center shrink-0 pt-1">
                <div className="w-9 h-9 rounded-lg bg-tint flex items-center justify-center">
                  <span className="text-[11px] font-semibold text-primary font-mono">
                    {step.number}
                  </span>
                </div>
                {idx < steps.length - 1 && <div className="w-px flex-1 bg-border my-3" />}
              </div>

              <div className={`flex-1 min-w-0 ${idx < steps.length - 1 ? "pb-10" : ""}`}>
                <h3 className="font-semibold text-foreground text-[15px] mb-4 mt-1.5">
                  {t.steps[idx]}
                </h3>
                <Code code={step.code} file={step.file} shell={step.shell} copy={code} />
              </div>
            </li>
          ))}
        </ol>

        <div className="bp-reveal mt-12 pl-[calc(36px+1.5rem)] sm:pl-[calc(36px+2rem)]">
          <Link
            href={localePath(lang, "/docs")}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-primary group"
          >
            {t.fullDocs}
            <ChevronRight className="size-4 transition-transform duration-(--bp-d-md) ease-spring group-hover:translate-x-[3px]" />
          </Link>
        </div>
      </div>
    </section>
  );
}
