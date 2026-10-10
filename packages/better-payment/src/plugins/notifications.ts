import {
  ConfigurationError,
  definePlugin,
  type BetterPaymentLogger,
  type PaymentEvent,
  type PaymentEventType,
} from 'better-payment';

/**
 * A payment event as notifications see it: without the request and the result,
 * so card data can never end up in a message.
 */
export type NotificationEvent = Omit<PaymentEvent, 'request' | 'result'>;

type EventFilter = PaymentEventType | '*';

interface ChannelBase {
  /** Events sent to this channel. Default: all (`['*']`) */
  events?: EventFilter[];
}

export type NotificationChannel = ChannelBase &
  (
    | {
        type: 'slack';
        /** An incoming webhook URL: https://hooks.slack.com/services/... */
        webhookUrl: string;
      }
    | {
        type: 'discord';
        /** A channel webhook URL: https://discord.com/api/webhooks/... */
        webhookUrl: string;
      }
    | {
        type: 'telegram';
        /** The token BotFather gave you */
        botToken: string;
        /** The chat, group or channel id (`-100...`) or `@channelname` */
        chatId: string | number;
      }
    | {
        type: 'custom';
        /** A name for logs and `onError`. Default: 'custom' */
        name?: string;
        /** Sends the message anywhere: email, SMS, a queue... */
        send: (message: string, event: NotificationEvent) => Promise<void> | void;
      }
  );

export type NotificationLocale = 'en' | 'tr' | 'de' | 'ru' | 'ar';

export interface NotificationsOptions {
  channels: NotificationChannel[];
  /** Language of the default messages. Default: 'en' */
  locale?: NotificationLocale;
  /** Builds the message text instead of the default one */
  format?: (event: NotificationEvent) => string;
  /**
   * Skip events with an amount below this (compared as a number, in any
   * currency). Events without an amount are always sent.
   */
  minAmount?: number;
  /** Return false to skip an event */
  filter?: (event: NotificationEvent) => boolean;
  /**
   * Keeps the runtime alive until the messages are sent, on serverless
   * platforms: Vercel's `waitUntil`, or `ctx.waitUntil` on Cloudflare Workers.
   */
  waitUntil?: (promise: Promise<unknown>) => void;
  /** Called when a channel fails. Default: the payment logger's `error` */
  onError?: (error: unknown, channel: string, event: NotificationEvent) => void;
  /** Gives up on a channel after this many milliseconds. Default: 10000 */
  timeout?: number;
  /** The fetch used for Slack, Discord and Telegram. Default: global fetch */
  fetch?: typeof fetch;
}

type Labels = [
  succeeded: string,
  authorized: string,
  pending: string,
  failed: string,
  cancelled: string,
  refunded: string,
  refundFailed: string,
  payment: string,
  order: string,
  error: string,
];

const LABELS: Record<NotificationLocale, Labels> = {
  en: [
    'Payment received',
    'Payment authorized',
    'Payment pending',
    'Payment failed',
    'Payment cancelled',
    'Refund completed',
    'Refund failed',
    'Payment',
    'Order',
    'Error',
  ],
  tr: [
    'Ödeme alındı',
    'Ödeme provizyonu alındı',
    'Ödeme beklemede',
    'Ödeme başarısız',
    'Ödeme iptal edildi',
    'İade tamamlandı',
    'İade başarısız',
    'Ödeme',
    'Sipariş',
    'Hata',
  ],
  de: [
    'Zahlung eingegangen',
    'Zahlung autorisiert',
    'Zahlung ausstehend',
    'Zahlung fehlgeschlagen',
    'Zahlung storniert',
    'Erstattung abgeschlossen',
    'Erstattung fehlgeschlagen',
    'Zahlung',
    'Bestellung',
    'Fehler',
  ],
  ru: [
    'Платёж получен',
    'Платёж авторизован',
    'Платёж в ожидании',
    'Платёж не прошёл',
    'Платёж отменён',
    'Возврат выполнен',
    'Возврат не выполнен',
    'Платёж',
    'Заказ',
    'Ошибка',
  ],
  ar: [
    'تم استلام الدفعة',
    'تم تفويض الدفعة',
    'الدفعة قيد الانتظار',
    'فشلت الدفعة',
    'تم إلغاء الدفعة',
    'تم الاسترداد',
    'فشل الاسترداد',
    'الدفعة',
    'الطلب',
    'الخطأ',
  ],
};

const TYPES: PaymentEventType[] = [
  'payment.succeeded',
  'payment.authorized',
  'payment.pending',
  'payment.failed',
  'payment.cancelled',
  'refund.succeeded',
  'refund.failed',
];
const ICONS = ['✅', '🔒', '⏳', '❌', '🚫', '↩️', '⚠️'];

/** The default message: `✅ Payment received: 150.00 TRY (iyzico)` and the ids */
export function formatNotification(
  event: NotificationEvent,
  locale: NotificationLocale = 'en'
): string {
  const labels = LABELS[locale];
  const index = TYPES.indexOf(event.type);
  const amount = event.amount ? `: ${event.amount} ${event.currency ?? ''}`.trimEnd() : '';
  const details = [
    event.paymentId && `${labels[7]}: ${event.paymentId}`,
    event.conversationId && `${labels[8]}: ${event.conversationId}`,
    event.code && `${labels[9]}: ${event.code}`,
  ].filter(Boolean);
  const head = `${ICONS[index]} ${labels[index]}${amount} (${event.provider})`;
  return details.length ? `${head}\n${details.join(' · ')}` : head;
}

/** Slack reads <, > and & as markup */
const slackEscape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Sends payment events as readable messages to Slack, Discord, Telegram or your
 * own channel (email, SMS...). Messages are sent in the background: a failing
 * channel is reported to `onError` and never affects the payment.
 *
 * @example
 * ```ts
 * import { notifications } from 'better-payment/plugins';
 *
 * notifications({
 *   locale: 'tr',
 *   channels: [
 *     { type: 'slack', webhookUrl: process.env.SLACK_WEBHOOK!, events: ['payment.succeeded'] },
 *     { type: 'telegram', botToken: process.env.TG_TOKEN!, chatId: '123' },
 *   ],
 * });
 * ```
 */
export const notifications = (options: NotificationsOptions) => {
  const locale = options.locale ?? 'en';
  if (!LABELS[locale]) {
    throw new ConfigurationError(
      `notifications: unknown locale '${locale}'. Use ${Object.keys(LABELS).join(', ')} or format.`
    );
  }
  for (const channel of options.channels) {
    const missing =
      channel.type === 'telegram'
        ? !channel.botToken || channel.chatId === undefined || channel.chatId === ''
        : channel.type === 'custom'
          ? typeof channel.send !== 'function'
          : !channel.webhookUrl;
    if (missing) {
      throw new ConfigurationError(`notifications: the ${channel.type} channel is incomplete`);
    }
  }
  const timeout = options.timeout ?? 10_000;
  const pending = new Set<Promise<void>>();
  let logger: BetterPaymentLogger | undefined;

  const post = async (url: string, body: unknown) => {
    const response = await (options.fetch ?? fetch)(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  };

  const report = (error: unknown, name: string, event: NotificationEvent) => {
    try {
      if (options.onError) options.onError(error, name, event);
      else
        logger?.error(
          `notifications: the ${name} channel failed`,
          error instanceof Error ? error : new Error(String(error)),
          { event: event.type, paymentId: event.paymentId }
        );
    } catch {
      // A failing onError must not fail the payment either
    }
  };

  const deliver = (channel: NotificationChannel, message: string, event: NotificationEvent) => {
    switch (channel.type) {
      case 'slack':
        return post(channel.webhookUrl, { text: slackEscape(message) });
      case 'discord':
        // No @everyone or role pings from order ids
        return post(channel.webhookUrl, { content: message, allowed_mentions: { parse: [] } });
      case 'telegram':
        return post(`https://api.telegram.org/bot${channel.botToken}/sendMessage`, {
          chat_id: channel.chatId,
          text: message,
        });
      case 'custom':
        return channel.send(message, event);
    }
  };

  const notify = async (event: NotificationEvent) => {
    if (options.minAmount !== undefined && event.amount !== undefined) {
      if (Number(event.amount) < options.minAmount) return;
    }
    if (options.filter && !options.filter(event)) return;
    const channels = options.channels.filter(({ events = ['*'] }) =>
      events.some((type) => type === '*' || type === event.type)
    );
    if (!channels.length) return;

    const message = options.format ? options.format(event) : formatNotification(event, locale);
    await Promise.all(
      channels.map(async (channel) => {
        const name = channel.type === 'custom' ? (channel.name ?? 'custom') : channel.type;
        try {
          await deliver(channel, message, event);
        } catch (error) {
          report(error, name, event);
        }
      })
    );
  };

  return definePlugin({
    id: 'notifications',
    options,
    init(ctx) {
      logger = ctx.logger;
    },
    events: {
      '*': ({ request: _request, result: _result, ...event }: PaymentEvent) => {
        // A throwing format or filter must not fail the payment either
        const task: Promise<void> = notify(event)
          .catch((error) => report(error, 'format', event))
          .finally(() => pending.delete(task));
        pending.add(task);
        options.waitUntil?.(task);
      },
    },
    methods: () => ({
      notifications: {
        /** Resolves when every message started so far is sent (or failed) */
        flush: async (): Promise<void> => {
          await Promise.all(pending);
        },
      },
    }),
  });
};
