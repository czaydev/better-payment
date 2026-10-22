import { toNextJsHandler } from 'better-payment/next';
import { getBetterPayment } from '@/lib/payment';

// Prisma's SQLite client needs the Node.js runtime. better-payment itself also
// runs on edge; drop this line if your database supports edge (see the
// production notes in the README).
export const runtime = 'nodejs';

// Pass the getter, not the instance: the payment object is created on the first
// request, so `next build` never needs environment variables.
export const { GET, POST } = toNextJsHandler(getBetterPayment);
