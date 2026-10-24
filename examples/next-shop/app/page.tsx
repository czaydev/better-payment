import { formatKurus, loadProducts } from '@/lib/products';
import { addToCart } from '@/lib/cart-actions';

export const dynamic = 'force-dynamic';

/** Step 1 of the flow: the product list. Adding to the cart runs a server action. */
export default async function HomePage() {
  const products = await loadProducts();

  return (
    <>
      <h1>Products</h1>
      <p className="muted">
        Prices live in <code>lib/catalog.ts</code> and are stored in kuruş. The checkout total is
        always computed on the server from these rows.
      </p>
      <div className="grid">
        {products.map((product) => (
          <div className="card" key={product.id}>
            <h3>{product.name}</h3>
            <p className="muted">{product.detail}</p>
            <p className="price">
              {formatKurus(product.priceKurus)} {product.currency}
            </p>
            <form action={addToCart}>
              <input type="hidden" name="productId" value={product.id} />
              <input type="hidden" name="quantity" value="1" />
              <button type="submit">Add to cart</button>
            </form>
          </div>
        ))}
      </div>
    </>
  );
}
