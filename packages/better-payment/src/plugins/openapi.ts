import {
  definePlugin,
  DEFAULT_HANDLER_ACTIONS,
  PRIVILEGED_HANDLER_ACTIONS,
  type BetterPaymentPlugin,
  type BuiltInHandlerAction,
  type EndpointContext,
  type EndpointHandlerInfo,
  type PluginContext,
} from 'better-payment';

export interface OpenAPIOptions {
  /**
   * Path where the Scalar reference page is served, and where `<path>/openapi.json` is served.
   * Default: '/reference'
   */
  path?: string;
  /**
   * OpenAPI document information metadata
   */
  info?: {
    title?: string;
    version?: string;
    description?: string;
  };
  /**
   * Turns the reference routes off; they answer 404.
   * Default: true in `mode: 'production'`, false in `mode: 'sandbox'`
   */
  disabled?: boolean;
  /**
   * Serves the reference routes as privileged endpoints, so they go through the
   * handler's `authorize` hook (which then becomes required). Default: false
   */
  privileged?: boolean;
  /**
   * URL of the Scalar reference UI script. Pinned to `@scalar/api-reference@<version>` by
   * default so a new Scalar release cannot change the page on a merchant's domain without
   * review. Point it at a self-hosted copy to avoid the CDN entirely.
   */
  scalarScriptUrl?: string;
}

/** Pinned so the reference page only changes when this library is updated. */
export const SCALAR_API_REFERENCE_VERSION = '1.75.0';

const DEFAULT_SCALAR_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/@scalar/api-reference@${SCALAR_API_REFERENCE_VERSION}`;

export interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  servers: { url: string }[];
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
  };
  tags?: { name: string; description?: string }[];
}

function trimSlashes(p: string): string {
  let start = 0;
  let end = p.length;
  while (start < end && p[start] === '/') start++;
  while (end > start && p[end - 1] === '/') end--;
  return p.slice(start, end);
}

/** The handler action behind each documented core route */
const ROUTE_ACTIONS: Record<string, BuiltInHandlerAction> = {
  '/{provider}/payment': 'payment',
  '/{provider}/payment/init-3ds': 'payment/init-3ds',
  '/{provider}/payment/complete-3ds': 'payment/complete-3ds',
  '/{provider}/payment/{paymentId}': 'payment/get',
  '/{provider}/callback': 'callback',
  '/{provider}/refund': 'refund',
  '/{provider}/cancel': 'cancel',
  '/{provider}/authorize': 'authorize',
  '/{provider}/capture': 'capture',
  '/{provider}/void': 'void',
  '/{provider}/installment': 'installment',
  '/{provider}/bin-check': 'bin-check',
  '/{provider}/cards/save': 'cards/save',
  '/{provider}/cards/list': 'cards/list',
  '/{provider}/cards/delete': 'cards/delete',
};

/** The handler defaults, for a document built outside a request */
const DEFAULT_HANDLER: EndpointHandlerInfo = {
  basePath: '/api/pay',
  allowedActions: DEFAULT_HANDLER_ACTIONS as BuiltInHandlerAction[],
};

/**
 * Builds the OpenAPI 3.1.0 document from the configured providers, the core routes
 * the handler serves, and registered plugin endpoints. Without `handler`, the
 * handler defaults are assumed (basePath `/api/pay`, `DEFAULT_HANDLER_ACTIONS`).
 */
export function buildOpenAPISpec(
  options: OpenAPIOptions,
  ctx?: PluginContext,
  handler: EndpointHandlerInfo = DEFAULT_HANDLER
): OpenAPISpec {
  const providerParam = {
    name: 'provider',
    in: 'path',
    required: true,
    description: 'The payment provider id (e.g. iyzico, paytr, akbank, sipay)',
    schema: {
      type: 'string',
      enum: ctx?.providerIds && ctx.providerIds.length > 0 ? ctx.providerIds : undefined,
    },
  };

  const bearerAuth = [{ bearerAuth: [] }];

  const paths: Record<string, Record<string, unknown>> = {
    '/{provider}/payment': {
      post: {
        summary: 'Create payment',
        description:
          'Initiates and charges a direct (non-3D) payment through the selected provider.',
        tags: ['Payments'],
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['price', 'paidPrice'],
                properties: {
                  price: { type: 'string', example: '100.00' },
                  paidPrice: { type: 'string', example: '100.00' },
                  currency: { type: 'string', default: 'TRY', example: 'TRY' },
                  conversationId: { type: 'string', example: 'order-12345' },
                  paymentCard: {
                    type: 'object',
                    properties: {
                      cardHolderName: { type: 'string' },
                      cardNumber: { type: 'string' },
                      expireMonth: { type: 'string' },
                      expireYear: { type: 'string' },
                      cvc: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Payment response' },
          '400': { description: 'Bad request or validation error' },
        },
      },
    },
    '/{provider}/payment/init-3ds': {
      post: {
        summary: 'Initiate 3D Secure payment',
        description:
          'Initiates a 3D Secure payment session and returns HTML or redirect URL for bank challenge.',
        tags: ['3D Secure'],
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['price', 'paidPrice', 'callbackUrl'],
                properties: {
                  price: { type: 'string', example: '100.00' },
                  paidPrice: { type: 'string', example: '100.00' },
                  currency: { type: 'string', default: 'TRY' },
                  callbackUrl: { type: 'string', format: 'uri' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: '3D Secure session initialized' },
        },
      },
    },
    '/{provider}/payment/complete-3ds': {
      post: {
        summary: 'Complete 3D Secure payment',
        description: 'Completes a 3D Secure payment using callback data sent by the bank.',
        tags: ['3D Secure'],
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object' },
            },
          },
        },
        responses: {
          '200': { description: '3D Secure payment completed' },
        },
      },
    },
    '/{provider}/payment/{paymentId}': {
      get: {
        summary: 'Get payment status',
        description: 'Retrieves the details and outcome of a previously processed payment.',
        tags: ['Payments'],
        parameters: [
          providerParam,
          {
            name: 'paymentId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'The payment ID returned by the provider',
          },
        ],
        responses: {
          '200': { description: 'Payment details' },
          '404': { description: 'Payment not found' },
        },
      },
    },
    '/{provider}/callback': {
      post: {
        summary: '3D Secure callback',
        description:
          'Receives the bank authorization callback payload for 3D Secure authentication.',
        tags: ['3D Secure'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Callback received and processed' },
        },
      },
    },
    '/{provider}/refund': {
      post: {
        summary: 'Refund payment',
        description: 'Refunds a captured transaction in whole or in part. Requires authorization.',
        tags: ['Refunds'],
        security: bearerAuth,
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['paymentId', 'price'],
                properties: {
                  paymentId: { type: 'string' },
                  price: { type: 'string', example: '50.00' },
                  currency: { type: 'string', default: 'TRY' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Refund outcome' },
          '401': { description: 'Unauthorized' },
        },
      },
    },
    '/{provider}/cancel': {
      post: {
        summary: 'Cancel payment',
        description: 'Voids an un-settled transaction on the same day. Requires authorization.',
        tags: ['Refunds'],
        security: bearerAuth,
        parameters: [providerParam],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['paymentId'],
                properties: {
                  paymentId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Cancellation outcome' },
        },
      },
    },
    '/{provider}/authorize': {
      post: {
        summary: 'Pre-authorize payment',
        description: 'Blocks the requested amount on customer card without charging.',
        tags: ['Pre-authorization'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Pre-authorization outcome' },
        },
      },
    },
    '/{provider}/capture': {
      post: {
        summary: 'Capture pre-authorization',
        description: 'Charges previously blocked funds. Requires authorization.',
        tags: ['Pre-authorization'],
        security: bearerAuth,
        parameters: [providerParam],
        responses: {
          '200': { description: 'Capture outcome' },
        },
      },
    },
    '/{provider}/void': {
      post: {
        summary: 'Void pre-authorization',
        description: 'Releases blocked funds back to the cardholder without charging.',
        tags: ['Pre-authorization'],
        security: bearerAuth,
        parameters: [providerParam],
        responses: {
          '200': { description: 'Void outcome' },
        },
      },
    },
    '/{provider}/installment': {
      post: {
        summary: 'Get installment options',
        description: 'Queries available bank installment tiers and commission rates for card BIN.',
        tags: ['Installments'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Installment table' },
        },
      },
    },
    '/{provider}/bin-check': {
      post: {
        summary: 'BIN lookup',
        description: 'Queries card issuer bank, family, card type and brand from 6-8 digit BIN.',
        tags: ['Cards'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Card BIN information' },
        },
      },
    },
    '/{provider}/cards/save': {
      post: {
        summary: 'Save card',
        description: 'Stores a credit card token safely on the provider vault.',
        tags: ['Cards'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Card stored' },
        },
      },
    },
    '/{provider}/cards/list': {
      post: {
        summary: 'List saved cards',
        description: 'Lists stored cards for a given user token.',
        tags: ['Cards'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'List of stored cards' },
        },
      },
    },
    '/{provider}/cards/delete': {
      post: {
        summary: 'Delete saved card',
        description: 'Removes a stored card from the provider vault.',
        tags: ['Cards'],
        parameters: [providerParam],
        responses: {
          '200': { description: 'Card deleted' },
        },
      },
    },
    '/health': {
      get: {
        summary: 'Health check',
        description: 'Returns health status of the payment handler service.',
        tags: ['System'],
        responses: {
          '200': { description: 'Service is healthy' },
        },
      },
    },
  };

  // Only the core routes the handler serves; the others answer 404
  const allowed = new Set<string>(handler.allowedActions);
  for (const [path, action] of Object.entries(ROUTE_ACTIONS)) {
    if (!allowed.has(action)) {
      delete paths[path];
      continue;
    }
    if (PRIVILEGED_HANDLER_ACTIONS.includes(action)) {
      for (const operation of Object.values(paths[path])) {
        (operation as Record<string, unknown>).security = bearerAuth;
      }
    }
  }

  // Add plugin endpoints
  if (ctx) {
    for (const ep of ctx.endpoints) {
      // Don't document the openapi reference routes inside themselves
      if (ep.pluginId === 'openapi') continue;

      const pathKey = ep.path.startsWith('/') ? ep.path : `/${ep.path}`;
      if (!Object.prototype.hasOwnProperty.call(paths, pathKey)) {
        paths[pathKey] = {};
      }

      const methodKey = ep.method.toLowerCase();
      if (methodKey !== 'get' && methodKey !== 'post') continue;
      paths[pathKey][methodKey] = {
        summary: ep.openapi?.summary ?? `${ep.name} (${ep.pluginId})`,
        description: ep.openapi?.description ?? `Plugin endpoint provided by ${ep.pluginId}`,
        tags: ep.openapi?.tags ?? ['Plugins', ep.pluginId],
        security: ep.privileged ? bearerAuth : undefined,
        parameters: ep.openapi?.parameters,
        requestBody: ep.openapi?.requestBody,
        responses: ep.openapi?.responses ?? {
          '200': { description: 'Successful response' },
        },
      };
    }
  }

  return {
    openapi: '3.1.0',
    info: {
      title: options.info?.title ?? 'Better Payment API',
      version: options.info?.version ?? '1.0.0',
      description:
        options.info?.description ??
        'OpenAPI 3.1 reference for Better Payment HTTP handler routes and plugin endpoints.',
    },
    servers: [{ url: handler.basePath }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'Authorization header for privileged handler endpoints (Bearer token)',
        },
      },
    },
    tags: [
      { name: 'Payments', description: 'Direct payment processing operations' },
      { name: '3D Secure', description: '3D Secure 1.0 & 2.0 authentication flows' },
      { name: 'Refunds', description: 'Refunds and cancellation operations' },
      { name: 'Pre-authorization', description: 'Authorization, capture and void workflows' },
      { name: 'Installments', description: 'Installment queries and bank campaigns' },
      { name: 'Cards', description: 'Stored cards and BIN checks' },
      { name: 'System', description: 'System health checks' },
      { name: 'Plugins', description: 'Endpoints contributed by official and custom plugins' },
    ],
  };
}

/**
 * Escapes a value for interpolation into HTML text or a double-quoted attribute.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderScalarHtml(spec: OpenAPISpec, title: string, scriptUrl: string): string {
  // The document goes in the element's text, not an attribute: descriptions and summaries are
  // free text and an apostrophe would end a quoted attribute and break the page.
  // `<` is escaped as a JSON string escape, so a value can never close the script element.
  const specJson = JSON.stringify(spec).replace(/</g, '\\u003c');
  return `<!doctype html>
<html>
  <head>
    <title>${escapeHtml(title)}</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <script id="api-reference" type="application/json" data-configuration='{"theme":"purple"}'>${specJson}</script>
    <script src="${escapeHtml(scriptUrl)}"></script>
  </body>
</html>`;
}

/**
 * OpenAPI plugin for better-payment.
 *
 * Generates an OpenAPI 3.1.0 specification and an interactive Scalar documentation
 * reference page for all HTTP handler routes, configured providers, and plugin endpoints.
 *
 * @example
 * ```ts
 * import { openAPI } from 'better-payment/plugins';
 *
 * const payment = betterPayment({
 *   providers: { ... },
 *   plugins: [
 *     openAPI({
 *       path: '/reference',
 *       info: { title: 'Store Checkout API' },
 *     }),
 *   ],
 * });
 * ```
 */
export function openAPI(options: OpenAPIOptions = {}): BetterPaymentPlugin {
  const rawPath = options.path ?? '/reference';
  const basePath = '/' + trimSlashes(rawPath);
  const jsonPath = `${basePath}/openapi.json`;
  const scriptUrl = options.scalarScriptUrl ?? DEFAULT_SCALAR_SCRIPT_URL;
  const privileged = options.privileged === true;

  const isDisabled = (ctx: EndpointContext): boolean =>
    options.disabled ?? ctx.mode === 'production';
  const notFound = (ctx: EndpointContext) =>
    ctx.json({ status: 'error', errorMessage: 'OpenAPI reference is disabled' }, 404);

  return definePlugin({
    id: 'openapi',
    options,
    endpoints: {
      scalarUi: {
        method: 'GET',
        path: basePath,
        privileged,
        handler: (ctx) => {
          if (isDisabled(ctx)) return notFound(ctx);
          const spec = buildOpenAPISpec(options, ctx, ctx.handler);
          return ctx.html(
            renderScalarHtml(spec, options.info?.title ?? 'Better Payment API Reference', scriptUrl)
          );
        },
      },
      openApiJson: {
        method: 'GET',
        path: jsonPath,
        privileged,
        handler: (ctx) => {
          if (isDisabled(ctx)) return notFound(ctx);
          return ctx.json(buildOpenAPISpec(options, ctx, ctx.handler));
        },
      },
    },
  });
}
