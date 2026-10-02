"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import Image from "next/image";
import Code from "@/components/Code";
import SectionHeading from "@/components/SectionHeading";
import type { Dictionary } from "@/lib/i18n/dictionary";

const providers = [
  {
    id: "iyzico",
    name: "iyzico",
    logo: "/iyzico.svg",
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
  ...
});

// Render result.checkoutFormContent on your page`,
  },
  {
    id: "paytr",
    name: "PayTR",
    logo: "/paytr.svg",
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
  ...
});

// Render result.threeDSHtmlContent (the iFrame).
// The result is POSTed to your notification URL:
// /api/pay/paytr/callback verifies it and replies "OK".`,
  },
  {
    id: "parampos",
    name: "Parampos",
    logo: "/param.svg",
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
  ...
});

// result.paymentId === "ORDER123"`,
  },
];

export default function Providers({ t, code }: { t: Dictionary["providers"]; code: Dictionary["code"] }) {
  const [active, setActive] = useState(0);
  const base = providers[active];
  const p = {
    ...base,
    ...t[base.id as "iyzico" | "paytr" | "parampos"],
    tagline: base.id === "parampos" ? t.virtualPos : t.gateway,
  };

  return (
    <section id="providers" className="py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <SectionHeading line1={t.titleLine1} line2={t.titleLine2} className="mb-10" />

        <div
          role="tablist"
          className="flex items-center gap-1 border border-border rounded-lg bg-muted/40 p-1 w-fit mb-6"
        >
          {providers.map((pr, i) => (
            <button
              key={pr.id}
              role="tab"
              aria-selected={active === i}
              onClick={() => setActive(i)}
              className={[
                "flex items-center gap-2 px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                active === i
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground border border-transparent",
              ].join(" ")}
            >
              <span className="w-5 h-5 rounded bg-white flex items-center justify-center overflow-hidden shrink-0 p-0.5">
                <Image src={pr.logo} alt="" width={20} height={20} className="w-full h-full object-contain" />
              </span>
              {pr.name}
            </button>
          ))}
        </div>

        <div key={p.id} className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] lg:divide-x divide-border">
            <div className="p-8 flex flex-col gap-6">
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-11 h-11 rounded-lg bg-white border border-border flex items-center justify-center overflow-hidden p-1.5">
                    <Image src={p.logo} alt={p.name} width={40} height={40} className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-foreground text-lg leading-tight">{p.name}</h3>
                    <p className="text-sm text-muted-foreground">{p.tagline}</p>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{p.description}</p>
              </div>

              <div>
                <p className="text-[13px] font-medium text-muted-foreground mb-3">
                  {t.capabilities}
                </p>
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {p.features.map((feat) => (
                    <li key={feat} className="flex items-center gap-2 text-sm text-foreground/80">
                      <Check className="w-3.5 h-3.5 shrink-0 text-primary" />
                      {feat}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="p-8 bg-muted/30">
              <p className="text-[13px] font-medium text-muted-foreground mb-4">
                {t.example}
              </p>
              <Code code={p.code} file={p.file} copy={code} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
