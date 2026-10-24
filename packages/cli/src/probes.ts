/**
 * Harmless sandbox probes for `doctor`.
 *
 * Every probe is a read-only query: a BIN lookup (iyzico, PayTR, Parampos) or an
 * order-history query for an order id that does not exist (Akbank). No probe
 * creates, refunds, cancels or captures a payment, and none of them sends card
 * data.
 *
 * The providers sign their own requests, so the CLI reuses the library's public
 * provider classes with an injected `fetch`, and only inspects the HTTP metadata
 * and the provider's message. Bodies are kept in memory to recognize an
 * authentication error; they are never printed.
 */
import { Akbank, Iyzico, Parampos, PayTR, PROVIDER_DEFAULT_URLS } from 'better-payment';
import { PROVIDER_SPECS, looksLikePlaceholder, type ProviderSpec } from './provider-specs';
import type { CheckStatus, CliIo } from './types';

/** A well-known Visa BIN, used only to ask the provider a harmless question */
export const PROBE_BIN = '535387';

export interface HttpRecord {
  url: string;
  status: number;
  contentType: string;
  /** The provider's `Date` header, used for clock skew */
  date?: string;
  /** First 4 kB of the response, for error recognition only. Never printed. */
  bodySample: string;
}

export interface ProbeObservation {
  id: string;
  mode: 'sandbox' | 'production';
  baseUrl: string;
  method: 'binCheck' | 'order-history';
  http: HttpRecord[];
  networkError?: string;
  /** The provider method returned (a business result), rather than throwing */
  returned: boolean;
  /** The provider's own message, when it gave one */
  providerMessage?: string;
}

export interface ResolvedProvider {
  spec: ProviderSpec;
  mode: 'sandbox' | 'production';
  baseUrl: string;
  /** Provider config field -> value. Never printed. */
  credentials: Record<string, string>;
  missing: string[];
  placeholders: string[];
  /** The base URL is the other mode's documented host */
  modeMismatch?: 'sandbox' | 'production';
}

export type ProbeVerdict = 'accepted' | 'rejected' | 'unreachable' | 'inconclusive';

export interface ProbeClassification {
  verdict: ProbeVerdict;
  status: CheckStatus;
  message: string;
  details: string[];
}

function defaultUrls(spec: ProviderSpec): { sandbox: string; production: string } | undefined {
  if (!spec.urlKey) return undefined;
  return PROVIDER_DEFAULT_URLS[spec.urlKey as keyof typeof PROVIDER_DEFAULT_URLS];
}

/** Credentials, mode and base URL of one provider, from the environment */
export function resolveProvider(
  io: CliIo,
  id: string,
  mode: 'sandbox' | 'production'
): ResolvedProvider {
  const spec = PROVIDER_SPECS[id];
  const credentials: Record<string, string> = {};
  const missing: string[] = [];
  const placeholders: string[] = [];
  for (const field of spec.fields) {
    const raw = io.env[field.env];
    if (raw === undefined || raw.trim() === '') {
      missing.push(field.env);
      continue;
    }
    if (looksLikePlaceholder(raw)) {
      placeholders.push(field.env);
      continue;
    }
    credentials[field.field] = raw.trim();
  }

  const urls = defaultUrls(spec);
  const override = spec.baseUrlEnv ? io.env[spec.baseUrlEnv]?.trim() : undefined;
  const baseUrl = override || urls?.[mode] || '';
  let modeMismatch: ResolvedProvider['modeMismatch'];
  if (urls) {
    const other = mode === 'sandbox' ? 'production' : 'sandbox';
    if (baseUrl.replace(/\/+$/, '') === urls[other].replace(/\/+$/, '')) modeMismatch = other;
  }

  return { spec, mode, baseUrl, credentials, missing, placeholders, modeMismatch };
}

/** Keeps a provider message short, single-line and free of credential values */
export function sanitizeMessage(message: string | undefined, secrets: string[]): string {
  if (!message) return 'no message';
  let text = message.replace(/\s+/g, ' ').trim();
  for (const secret of secrets) {
    if (secret) text = text.split(secret).join('***');
  }
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

function urlOf(input: string | URL | { url: string }): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/** Wraps `fetch` and records status/headers plus a body sample, without logging it */
export function createCapturingFetch(
  fetchImpl: typeof fetch,
  http: HttpRecord[],
  onNetworkError: (message: string) => void
): typeof fetch {
  return async (input, init) => {
    try {
      const response = await fetchImpl(input, init);
      let bodySample = '';
      try {
        bodySample = (await response.clone().text()).slice(0, 4096);
      } catch {
        bodySample = '';
      }
      http.push({
        url: urlOf(input),
        status: response.status,
        contentType: response.headers.get('content-type') ?? '',
        date: response.headers.get('date') ?? undefined,
        bodySample,
      });
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onNetworkError(message);
      throw error;
    }
  };
}

/** Runs the provider's harmless query with a fake-able fetch */
export async function probeProvider(
  io: CliIo,
  resolved: ResolvedProvider
): Promise<ProbeObservation> {
  const http: HttpRecord[] = [];
  let networkError: string | undefined;
  const fetchImpl = createCapturingFetch(io.fetch, http, (message) => {
    networkError = message;
  });
  const secrets = Object.values(resolved.credentials);
  let returned = false;
  let providerMessage: string | undefined;
  let method: ProbeObservation['method'] = 'binCheck';

  const common = {
    baseUrl: resolved.baseUrl,
    fetch: fetchImpl,
    validate: false as const,
  };

  try {
    switch (resolved.spec.id) {
      case 'iyzico': {
        const provider = new Iyzico({
          ...common,
          apiKey: resolved.credentials.apiKey,
          secretKey: resolved.credentials.secretKey,
        });
        await provider.binCheck(PROBE_BIN);
        returned = true;
        break;
      }
      case 'paytr': {
        const provider = new PayTR({
          ...common,
          merchantId: resolved.credentials.merchantId,
          merchantKey: resolved.credentials.merchantKey,
          merchantSalt: resolved.credentials.merchantSalt,
        });
        await provider.binCheck(PROBE_BIN);
        returned = true;
        break;
      }
      case 'parampos': {
        const provider = new Parampos({
          ...common,
          clientCode: resolved.credentials.clientCode,
          clientUsername: resolved.credentials.clientUsername,
          clientPassword: resolved.credentials.clientPassword,
          guid: resolved.credentials.guid,
        });
        await provider.binCheck(PROBE_BIN);
        returned = true;
        break;
      }
      case 'akbank': {
        method = 'order-history';
        const provider = new Akbank({
          ...common,
          merchantSafeId: resolved.credentials.merchantSafeId,
          terminalSafeId: resolved.credentials.terminalSafeId,
          secretKey: resolved.credentials.secretKey,
          testMode: resolved.mode === 'sandbox',
        });
        // A random order id: no payment can exist for it, so this only checks
        // whether the credentials and signature are accepted.
        const result = await provider.getPayment(
          `BP-DOCTOR-${io.now().toString(36).toUpperCase()}`
        );
        returned = true;
        providerMessage = result.errorMessage;
        break;
      }
      default:
        throw new Error(`No harmless probe for provider '${resolved.spec.id}'`);
    }
  } catch (error) {
    providerMessage = error instanceof Error ? error.message : String(error);
  }

  return {
    id: resolved.spec.id,
    mode: resolved.mode,
    baseUrl: resolved.baseUrl,
    method,
    http,
    ...(networkError ? { networkError } : {}),
    returned,
    ...(providerMessage ? { providerMessage: sanitizeMessage(providerMessage, secrets) } : {}),
  };
}

/**
 * Messages that mean "the provider did not accept the merchant credentials".
 * Kept to words that do not appear in a normal business error such as "order
 * not found" or "BIN not found".
 */
const AUTH_PATTERN =
  /(signature|auth(?:entication|orization)?|unauthori[sz]ed|forbidden|invalid\s+(?:api[\s-]?key|token|hash|credential|merchant)|api[\s-]?key|secret\s+key|bad\s+credentials|yetki|kimlik|doğrulan|geçersiz\s+(?:imza|token|anahtar)|hatal[ıi]\s+token|kullan[ıi]c[ıi]\s+ad[ıi]|şifre\s+hatal[ıi]|parola)/i;

function lastResponse(observation: ProbeObservation): HttpRecord | undefined {
  return observation.http[observation.http.length - 1];
}

function looksLikeHtml(record: HttpRecord): boolean {
  return /text\/html/i.test(record.contentType) || /^\s*<(!doctype|html)/i.test(record.bodySample);
}

function detailsOf(observation: ProbeObservation): string[] {
  const last = lastResponse(observation);
  if (!last) return [];
  return [`HTTP ${last.status}${last.contentType ? ` · ${last.contentType}` : ''} · ${last.url}`];
}

/**
 * Turns one probe into a verdict.
 *
 * The distinction the issue asks for:
 * - 401/403 or a provider authentication message => credentials rejected (wrong key)
 * - 404/405, an HTML login page, or no response => wrong mode/base URL
 * - any other provider answer => credentials accepted, with the provider's message
 */
export function classifyProbe(observation: ProbeObservation): ProbeClassification {
  const last = lastResponse(observation);
  const details = detailsOf(observation);
  const message = observation.providerMessage;

  if (!last && observation.networkError) {
    return {
      verdict: 'unreachable',
      status: 'fail',
      message: `no response from ${observation.baseUrl} (${observation.networkError})`,
      details: [
        'This is a mode/base URL problem, not a key problem: the host could not be reached.',
        `Check mode '${observation.mode}' and the base URL (or a proxy/firewall).`,
      ],
    };
  }

  if (last && (last.status === 401 || last.status === 403)) {
    return {
      verdict: 'rejected',
      status: 'fail',
      message: `credentials rejected by ${observation.baseUrl}${message ? `: ${message}` : ''}`,
      details: [
        ...details,
        'The host answered, so mode/base URL look right; rotate or re-copy the key and salt.',
      ],
    };
  }

  if (last && (last.status === 404 || last.status === 405)) {
    return {
      verdict: 'unreachable',
      status: 'fail',
      message: `base URL does not expose the ${observation.method} endpoint (HTTP ${last.status})`,
      details: [
        ...details,
        `This is a base URL/mode problem, not a key problem. Mode is '${observation.mode}'.`,
      ],
    };
  }

  if (last && looksLikeHtml(last)) {
    return {
      verdict: 'unreachable',
      status: 'fail',
      message: `base URL answered with an HTML page instead of the provider API`,
      details: [
        ...details,
        'A login page or proxy page means the base URL is wrong; the key was never checked.',
      ],
    };
  }

  if (last && last.status >= 500) {
    return {
      verdict: 'inconclusive',
      status: 'warn',
      message: `provider error HTTP ${last.status}; credentials were not judged`,
      details,
    };
  }

  const searched = [message ?? '', ...observation.http.map((record) => record.bodySample)].join(
    ' '
  );
  if (AUTH_PATTERN.test(searched)) {
    return {
      verdict: 'rejected',
      status: 'fail',
      message: `credentials rejected${message ? `: ${message}` : ''}`,
      details: [
        ...details,
        'The provider answered, so the base URL is reachable; the key is wrong.',
      ],
    };
  }

  if (observation.returned || last) {
    return {
      verdict: 'accepted',
      status: 'pass',
      message: `credentials accepted${message ? ` (provider said: ${message})` : ''}`,
      details,
    };
  }

  return {
    verdict: 'inconclusive',
    status: 'warn',
    message: 'the probe did not produce a provider answer',
    details,
  };
}

/** Seconds the provider's clock is ahead (positive) or behind (negative) */
export function clockSkewSeconds(dateHeader: string | undefined, now: number): number | undefined {
  if (!dateHeader) return undefined;
  const providerTime = Date.parse(dateHeader);
  if (Number.isNaN(providerTime)) return undefined;
  return Math.round((providerTime - now) / 1000);
}

/** Provider ids that sign a timestamp inside the request */
export function signsTimestamp(id: string): boolean {
  return id === 'akbank';
}
