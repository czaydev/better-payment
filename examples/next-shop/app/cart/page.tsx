import Link from 'next/link';
import { cartSummary, readCart } from '@/lib/cart';
import { formatKurus } from '@/lib/products';
import { startCheckout, updateCart } from '@/lib/cart-actions';

export const dynamic = 'force-dynamic';

/** Step 2: the cart. Line totals and the grand total are server-computed. */
export default async function CartPage() {
  const lines = await readCart();
  const summary = await cartSummary(lines);

  if (summary.rows.length === 0) {
    return (
      <>
        <h1>Cart</h1>
        <p className="muted">
          Your cart is empty. <Link href="/">Browse the products</Link>.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Cart</h1>
      <p className="muted">
        The cart cookie only holds product ids and quantities. Every price below is read from the
        database on each render, and the order takes its amount from this same computation.
      </p>
      <form action={updateCart}>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Unit price</th>
              <th>Quantity</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={row.productId}>
                <td>{row.name}</td>
                <td>
                  {formatKurus(row.unitPriceKurus)} {summary.currency}
                </td>
                <td>
                  <input
                    type="number"
                    name={`qty-${row.productId}`}
                    defaultValue={row.quantity}
                    min={0}
                    max={99}
                    aria-label={`Quantity for ${row.name}`}
                  />
                </td>
                <td>
                  {formatKurus(row.lineKurus)} {summary.currency}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={3}>Total (server-side)</th>
              <th>
                {formatKurus(summary.totalKurus)} {summary.currency}
              </th>
            </tr>
          </tfoot>
        </table>
        <p>
          <button type="submit" className="secondary">
            Update quantities
          </button>
        </p>
      </form>

      <h2>Checkout</h2>
      <form action={startCheckout}>
        <button type="submit">Create order and continue to payment</button>
      </form>
    </>
  );
}
