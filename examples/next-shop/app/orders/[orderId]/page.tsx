import Link from 'next/link';
import { getOrder } from '@/lib/orders';
import { formatKurus } from '@/lib/products';

export const dynamic = 'force-dynamic';

/**
 * Step 4: the return page. `callbackRedirect` sends the browser here after the
 * verified callback, with ?payment=success|failure|pending. What is displayed
 * is the DATABASE status — written by the payment events, not by the URL.
 */
export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<{ payment?: string }>;
}) {
  const { orderId } = await params;
  const { payment } = await searchParams;
  const order = await getOrder(orderId);

  if (!order) {
    return (
      <>
        <h1>Order</h1>
        <p className="error">Unknown order id.</p>
      </>
    );
  }

  return (
    <>
      <h1>Order {order.id}</h1>
      <p>
        Status: <span className={`pill ${order.status}`}>{order.status}</span>
        {order.errorCode ? <span className="muted"> · last error: {order.errorCode}</span> : null}
      </p>

      {payment === 'success' ? <p className="ok">Payment confirmed by the provider.</p> : null}
      {payment === 'failure' ? (
        <p className="error">
          The payment failed. The status above is what the payment event recorded.
        </p>
      ) : null}
      {payment === 'pending' ? (
        <p className="muted">
          The provider did not confirm an outcome (e.g. a lost response). Check with
          <code>getPayment</code> before retrying — never assume success here.
        </p>
      ) : null}

      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Line total</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item.id}>
              <td>{item.name}</td>
              <td>{item.quantity}</td>
              <td>
                {formatKurus(item.unitPriceKurus * item.quantity)} {order.currency}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="price">
        Total: {formatKurus(order.amountKurus)} {order.currency} · {order.installment}x installment
      </p>
      {order.paidPriceKurus !== null && order.paidPriceKurus !== order.amountKurus ? (
        <p className="muted">
          Charged by the provider with the installment commission:{' '}
          {formatKurus(order.paidPriceKurus)} {order.currency}
        </p>
      ) : null}

      {order.refunds.length > 0 ? (
        <>
          <h2>Refunds</h2>
          <ul className="list">
            {order.refunds.map((refund) => (
              <li key={refund.id}>
                <code>{refund.id}</code> · {formatKurus(refund.amountKurus)} {order.currency}
                {refund.providerRefundId ? (
                  <span className="muted">
                    {' '}
                    · provider ref <code>{refund.providerRefundId}</code>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p>
        <Link href="/">Continue shopping</Link>
      </p>
    </>
  );
}
