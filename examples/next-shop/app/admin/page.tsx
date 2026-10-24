import { cookies } from 'next/headers';
import { listOrders } from '@/lib/orders';
import { formatKurus } from '@/lib/products';
import { PROVIDER_ID } from '@/lib/payment';
import { DEMO_ADMIN_COOKIE, DEMO_ADMIN_VALUE, demoAdminKeyHint } from '@/lib/admin';
import { logInAsDemoAdmin } from '@/lib/cart-actions';
import { RefundButton } from '@/components/RefundButton';

export const dynamic = 'force-dynamic';

/**
 * Step 5: the admin page. Refunding is the privileged route — the handler only
 * serves /api/pay/<provider>/refund when its `authorize` hook accepts the
 * request. Here that means the demo admin cookie; replace with real auth.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const store = await cookies();
  const isAdmin = store.get(DEMO_ADMIN_COOKIE)?.value === DEMO_ADMIN_VALUE;

  if (!isAdmin) {
    return (
      <>
        <h1>Admin</h1>
        <p className="muted">
          Demo login. In production this is your session with an <code>admin</code> role — the
          example only demonstrates the shape of a privileged route.
        </p>
        {error === 'wrong-key' ? <p className="error">Wrong demo admin key.</p> : null}
        <form action={logInAsDemoAdmin}>
          <label>
            Demo admin key
            <input type="password" name="adminKey" required />
          </label>
          <p className="muted">{demoAdminKeyHint()}</p>
          <button type="submit">Log in</button>
        </form>
      </>
    );
  }

  const orders = await listOrders();

  return (
    <>
      <h1>Orders</h1>
      <p className="muted">
        Statuses are written exclusively by payment events, so this list is the provider&apos;s
        truth, not the browser&apos;s.
      </p>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Status</th>
            <th>Amount</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id}>
              <td>
                <a href={`/orders/${order.id}`}>{order.id}</a>
              </td>
              <td>
                <span className={`pill ${order.status}`}>{order.status}</span>
              </td>
              <td>
                {formatKurus(order.amountKurus)} {order.currency}
              </td>
              <td>{order.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</td>
              <td>
                {order.status === 'PAID' ? (
                  <RefundButton orderId={order.id} providerId={PROVIDER_ID} />
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
