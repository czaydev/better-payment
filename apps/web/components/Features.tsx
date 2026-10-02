import AnimatedIcon from "@/components/AnimatedIcon";
import type { Dictionary } from "@/lib/i18n/dictionary";

// Each feature pairs with an icon from the frosted-glass set
const layout = [
  { key: "unified", icon: "unified-api", span: "lg:col-span-2" },
  { key: "footprint", icon: "edge" },
  { key: "callbacks", icon: "callback" },
  { key: "handler", icon: "handler" },
  { key: "doubleCharge", icon: "idempotency" },
] as const;

export default function Features({ t }: { t: Dictionary["features"] }) {
  const features = layout.map((item) => ({ ...item, ...t.items[item.key] }));
  return (
    <section id="features" className="scroll-mt-20 px-5 py-24 sm:px-8 md:py-28">
      <div className="mx-auto max-w-6xl">
        <h2 className="bp-reveal mb-12 max-w-2xl text-[2rem] leading-[1.08] font-extrabold tracking-[-0.03em] text-foreground sm:text-[2.5rem]">
          {t.titleLine1}
          <br />
          <span className="text-muted-foreground">{t.titleLine2}</span>
        </h2>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <article
              key={f.key}
              className={[
                "bp-reveal group rounded-2xl border border-border bg-card p-6 transition-[translate,box-shadow,border-color] duration-(--bp-d-md) ease-spring hover:-translate-y-[3px] hover:border-line-strong hover:shadow-[0_10px_30px_-14px_rgb(19_19_43/0.22)]",
                "span" in f ? f.span : "",
              ].join(" ")}
            >
              <AnimatedIcon
                name={f.icon}
                className="-mt-1.5 -ml-2 mb-3 transition-transform duration-(--bp-d-lg) ease-spring group-hover:-translate-y-1 group-hover:scale-[1.08] group-hover:-rotate-[5deg]"
              />
              <h3 className="mb-2 text-[17px] font-bold tracking-[-0.01em] text-foreground">{f.title}</h3>
              <p className="text-[14.5px] leading-relaxed text-muted-foreground">{f.description}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
