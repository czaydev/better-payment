import { mkdir, readFile, writeFile, access, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Application, ReflectionKind } from "typedoc";
import { collectPages, siteUrl } from "./docs-content.mjs";
import { readLocaleRegistry } from "./locales.mjs";

const registry = readLocaleRegistry();

const web = fileURLToPath(new URL("../", import.meta.url));
const pkg = resolve(web, "../../packages/better-payment");

// Ensure better-payment is built so Next.js can resolve 'better-payment' in local dev
if (!existsSync(join(pkg, "dist/index.mjs"))) {
  console.log("dist/index.mjs not found, building better-payment package...");
  execSync("pnpm --filter better-payment build", {
    cwd: resolve(web, "../.."),
    stdio: "inherit",
  });
}

const output = join(web, "public");
const origin = siteUrl(process.env.NEXT_PUBLIC_BASE_PATH);
const manifest = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));

// Derive entries from the package contract. An unknown/missing source fails the build.
const sourceOf = (name) => {
  if (name === "index") return "index.ts";
  // the fraud rules engine lives with the plugins but ships as its own entry point
  if (name === "fraud") return "plugins/fraud-rules.ts";
  if (
    ["client", "testing", "plugins", "commission-router", "routing"].includes(
      name,
    )
  )
    return `${name}/index.ts`;
  return `adapters/${name}.ts`;
};
const entries = Object.keys(manifest.exports).map((subpath) => {
  const name = subpath === "." ? "index" : subpath.slice(2);
  return join(pkg, "src", sourceOf(name));
});
await Promise.all(entries.map((entry) => access(entry)));
const app = await Application.bootstrapWithPlugins({
  entryPoints: entries.map((entry) => entry.replaceAll("\\", "/")),
  tsconfig: join(pkg, "tsconfig.json"),
  name: `Better Payment ${manifest.version} API`,
  readme: "none",
  excludePrivate: true,
  excludeProtected: true,
  navigationLinks: { Guides: `${origin}/docs` },
  // Public types may reference internal helpers that are not package exports.
  validation: { notExported: false, invalidLink: true, notDocumented: false },
});
const project = await app.convert();
if (!project || app.logger.hasErrors())
  throw new Error("TypeDoc conversion failed");
if (project.children?.length !== entries.length)
  throw new Error("TypeDoc missed a public entry point");
const apiDir = join(output, "api-reference");
// Every public export must have a rendered destination (aliases may share a page).
const exports = [];
app.renderer.postRenderAsyncJobs.push(async () => {
  for (const entryReflection of project.children) {
    for (const child of entryReflection.children ?? []) {
      const target = child.kindOf(ReflectionKind.Reference)
        ? child.getTargetReflectionDeep()
        : child;
      if (!target || !app.renderer.router?.hasUrl(target))
        throw new Error(
          `No API page for ${entryReflection.name}.${child.name}`,
        );
      const url = app.renderer.router.getFullUrl(target);
      await access(join(apiDir, url.split("#")[0]));
      exports.push({ entry: entryReflection.name, name: child.name, url });
    }
  }
  if (!exports.length) throw new Error("Empty API reference");
});
await app.generateDocs(project, apiDir);
if (app.logger.hasErrors()) throw new Error("TypeDoc rendering failed");

const pages = await collectPages(join(web, "content/docs"), origin);
// This directory contains only generated Markdown, never source documents.
await rm(join(output, "llms"), { recursive: true, force: true });
const index = [
  `# Better Payment`,
  "",
  `> Payment library documentation for version ${manifest.version}.`,
  "",
  `This documentation belongs to ${origin}. Follow this version's links; do not mix stable and beta APIs.`,
  "",
  `- [Complete English documentation](${origin}/llms-full.txt)`,
  `- [Generated API reference](${origin}/api-reference/index.html)`,
  "",
];
for (const lang of registry.codes) {
  index.push(`## ${registry.settings[lang].nativeName} documentation`, "");
  for (const page of pages.filter((p) => p.lang === lang)) {
    const path = `llms/${lang}/${page.slug || "index"}.md`;
    await mkdir(resolve(output, path, ".."), { recursive: true });
    await writeFile(join(output, path), page.markdown);
    index.push(`- [${page.title}](${origin}/${path}): ${page.description}`);
  }
  index.push("");
}
await writeFile(join(output, "llms.txt"), index.join("\n"));
await writeFile(
  join(output, "llms-full.txt"),
  `# Better Payment ${manifest.version}\n\n${pages
    .filter((p) => p.lang === registry.defaultLanguage)
    .map((p) => p.markdown)
    .join("\n---\n\n")}`,
);
await writeFile(
  join(output, "api-reference", "coverage.json"),
  JSON.stringify(
    { version: manifest.version, entries: entries.length, exports },
    null,
    2,
  ),
);
console.log(
  `Generated ${pages.length} docs pages and ${exports.length} API exports across ${entries.length} entries (${origin}).`,
);
