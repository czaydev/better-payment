import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

/** Docs pages that moved when the sidebar was reorganized: old path → new path */
const movedDocs: Record<string, string> = {
  "configuration": "concepts/configuration",
  "api/handler": "concepts/handler",
  "plugins": "concepts/plugins",
  "plugins/events": "concepts/events",
  "guides/testing": "concepts/testing",
  "guides/pre-authorization": "payments/pre-authorization",
  "guides/stored-cards": "payments/stored-cards",
  "plugins/writing-plugins": "guides/writing-plugins",
  "plugins/custom-providers": "guides/custom-providers",
  "api/types": "reference/types",
  "api/error-codes": "reference/error-codes",
  "guides/changelog": "reference/changelog",
};

/**
 * Beta docs: the `beta` branch is a second Vercel project, built with NEXT_PUBLIC_BASE_PATH=/beta.
 * This site serves it under /beta when BETA_ORIGIN (that project's URL) is set, so both versions
 * live on one domain and the docs version picker switches between them.
 */
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || undefined;
// "better-payment-beta.vercel.app" works too: rewrites need the scheme, so https:// is added
const betaOriginEnv = process.env.BETA_ORIGIN?.trim().replace(/\/+$/, "");
const betaOrigin = betaOriginEnv ? betaOriginEnv.replace(/^(?!https?:\/\/)/, "https://") : undefined;

const nextConfig: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BETA_DOCS: betaOrigin ? "1" : "" },
  // 90 keeps the soft gradients in the hero artwork free of banding
  images: { qualities: [75, 90] },
  async rewrites() {
    if (basePath || !betaOrigin) return [];
    return {
      beforeFiles: [
        { source: "/beta", destination: `${betaOrigin}/beta` },
        { source: "/beta/:path*", destination: `${betaOrigin}/beta/:path*` },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
  async redirects() {
    // The proxy does not run for the bare base path ("/beta"), and the beta deployment is for docs
    const betaRoot = basePath ? [{ source: "/", destination: "/docs", permanent: false }] : [];
    return [...betaRoot, ...Object.entries(movedDocs).flatMap(([from, to]) =>
      ["", "/tr"].map((prefix) => ({
        source: `${prefix}/docs/${from}`,
        destination: `${prefix}/docs/${to}`,
        permanent: true,
      }))
    )];
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
