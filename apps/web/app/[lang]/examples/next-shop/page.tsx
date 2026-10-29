import { source } from "@/lib/source";
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from "fumadocs-ui/layouts/docs/page";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { getMDXComponents } from "@/lib/mdx-components";
import { alternates, isLocale, LOCALES } from "@/lib/i18n/config";
import { Since } from "@/components/docs/Since";

export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export default async function NextShopExamplePage({
  params,
}: PageProps<"/[lang]/examples/next-shop">) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  // Load next-shop content from compiled source
  const page = source.getPage(["integrations", "next-shop"], lang);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage
      id="main-content"
      tabIndex={-1}
      className="scroll-mt-20 focus:outline-none"
      toc={page.data.toc}
      full={page.data.full}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      {page.data.since && <Since version={page.data.since} lang={lang} />}
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={getMDXComponents(defaultMdxComponents, lang)} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateMetadata({
  params,
}: PageProps<"/[lang]/examples/next-shop">): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  const page = source.getPage(["integrations", "next-shop"], lang);
  if (!page) notFound();

  return {
    title: `${page.data.title} — Better Payment Examples`,
    description: page.data.description,
    alternates: alternates("/examples/next-shop", lang),
  };
}
