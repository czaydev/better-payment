import {
  ConfigurationError,
  definePlugin,
  type BetterPaymentRequest,
  type PaymentErrorCode,
} from 'better-payment';
import * as locales from './locales';

export { locales };

/**
 * Messages of one language by error code: normalized codes and codes declared
 * by plugins in `$ERROR_CODES`
 */
export type TranslationDictionary = Partial<Record<PaymentErrorCode, string>> &
  Record<string, string | undefined>;

/** Where the language of an HTTP handler response comes from */
export type LocaleDetectionStrategy = 'header' | 'cookie' | 'callback';

export interface I18nOptions<Locale extends string = string> {
  /**
   * Translations by language. English is built in; add the languages you
   * support, from the built-in `locales` or your own:
   * `{ tr: locales.tr, de: { ...locales.de, INSUFFICIENT_FUNDS: '...' } }`.
   * A code missing in a language keeps the English message.
   */
  translations: { [L in Locale]: TranslationDictionary };
  /** Language of direct calls, and of responses whose language was not detected. Default: 'en' */
  defaultLocale?: NoInfer<Locale> | 'en';
  /**
   * Detection strategies for HTTP handler responses, in priority order; the
   * first supported language wins. `header`: `Accept-Language`; `cookie`: the
   * `localeCookie` cookie; `callback`: `getLocale`. Default: `['header']`
   */
  detection?: LocaleDetectionStrategy[];
  /** Cookie read by the `cookie` strategy. Default: 'locale' */
  localeCookie?: string;
  /** Language of a request, for the `callback` strategy */
  getLocale?: (
    request: BetterPaymentRequest
  ) => string | null | undefined | Promise<string | null | undefined>;
}

interface Localizable {
  code?: unknown;
  errorCode?: unknown;
  errorMessage?: unknown;
  providerMessage?: unknown;
}

function isLocalizable(value: unknown): value is Localizable {
  return !!value && typeof value === 'object' && typeof (value as Localizable).code === 'string';
}

/** Languages of an `Accept-Language` header, most preferred first */
export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part, index) => {
      const [tag, ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) : 1, index };
    })
    .filter(({ tag, q }) => tag && tag !== '*' && q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)
    .map(({ tag }) => tag);
}

/** A header of a request, by case-insensitive name */
function header(request: BetterPaymentRequest, name: string): string | undefined {
  return Object.entries(request.headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
}

/** A cookie of a `Cookie` header */
function cookie(cookies: string | undefined, name: string): string | undefined {
  for (const part of cookies?.split(';') ?? []) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) {
      const value = part.slice(index + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

/** The fallback language of `localizedErrors`; `i18n` always falls back to English */
const FALLBACK = Symbol('fallbackLocale');

/**
 * Translates the `errorMessage` of failed results into the customer's language,
 * chosen by the result's normalized `code` (or by a plugin's error code in
 * `errorCode`). The provider's message stays in `providerMessage`. Direct calls
 * answer in `defaultLocale`; HTTP handler responses in the detected language.
 *
 * @example
 * ```ts
 * import { i18n, locales } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     i18n({
 *       translations: { tr: locales.tr, de: locales.de },
 *       defaultLocale: 'tr',
 *       detection: ['cookie', 'header'],
 *     }),
 *   ],
 * });
 * ```
 */
export const i18n = <const Locale extends string>(options: I18nOptions<Locale>) => {
  const dictionaries: Record<string, TranslationDictionary> = { en: locales.en };
  for (const [locale, messages] of Object.entries<TranslationDictionary>(
    options.translations ?? {}
  )) {
    const key = locale.toLowerCase();
    dictionaries[key] = { ...dictionaries[key], ...messages };
  }
  const defaultLocale = (options.defaultLocale ?? 'en').toLowerCase();
  const fallbackLocale = ((options as { [FALLBACK]?: string })[FALLBACK] ?? 'en').toLowerCase();
  for (const required of [defaultLocale, fallbackLocale]) {
    if (!dictionaries[required]) {
      throw new ConfigurationError(
        `i18n: no translations for '${required}'. Pass them in translations.${required}.`
      );
    }
  }
  const detection = options.detection ?? ['header'];
  const localeCookie = options.localeCookie ?? 'locale';
  const supportedLocales = Object.keys(dictionaries);
  let pluginMessages: Readonly<Record<string, string>> = {};

  /** The supported language for a language tag (`tr-TR` → `tr`), if any */
  const supported = (tag: string | null | undefined): string | undefined => {
    if (!tag) return undefined;
    const lower = tag.toLowerCase();
    if (dictionaries[lower]) return lower;
    const base = lower.split('-')[0];
    return dictionaries[base] ? base : undefined;
  };

  const message = (code: string, language: string = defaultLocale): string | undefined => {
    const lang = supported(language) ?? defaultLocale;
    return dictionaries[lang][code] ?? dictionaries[fallbackLocale][code] ?? pluginMessages[code];
  };

  const translate = <T>(result: T, language: string = defaultLocale): T => {
    if (!isLocalizable(result)) return result;
    const text =
      (typeof result.errorCode === 'string' ? message(result.errorCode, language) : undefined) ??
      message(result.code as string, language);
    if (!text) return result;
    const original =
      typeof result.providerMessage === 'string'
        ? result.providerMessage
        : typeof result.errorMessage === 'string'
          ? result.errorMessage
          : undefined;
    return {
      ...result,
      errorMessage: text,
      ...(original !== undefined ? { providerMessage: original } : {}),
    };
  };

  /** The language of a request: the first strategy that finds a supported one */
  const detectLocale = async (request: BetterPaymentRequest): Promise<string> => {
    for (const strategy of detection) {
      let locale: string | undefined;
      if (strategy === 'header') {
        locale = parseAcceptLanguage(header(request, 'accept-language'))
          .map(supported)
          .find(Boolean);
      } else if (strategy === 'cookie') {
        locale = supported(cookie(header(request, 'cookie'), localeCookie));
      } else if (strategy === 'callback' && options.getLocale) {
        locale = supported(await options.getLocale(request));
      }
      if (locale) return locale;
    }
    return defaultLocale;
  };

  return definePlugin({
    id: 'i18n',
    options,
    hooks: {
      after: [
        {
          matcher: (ctx) => isLocalizable(ctx.result),
          handler: (ctx) => ({ result: translate(ctx.result) }),
        },
      ],
    },
    onResponse: async (response, { request }) => {
      if (!isLocalizable(response.body)) return;
      return { ...response, body: translate(response.body, await detectLocale(request)) };
    },
    methods: (ctx) => {
      // The live map of $ERROR_CODES: English defaults for codes declared by plugins
      pluginMessages = ctx.errorCodes;
      return {
        errors: {
          /** The message for an error code, in a language (default: `defaultLocale`) */
          message,
          /** A result with its `errorMessage` translated (for results of provider-specific methods) */
          translate,
          /** The language of an HTTP request, by the `detection` strategies */
          detectLocale,
          /** The languages that have translations */
          locales: supportedLocales,
        },
      };
    },
  });
};

/** @deprecated Renamed to `TranslationDictionary` */
export type ErrorMessageDictionary = TranslationDictionary;

/** @deprecated Renamed to `locales` */
export const errorMessages = locales;

/** @deprecated Use `i18n` and `I18nOptions` */
export interface LocalizedErrorsOptions {
  /** Default language. Default: 'en' */
  locale?: string;
  /** Used for codes missing in a language. Default: 'en' */
  fallbackLocale?: string;
  /** More languages, or overrides of the built-in messages, by language */
  messages?: Record<string, ErrorMessageDictionary>;
  /**
   * `true` (default) uses the `Accept-Language` header; a function returns a
   * language (or undefined for the default); `false` always uses `locale`.
   */
  detectLocale?: boolean | ((request: BetterPaymentRequest) => string | undefined);
}

/**
 * @deprecated Renamed to `i18n`, which works like the i18n plugin of better-auth:
 * `localizedErrors({ locale: 'tr' })` is
 * `i18n({ translations: locales, defaultLocale: 'tr' })`.
 */
export const localizedErrors = (options: LocalizedErrorsOptions = {}) => {
  const translations: Record<string, TranslationDictionary> = { ...locales };
  for (const [locale, messages] of Object.entries(options.messages ?? {})) {
    const key = locale.toLowerCase();
    translations[key] = { ...translations[key], ...messages };
  }
  const { detectLocale } = options;
  return i18n({
    translations,
    defaultLocale: options.locale,
    detection:
      detectLocale === false ? [] : typeof detectLocale === 'function' ? ['callback'] : ['header'],
    getLocale: typeof detectLocale === 'function' ? detectLocale : undefined,
    [FALLBACK]: options.fallbackLocale,
  } as I18nOptions);
};
