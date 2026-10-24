import { getOrder, isPayable } from '@/lib/orders';
import { PROVIDER_ID } from '@/lib/payment';
import { formatKurus } from '@/lib/products';
import { CheckoutForm } from '@/components/CheckoutForm';
import { MOCK_CARDS } from 'better-payment/testing';

export const dynamic = 'force-dynamic';

/** Step 3: the card form for a NEW order. The order amount is already in the database. */
export default async function CheckoutPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const order = await getOrder(orderId);

  if (!order) {
    return (
      <>
        <h1>Checkout</h1>
        <p className="error">Unknown order id.</p>
      </>
    );
  }
  if (!isPayable(order.status)) {
    return (
      <>
        <h1>Checkout</h1>
        <p className="muted">
          This order is already <span className={`pill ${order.status}`}>{order.status}</span>.{' '}
          <a href={`/orders/${order.id}`}>View the order</a>.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Checkout</h1>
      <p className="muted">
        Order <code>{order.id}</code> · {formatKurus(order.amountKurus)} {order.currency} · amounts
        come from the database row, the browser only sends the order id and the card.
      </p>

      {PROVIDER_ID === 'mock' ? (
        <fieldset>
          <legend>MockProvider magic cards</legend>
          <div className="list">
            <p className="muted">
              <code>{MOCK_CARDS.SUCCESS}</code> — succeeds · any future expiry, any CVC
            </p>
            <p className="muted">
              <code>{MOCK_CARDS.CARD_DECLINED}</code> — declined (localized error message)
            </p>
            <p className="muted">
              <code>{MOCK_CARDS.THREEDS_FAILED}</code> — 3D Secure authentication fails
            </p>
            <p className="muted">
              <code>{MOCK_CARDS.NETWORK_ERROR}</code> — 3D Secure completes as pending
              (NETWORK_ERROR)
            </p>
          </div>
        </fieldset>
      ) : null}

      <CheckoutForm
        orderId={order.id}
        providerId={PROVIDER_ID}
        totalLabel={`${formatKurus(order.amountKurus)} ${order.currency}`}
      />
    </>
  );
}
