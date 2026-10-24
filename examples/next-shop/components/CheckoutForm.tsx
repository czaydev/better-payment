'use client';

import { useState } from 'react';
import { PAYMENT_API_BASE } from '@/lib/constants';

interface InstallmentPrice {
  installmentNumber: number;
  totalPrice: number;
  installmentPrice: number;
  commissionRate: number;
}

interface CheckoutFormProps {
  orderId: string;
  providerId: 'mock' | 'iyzico';
  totalLabel: string;
}

/**
 * Sends the card and the order id to the payment handler. The amount is NOT
 * part of this request: `transformRequest` rebuilds the full payment request
 * from the database on the server (see lib/payment.ts).
 */
export function CheckoutForm({ orderId, providerId, totalLabel }: CheckoutFormProps) {
  const [cardHolderName, setCardHolderName] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [expireMonth, setExpireMonth] = useState('');
  const [expireYear, setExpireYear] = useState('');
  const [cvc, setCvc] = useState('');
  const [installments, setInstallments] = useState<InstallmentPrice[] | null>(null);
  const [installment, setInstallment] = useState('1');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const digits = cardNumber.replace(/\D/g, '');

  async function onCardChange(next: string): Promise<void> {
    setCardNumber(next);
    const bin = next.replace(/\D/g, '').slice(0, 6);
    if (bin.length !== 6) return;
    // Ask the provider for this BIN's installment options. `installment` is a
    // read-only handler action; the price queried is the order total, resolved
    // server-side by transformRequest, never taken from this fetch body.
    try {
      const res = await fetch(`${PAYMENT_API_BASE}/${providerId}/installment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, binNumber: bin }),
      });
      const json = (await res.json()) as {
        installmentDetails?: Array<{ installmentPrices?: InstallmentPrice[] }>;
      };
      const prices = json.installmentDetails?.[0]?.installmentPrices;
      setInstallments(Array.isArray(prices) && prices.length > 1 ? prices : null);
    } catch {
      setInstallments(null);
    }
  }

  async function onInstallmentChange(value: string): Promise<void> {
    setInstallment(value);
    // Persist the choice on the order row; the payment itself reads it from the
    // database in transformRequest, so this call is what makes it take effect.
    await fetch('/api/orders/installment', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId, installment: Number(value) }),
    });
  }

  async function onSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${PAYMENT_API_BASE}/${providerId}/payment/init-3ds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          paymentCard: {
            cardHolderName,
            cardNumber: digits,
            expireMonth,
            expireYear,
            cvc,
          },
        }),
      });
      const json = (await res.json()) as {
        status?: string;
        threeDSHtmlContent?: string;
        redirectUrl?: string;
        conversationId?: string;
        errorMessage?: string;
        code?: string;
      };

      if (!res.ok) {
        setError(json.errorMessage ?? `The payment server rejected the request (${res.status})`);
        setSubmitting(false);
        return;
      }

      if (json.status === 'pending' && json.threeDSHtmlContent) {
        // The mock bank's page auto-submits the signed 3DS result to
        // /api/pay/mock/payment/complete-3ds. The handler verifies it, the
        // payment.succeeded/payment.failed event updates the order and
        // callbackRedirect sends the browser to /orders/<id>.
        document.open();
        document.write(json.threeDSHtmlContent);
        document.close();
        return;
      }
      if (json.status === 'pending' && json.redirectUrl) {
        window.location.assign(json.redirectUrl);
        return;
      }
      if (json.status === 'success') {
        window.location.assign(`/orders/${orderId}?payment=success`);
        return;
      }
      // status === 'failure': errorMessage is localized by the localizedErrors
      // plugin from the browser's Accept-Language header.
      setError(json.errorMessage ?? `Payment failed (${json.code ?? 'UNKNOWN'})`);
      setSubmitting(false);
    } catch {
      setError('Could not reach the payment server.');
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <fieldset>
        <legend>Card · {totalLabel}</legend>

        <label>
          Card holder name
          <input
            value={cardHolderName}
            onChange={(e) => setCardHolderName(e.target.value)}
            required
          />
        </label>
        <label>
          Card number
          <input
            value={cardNumber}
            onChange={(e) => void onCardChange(e.target.value)}
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="4242 4242 4242 4242"
            required
          />
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1 }}>
            Expiry month
            <input
              value={expireMonth}
              onChange={(e) => setExpireMonth(e.target.value)}
              inputMode="numeric"
              autoComplete="cc-exp-month"
              placeholder="12"
              maxLength={2}
              required
            />
          </label>
          <label style={{ flex: 1 }}>
            Expiry year
            <input
              value={expireYear}
              onChange={(e) => setExpireYear(e.target.value)}
              inputMode="numeric"
              autoComplete="cc-exp-year"
              placeholder="2035"
              maxLength={4}
              required
            />
          </label>
          <label style={{ flex: 1 }}>
            CVC
            <input
              value={cvc}
              onChange={(e) => setCvc(e.target.value)}
              inputMode="numeric"
              autoComplete="cc-csc"
              placeholder="123"
              maxLength={4}
              required
            />
          </label>
        </div>

        {installments ? (
          <label>
            Installments
            <select value={installment} onChange={(e) => void onInstallmentChange(e.target.value)}>
              {installments.map((option) => (
                <option key={option.installmentNumber} value={String(option.installmentNumber)}>
                  {option.installmentNumber}x · {option.installmentPrice.toFixed(2)} per month
                  (total {option.totalPrice.toFixed(2)}, commission {option.commissionRate}%)
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted">Enter the first 6 digits of the card to see installment options.</p>
        )}

        {error ? <p className="error">{error}</p> : null}

        <button type="submit" disabled={submitting}>
          {submitting ? 'Redirecting to the bank…' : 'Pay with 3D Secure'}
        </button>
      </fieldset>
    </form>
  );
}
