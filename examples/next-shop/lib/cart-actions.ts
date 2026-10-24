'use server';

import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { readCart, writeCart } from './cart';
import { createOrderFromCart } from './orders';
import { DEMO_ADMIN_COOKIE, DEMO_ADMIN_VALUE, verifyDemoAdminKey } from './admin';

/** Home page "Add to cart": only a product id and a quantity cross the wire. */
export async function addToCart(formData: FormData): Promise<void> {
  const productId = String(formData.get('productId') ?? '');
  const quantity = Math.max(1, Math.floor(Number(formData.get('quantity') ?? 1)) || 1);
  const lines = await readCart();
  lines[productId] = Math.min((lines[productId] ?? 0) + quantity, 99);
  await writeCart(lines);
  redirect('/cart');
}

/** Rebuilds the cart from the quantity inputs on /cart; 0 or blank removes a line. */
export async function updateCart(formData: FormData): Promise<void> {
  const lines = await readCart();
  const next: Record<string, number> = {};
  for (const productId of Object.keys(lines)) {
    const raw = formData.get(`qty-${productId}`);
    const quantity = Math.floor(Number(raw));
    if (Number.isFinite(quantity) && quantity > 0) {
      next[productId] = Math.min(quantity, 99);
    }
  }
  await writeCart(next);
  redirect('/cart');
}

/**
 * "Checkout": the order is created HERE, on the server, with the amount summed
 * from database prices. The browser never sends a total.
 */
export async function startCheckout(): Promise<void> {
  const orderId = await createOrderFromCart();
  await writeCart({});
  redirect(`/checkout/${orderId}`);
}

/**
 * Demo admin login. Sets the cookie the handler's `authorize` hook checks for
 * the privileged `refund` action. Replace with real session auth — see README.
 */
export async function logInAsDemoAdmin(formData: FormData): Promise<void> {
  const key = String(formData.get('adminKey') ?? '');
  if (!verifyDemoAdminKey(key)) {
    redirect('/admin?error=wrong-key');
  }
  const store = await cookies();
  store.set(DEMO_ADMIN_COOKIE, DEMO_ADMIN_VALUE, {
    path: '/',
    maxAge: 60 * 60 * 8,
    sameSite: 'lax',
  });
  redirect('/admin');
}
