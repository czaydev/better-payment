import { NextResponse } from 'next/server';
import { setInstallment } from '@/lib/orders';

/**
 * Saves the installment count the shopper picked. The count alone is stored;
 * the amount it applies to always comes from the order row, and a count that
 * the provider did not actually quote for this BIN is ignored (the client-side
 * select only offers quoted values; here we just bound it).
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const source = (body ?? {}) as Record<string, unknown>;
  const orderId = typeof source.orderId === 'string' ? source.orderId : '';
  const installment = Math.floor(Number(source.installment));
  if (!orderId || !Number.isInteger(installment) || installment < 1 || installment > 12) {
    return NextResponse.json({ error: 'orderId and installment (1-12) are required' }, { status: 400 });
  }
  const updated = await setInstallment(orderId, installment);
  if (!updated) {
    return NextResponse.json({ error: 'Order not found or not payable' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
