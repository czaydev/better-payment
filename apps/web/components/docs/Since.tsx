import packageJson from "../../../../packages/better-payment/package.json";
import type { Locale } from "@/lib/i18n/config";

export interface SinceProps {
  version: string;
  lang?: Locale;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: boolean;
}

function parseVersion(version: string): ParsedVersion {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) throw new Error(`Invalid release version: ${version}`);

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] !== undefined,
  };
}

export function isReleasedVersion(version: string, currentVersion = packageJson.version): boolean {
  const target = parseVersion(version);
  const current = parseVersion(currentVersion);

  for (const key of ["major", "minor", "patch"] as const) {
    if (target[key] < current[key]) return true;
    if (target[key] > current[key]) return false;
  }

  return !current.prerelease;
}

export function Since({ version, lang = "en" }: SinceProps) {
  const released = isReleasedVersion(version);
  const label = released
    ? lang === "tr"
      ? `${version} sürümünde eklendi`
      : `Added in ${version}`
    : lang === "tr"
      ? "Henüz yayınlanmadı"
      : "Not released yet";

  return (
    <span
      className={
        released
          ? "not-prose my-2 inline-flex w-fit items-center rounded-full border border-border bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
          : "not-prose my-2 inline-flex w-fit items-center rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300"
      }
      data-release-status={released ? "released" : "unreleased"}
    >
      {label}
    </span>
  );
}
