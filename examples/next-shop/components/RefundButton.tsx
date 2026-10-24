'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PAYMENT_API_BASE } from '@/lib/constants';

interface RefundButtonProps {
  orderId: string;
  providerId: 'mock' | 'iyzico';
}

/**
 * Calls the privileged handler route `POST /api/pay/<provider>/refund`.
 * The route only runs when the handler's `authorize` hook accepts the request
 * (the demo admin cookie here), and the refund amount is rebuilt from the
 * order row by `transformRequest` — this fetch sends the order id and nothing
 * else.
 */
export function RefundButton({ orderId, providerId }: RefundButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function refund(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`${PAYMENT_API_BASE}/${providerId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId }),
      });
      const json = (await res.json()) as { status?: string; errorMessage?: string };
      if (json.status === 'success') {
        // The refund.succeeded event has already written REFUNDED to the order;
        // refresh re-renders the server component from the database.
        router.refresh();
        setMessage('Refunded.');
      } else {
        // errorMessage is localized by the localizedErrors plugin
        setMessage(json.errorMessage ?? `Refund failed (${res.status})`);
      }
    } catch {
      setMessage('Could not reach the payment server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
      <button type="button" onClick={() => void refund()} disabled={busy}>
        {busy ? 'Refunding…' : 'Refund'}
      </button>
      {message ? <span className="muted">{message}</span> : null}
    </span>
  );
}
