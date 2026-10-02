import { DocsLayout } from "fumadocs-ui/layouts/docs";
import { source } from "@/lib/source";
import { isLocale, localePath } from "@/lib/i18n/config";
import { notFound } from "next/navigation";
import Image from "next/image";

export default async function Layout({ children, params }: LayoutProps<"/[lang]/docs">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <DocsLayout
      tree={source.getPageTree(lang)}
      i18n
      nav={{
        title: (
          <Image
            src="/brand/better-payment-horizontal-color.svg"
            width={1226}
            height={155}
            alt="Better Payment"
            className="h-5 w-auto"
          />
        ),
        url: localePath(lang, "/"),
      }}
      githubUrl="https://github.com/czaydev/better-payment"
      themeSwitch={{ enabled: false }}
    >
      {children}
    </DocsLayout>
  );
}
