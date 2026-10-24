import { expect, test } from '@playwright/test';

/**
 * Happy path with MockProvider:
 *
 *   product list -> cart -> server-created order -> 3D Secure -> paid order
 *   -> admin refund
 *
 * The mock bank's 3D Secure page posts a signed callback to the handler, which
 * updates the order through payment events, exactly like a real provider.
 */
test('cart to paid order to refund with MockProvider', async ({ page }) => {
  // 1. Product list: add the first product.
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  const firstProduct = page.locator('.card').first();
  const productName = (await firstProduct.locator('h3').innerText()).trim();
  await firstProduct.getByRole('button', { name: 'Add to cart' }).click();

  // 2. Cart: the line and the server-computed total.
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole('heading', { name: 'Cart' })).toBeVisible();
  await expect(page.getByRole('cell', { name: productName })).toBeVisible();

  // 3. Checkout: the order is created on the server before the card form.
  await page.getByRole('button', { name: 'Create order and continue to payment' }).click();
  await expect(page).toHaveURL(/\/checkout\/ORD[A-Z0-9]+$/);
  const orderId = /\/checkout\/(ORD[A-Z0-9]+)$/.exec(page.url())?.[1];
  expect(orderId).toBeTruthy();

  await page.getByLabel('Card holder name').fill('Demo Buyer');
  await page.getByLabel('Card number').fill('4242 4242 4242 4242');
  // Entering the BIN asks the provider for installment options.
  await expect(page.getByLabel('Installments')).toBeVisible();
  await page.getByLabel('Expiry month').fill('12');
  await page.getByLabel('Expiry year').fill('2035');
  await page.getByLabel('CVC').fill('123');
  await page.getByRole('button', { name: 'Pay with 3D Secure' }).click();

  // 4. The mock bank posts the callback; callbackRedirect lands on the order.
  await page.waitForURL(new RegExp(`/orders/${orderId}\\?payment=success`), {
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: `Order ${orderId}` })).toBeVisible();
  await expect(page.locator('.pill')).toHaveText('PAID');
  await expect(page.getByText('Payment confirmed by the provider.')).toBeVisible();

  // 5. Admin: the refund route is only reachable through the authorize hook.
  await page.goto('/admin');
  await page.getByLabel('Demo admin key').fill('demo-admin');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

  const row = page.getByRole('row', { name: new RegExp(orderId as string) });
  await row.getByRole('button', { name: 'Refund' }).click();
  // The refund.succeeded event writes REFUNDED; the row refreshes from the DB.
  await expect(row.locator('.pill')).toHaveText('REFUNDED');

  // 6. The order page shows the recorded refund.
  await row.getByRole('link', { name: orderId as string }).click();
  await expect(page.getByRole('heading', { name: `Order ${orderId}` })).toBeVisible();
  await expect(page.locator('.pill')).toHaveText('REFUNDED');
  await expect(page.getByRole('heading', { name: 'Refunds' })).toBeVisible();
});
