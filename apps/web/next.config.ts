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

const nextConfig: NextConfig = {
  // 90 keeps the soft gradients in the hero artwork free of banding
  images: { qualities: [75, 90] },
  async redirects() {
    return Object.entries(movedDocs).flatMap(([from, to]) =>
      ["", "/tr"].map((prefix) => ({
        source: `${prefix}/docs/${from}`,
        destination: `${prefix}/docs/${to}`,
        permanent: true,
      }))
    );
  },
};

const withMDX = createMDX();

export default withMDX(nextConfig);
