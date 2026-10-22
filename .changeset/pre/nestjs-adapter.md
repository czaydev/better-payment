---
"better-payment": minor
---

Add the `better-payment/nestjs` framework adapter: `toNestHandler(payment)` returns a single request handler for a NestJS controller that works on both the Express and the Fastify platform. It has no `@nestjs/*` dependency and reads the request and response objects injected by `@Req()` and `@Res()`

<!-- docs -->
en: **[NestJS adapter](/docs/integrations/frameworks#nestjs):** mount the payment handler in a NestJS controller on the Express or Fastify platform with `better-payment/nestjs`, without a `@nestjs/*` dependency.
tr: **[NestJS adapter](/docs/integrations/frameworks#nestjs):** ödeme handler'ını `better-payment/nestjs` ile bir NestJS controller'ına, Express veya Fastify platformunda ve `@nestjs/*` bağımlılığı olmadan bağlayın.
