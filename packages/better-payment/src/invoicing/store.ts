import type { InvoicingRecord, InvoicingStore } from './types';

/**
 * In-process record store. The default: it is per-process and forgets every
 * document on restart, which breaks idempotency for legally relevant e-Fatura /
 * e-Arşiv documents. Development and tests only — production must pass a
 * persistent `InvoicingStore` (Redis, SQL, KV) to the plugin.
 */
export class MemoryInvoicingStore implements InvoicingStore {
  private readonly records = new Map<string, InvoicingRecord>();

  get(paymentId: string): InvoicingRecord | undefined {
    const record = this.records.get(paymentId);
    return record ? { ...record } : undefined;
  }

  set(paymentId: string, record: InvoicingRecord): void {
    this.records.set(paymentId, { ...record });
  }

  list(): InvoicingRecord[] {
    return [...this.records.values()].map((record) => ({ ...record }));
  }

  delete(paymentId: string): void {
    this.records.delete(paymentId);
  }
}
