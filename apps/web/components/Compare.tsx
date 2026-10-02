import Code from "@/components/Code";
import SectionHeading from "@/components/SectionHeading";
import type { Dictionary } from "@/lib/i18n/dictionary";

const before = `// iyzico: JSON + IYZWSv2 signatures
const iyzico = new Iyzipay({ apiKey, secretKey, uri });

// PayTR: form-encoded, HMAC tokens, iFrame flow,
// notifications that must be answered with "OK"

// Parampos: SOAP envelopes, ISO-8859-9 SHA1 hashes,
// a second call to finalize every 3D payment

// Akbank: JSON API, HMAC-SHA512 auth headers

// Four request shapes, four response formats,
// four ways to verify a callback.`;

const after = `import { betterPayment, iyzico, paytr, parampos, akbank } from "better-payment";

const payment = betterPayment({
  providers: {
    iyzico:   iyzico({ ... }),
    paytr:    paytr({ ... }),
    parampos: parampos({ ... }),
    akbank:   akbank({ ... }),
  },
});

// Same request type, same result shape
const result = await payment.use("parampos").createPayment(order);

result.status; // "success" | "failure" | "pending" | "cancelled"`;

export default function Compare({ t, code }: { t: Dictionary["compare"]; code: Dictionary["code"] }) {
  return (
    <section className="py-24 px-5 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <SectionHeading line1={t.titleLine1} line2={t.titleLine2} lead={t.lead} />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
          <div className="flex flex-col gap-2 min-w-0">
            <span className="text-[13px] font-medium text-muted-foreground">{t.without}</span>
            <Code code={before} file="integration/payments.ts" className="flex-1" />
          </div>
          <div className="flex flex-col gap-2 min-w-0">
            <span className="text-[13px] font-medium text-primary">{t.with}</span>
            <Code code={after} file="lib/payment.ts" copy={code} className="flex-1" />
          </div>
        </div>

        <ul className="flex flex-wrap gap-2 mt-8">
          {t.points.map((point) => (
            <li
              key={point}
              className="rounded-full bg-tint px-3 py-1.5 text-xs font-medium text-primary"
            >
              {point}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
