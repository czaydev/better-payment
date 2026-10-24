/**
 * The provider table the CLI generates and checks against.
 *
 * Env var names match the installation docs
 * (`apps/web/content/docs/(get-started)/installation.mdx`) and the config field
 * names match each provider's own config type, so `init` writes a config that
 * `better-payment` accepts as it is.
 *
 * `callbackVerification` says how the provider's callback is checked:
 * - `hash`: verified locally from the merchant key and salt (PayTR)
 * - `guid`: verified locally from the merchant GUID (Parampos)
 * - `hmac`: verified locally from the merchant secret key (Akbank)
 * - `remote`: not signed; the result is only confirmed by a provider API call
 *   (iyzico), so it cannot be completed without network access
 */

export type CallbackVerification = 'hash' | 'guid' | 'hmac' | 'remote';

export interface ProviderSpec {
  /** Key in `providers`, and the provider segment of the handler route */
  id: string;
  /** Factory imported from `better-payment` */
  factory: string;
  /** `ProviderType` key of `PROVIDER_DEFAULT_URLS`, when the provider has one */
  urlKey?: string;
  /** Optional env var overriding the base URL (for proxies and mock servers) */
  baseUrlEnv?: string;
  /** Credentials: config field -> environment variable */
  fields: { field: string; env: string; secret: boolean }[];
  /** How the built-in handler verifies the provider's callback */
  callbackVerification: CallbackVerification;
  docs: string;
}

/** Placeholder written to `.env.example`. Never a real-looking key. */
export const PLACEHOLDER = 'your-';

const field = (name: string, env: string, secret = false) => ({ field: name, env, secret });

export const PROVIDER_SPECS: Record<string, ProviderSpec> = {
  iyzico: {
    id: 'iyzico',
    factory: 'iyzico',
    urlKey: 'iyzico',
    baseUrlEnv: 'IYZICO_BASE_URL',
    fields: [field('apiKey', 'IYZICO_API_KEY'), field('secretKey', 'IYZICO_SECRET_KEY', true)],
    callbackVerification: 'remote',
    docs: '/docs/providers/iyzico',
  },
  paytr: {
    id: 'paytr',
    factory: 'paytr',
    urlKey: 'paytr',
    baseUrlEnv: 'PAYTR_BASE_URL',
    fields: [
      field('merchantId', 'PAYTR_MERCHANT_ID'),
      field('merchantKey', 'PAYTR_MERCHANT_KEY', true),
      field('merchantSalt', 'PAYTR_MERCHANT_SALT', true),
    ],
    callbackVerification: 'hash',
    docs: '/docs/providers/paytr',
  },
  parampos: {
    id: 'parampos',
    factory: 'parampos',
    urlKey: 'parampos',
    baseUrlEnv: 'PARAMPOS_BASE_URL',
    fields: [
      field('clientCode', 'PARAMPOS_CLIENT_CODE'),
      field('clientUsername', 'PARAMPOS_CLIENT_USERNAME'),
      field('clientPassword', 'PARAMPOS_CLIENT_PASSWORD', true),
      field('guid', 'PARAMPOS_GUID', true),
    ],
    callbackVerification: 'guid',
    docs: '/docs/providers/parampos',
  },
  akbank: {
    id: 'akbank',
    factory: 'akbank',
    urlKey: 'akbank',
    baseUrlEnv: 'AKBANK_BASE_URL',
    fields: [
      field('merchantSafeId', 'AKBANK_MERCHANT_SAFE_ID'),
      field('terminalSafeId', 'AKBANK_TERMINAL_SAFE_ID'),
      field('secretKey', 'AKBANK_SECRET_KEY', true),
    ],
    callbackVerification: 'hmac',
    docs: '/banks/akbank',
  },
};

export const KNOWN_PROVIDER_IDS = Object.keys(PROVIDER_SPECS);

/** Provider ids accepted by the CLI, including the ones without a template yet */
export function providerIds(): string[] {
  return KNOWN_PROVIDER_IDS;
}

/** Splits `--providers iyzico,paytr`, trimming spaces and dropping empties */
export function parseProviderList(value: string | undefined): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(',')
        .map((part) => part.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];
}

/** Unknown provider ids, in the order they were given */
export function unknownProviders(ids: string[]): string[] {
  return ids.filter((id) => !PROVIDER_SPECS[id]);
}

/**
 * Values that look like a copied placeholder rather than a credential. Checked on
 * the environment value, so a real key that merely contains one of these words is
 * still reported by the `mode`/`baseUrl` checks.
 */
const PLACEHOLDER_PATTERNS = [
  /^your[-_]/i,
  /^change[-_]?me/i,
  /^placeholder$/i,
  /^example/i,
  /^todo$/i,
  /^x{3,}$/i,
  /<[^>]+>/,
  /\$\{/,
  /^\s$/,
];

export function looksLikePlaceholder(value: string | undefined): boolean {
  if (value === undefined) return false;
  const trimmed = value.trim();
  if (trimmed === '') return true;
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}
