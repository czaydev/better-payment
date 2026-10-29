import {
  ConfigurationError,
  definePlugin,
  type BasketItem,
  type Buyer,
  type PaymentEvent,
  type PluginContext,
} from 'better-payment';
import { MemoryInvoicingStore } from './store';
import type { CreateInvoiceParams, InvoiceItem, InvoicingOptions, InvoicingRecord } from './types';

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function datePart(value?: string): string | undefined {
  return value?.slice(0, 10);
}

export const invoicing = (options: InvoicingOptions) => {
  if (!options?.adapter) {
    throw new ConfigurationError('invoicing: adapter is required');
  }

  const adapter = options.adapter;
  const attempts = options.retry?.attempts ?? 3;
  const delay = options.retry?.delay ?? 1000;
  const defaultVatRate = options.defaultVatRate ?? 20;
  const onRefund = options.onRefund ?? 'return-invoice';
  const store = options.store ?? new MemoryInvoicingStore();
  const issuanceMode = options.issuance?.mode ?? 'auto';
  const pollIntervalMs = options.issuance?.pollIntervalMs ?? 2000;
  const pollAttempts = options.issuance?.pollAttempts ?? 5;

  let pluginCtx: PluginContext | undefined;
  const issuanceInFlight = new Set<string>();
  const creationInFlight = new Set<string>();
  const refundInFlight = new Set<string>();

  async function executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let i = 1; i <= attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (i < attempts && delay > 0) {
          await sleep(delay);
        }
      }
    }
    throw lastError;
  }

  async function saveRecord(record: InvoicingRecord): Promise<void> {
    record.updatedAt = new Date();
    await store.set(record.paymentId, record);
  }

  async function loadRecord(paymentId: string): Promise<InvoicingRecord | undefined> {
    return await store.get(paymentId);
  }

  /**
   * The e-document step, separate from creating the sales invoice: submit the
   * invoice to the provider's e-Fatura / e-Arşiv issuance, then poll the job it
   * hands back. The record only becomes `issued` when the provider confirms it;
   * anything unconfirmed stays `pending` and remains retryable.
   */
  async function runIssuance(
    paymentId: string,
    event?: PaymentEvent<'payment.succeeded'>
  ): Promise<InvoicingRecord> {
    const record = await loadRecord(paymentId);
    if (!record) {
      throw new Error(`invoicing: no record found for paymentId '${paymentId}'`);
    }
    if (record.status === 'issued' || record.status === 'cancelled') {
      return record;
    }
    if (!record.invoiceId) {
      throw new Error(
        `invoicing: paymentId '${paymentId}' has no sales invoice to issue; retry invoice creation first`
      );
    }
    if (!adapter.issueInvoice) {
      throw new Error(`invoicing: adapter '${adapter.name}' does not support e-document issuance`);
    }
    const submitIssuance = adapter.issueInvoice.bind(adapter);
    if (issuanceInFlight.has(paymentId)) {
      return record;
    }
    issuanceInFlight.add(paymentId);

    try {
      if (!record.issuanceJobId) {
        // A single submission attempt on purpose: a repeated e-document POST is
        // exactly the request that could double-issue, so failures are surfaced
        // for an explicit `retry`/`issue` instead of silently re-sent.
        try {
          const issuance = await submitIssuance({
            invoiceId: record.invoiceId!,
            documentType: record.documentType ?? record.invoiceParams?.documentType,
            buyer: record.invoiceParams?.buyer ?? { name: 'Customer' },
            total: record.amount,
            currency: record.currency,
            conversationId: record.conversationId,
            paymentDate: datePart(record.invoiceParams?.issueDate),
            paymentPlatform: record.paymentPlatform,
          });
          record.documentType = issuance.documentType;
          record.issuanceJobId = issuance.jobId;
          if (issuance.status === 'issued') {
            record.status = 'issued';
            record.error = undefined;
            await saveRecord(record);
            if (options.onInvoiceIssued) {
              await options.onInvoiceIssued(record, event);
            }
            return record;
          }
          if (issuance.status === 'failed') {
            throw new Error(issuance.error ?? 'invoicing: issuance failed at the provider');
          }
          record.status = 'pending';
        } catch (err) {
          record.status = 'failed';
          record.error = errorMessage(err);
          await saveRecord(record);
          if (options.onInvoiceIssuanceFailed) {
            await options.onInvoiceIssuanceFailed(
              err instanceof Error ? err : new Error(record.error),
              record,
              event
            );
          }
          return record;
        }
        await saveRecord(record);
      }

      if (record.issuanceJobId && record.status === 'pending') {
        if (!adapter.checkIssuance) {
          pluginCtx?.logger?.info(
            `invoicing: provider has no issuance status check for payment ${paymentId}; the record stays pending until confirmed externally`
          );
          return record;
        }
        const checkJob = adapter.checkIssuance.bind(adapter);
        for (let i = 0; i < pollAttempts; i++) {
          await sleep(pollIntervalMs);
          const check = await checkJob(record.issuanceJobId);
          if (check.status === 'issued') {
            record.status = 'issued';
            record.error = undefined;
            await saveRecord(record);
            if (options.onInvoiceIssued) {
              await options.onInvoiceIssued(record, event);
            }
            return record;
          }
          if (check.status === 'failed') {
            record.status = 'failed';
            record.error = check.error ?? 'issuance job reported an error';
            await saveRecord(record);
            if (options.onInvoiceIssuanceFailed) {
              await options.onInvoiceIssuanceFailed(new Error(record.error), record, event);
            }
            return record;
          }
        }
        pluginCtx?.logger?.info(
          `invoicing: issuance for payment ${paymentId} is still pending after ${pollAttempts} checks`
        );
      }
      return record;
    } finally {
      issuanceInFlight.delete(paymentId);
    }
  }

  function kickIssuance(paymentId: string, event: PaymentEvent<'payment.succeeded'>): void {
    if (issuanceMode !== 'auto' || !adapter.issueInvoice) return;
    void runIssuance(paymentId, event).catch((err) => {
      pluginCtx?.logger?.error(
        `Invoicing issuance step failed for payment ${paymentId}`,
        err instanceof Error ? err : new Error(String(err))
      );
    });
  }

  async function handlePaymentSucceeded(event: PaymentEvent<'payment.succeeded'>) {
    const result = (event.result as Record<string, unknown>) || {};
    const paymentId =
      event.paymentId || (typeof result.paymentId === 'string' ? result.paymentId : undefined);
    const conversationId = event.conversationId;
    const keyedId = paymentId ?? conversationId;
    const req = (event.request as Record<string, unknown>) || {};
    const buyerRaw = (req.buyer as Record<string, unknown>) || {};
    const basketItemsRaw = (req.basketItems as Array<Record<string, unknown>>) || [];
    const rawAmount = event.amount ?? req.paidPrice ?? req.price;
    const amount =
      rawAmount !== undefined && rawAmount !== null && String(rawAmount) !== ''
        ? String(rawAmount)
        : undefined;
    const currency = event.currency || String(req.currency || 'TRY');

    if (!keyedId) {
      const error = new Error(
        'invoicing: payment.succeeded event carries neither paymentId nor conversationId; refusing to invent an invoice key'
      );
      pluginCtx?.logger?.error('Invoicing failed', error);
      if (options.onInvoiceFailed) {
        await options.onInvoiceFailed(error, event);
      }
      return;
    }

    const previous = await loadRecord(keyedId);
    if (previous?.invoiceId || creationInFlight.has(keyedId)) {
      // Gateways redeliver `payment.succeeded`, and the delivery that already
      // created the invoice can still be in flight. A second POST would be a
      // second sales invoice for the same payment, so it is dropped here.
      pluginCtx?.logger?.debug('invoicing: payment already invoiced, ignoring redelivery', {
        paymentId: keyedId,
      });
      return;
    }

    if (!amount) {
      const error = new Error(
        `invoicing: cannot invoice payment '${keyedId}': the event carries no amount`
      );
      const record: InvoicingRecord = {
        paymentId: keyedId,
        conversationId,
        status: 'failed',
        currency,
        error: error.message,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await saveRecord(record);
      pluginCtx?.logger?.error(error.message, error);
      if (options.onInvoiceFailed) {
        await options.onInvoiceFailed(error, event);
      }
      return;
    }

    const mapped = options.map
      ? await options.map({
          buyer: req.buyer as Buyer | undefined,
          basketItems: req.basketItems as BasketItem[] | undefined,
          amount,
          currency,
          paymentId: keyedId,
          conversationId,
          event,
        })
      : {};

    const items: InvoiceItem[] =
      mapped.items ||
      (basketItemsRaw.length > 0
        ? basketItemsRaw.map((b) => ({
            name: String(b.name || 'Product'),
            quantity: 1,
            unitPrice: b.price !== undefined ? String(b.price) : amount,
            vatRate: mapped.vatRate ?? defaultVatRate,
          }))
        : [
            {
              name: mapped.description || 'Payment',
              quantity: 1,
              unitPrice: amount,
              vatRate: mapped.vatRate ?? defaultVatRate,
            },
          ]);

    const params: CreateInvoiceParams = {
      paymentId: keyedId,
      conversationId,
      buyer: {
        name:
          mapped.buyer?.name ||
          `${buyerRaw.name || ''} ${buyerRaw.surname || ''}`.trim() ||
          'Valued Customer',
        contactId: mapped.buyer?.contactId,
        taxNumber: mapped.buyer?.taxNumber || String(buyerRaw.identityNumber || ''),
        taxOffice: mapped.buyer?.taxOffice,
        email: mapped.buyer?.email || String(buyerRaw.email || ''),
        phone: mapped.buyer?.phone || String(buyerRaw.gsmNumber || ''),
        address: mapped.buyer?.address || String(buyerRaw.registrationAddress || ''),
        city: mapped.buyer?.city || String(buyerRaw.city || ''),
        country: mapped.buyer?.country || String(buyerRaw.country || 'Turkey'),
      },
      items,
      total: amount,
      currency,
      vatRate: mapped.vatRate ?? defaultVatRate,
      documentType: mapped.documentType,
    };

    try {
      creationInFlight.add(keyedId);
      const invoice = await executeWithRetry(() => adapter.createInvoice(params));
      if (!invoice.id) {
        throw new Error(
          `invoicing: adapter '${adapter.name}' returned an invoice without an id; refusing to record it`
        );
      }
      const record: InvoicingRecord = {
        paymentId: keyedId,
        conversationId,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        pdfUrl: invoice.pdfUrl,
        documentType: params.documentType,
        status: 'created',
        amount,
        currency,
        invoiceParams: params,
        paymentPlatform: event.provider,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await saveRecord(record);
      if (options.onInvoiceCreated) {
        await options.onInvoiceCreated(invoice, event);
      }
      kickIssuance(keyedId, event);
    } catch (err) {
      const errorMsg = errorMessage(err);
      pluginCtx?.logger?.error(
        `Invoicing failed for payment ${keyedId}`,
        err instanceof Error ? err : new Error(errorMsg)
      );
      const record: InvoicingRecord = {
        paymentId: keyedId,
        conversationId,
        status: 'failed',
        amount,
        currency,
        error: errorMsg,
        invoiceParams: params,
        paymentPlatform: event.provider,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await saveRecord(record);
      if (options.onInvoiceFailed) {
        await options.onInvoiceFailed(err instanceof Error ? err : new Error(errorMsg), event);
      }
    } finally {
      creationInFlight.delete(keyedId);
    }
  }

  async function handleRefundSucceeded(event: PaymentEvent<'refund.succeeded'>) {
    if (onRefund === 'none') return;

    const result = (event.result as Record<string, unknown>) || {};
    const paymentId =
      event.paymentId || (typeof result.paymentId === 'string' ? result.paymentId : undefined);
    if (!paymentId) return;

    const record = await loadRecord(paymentId);
    if (!record || !record.invoiceId) return;
    if (record.status === 'cancelled' || record.returnInvoiceId || refundInFlight.has(paymentId)) {
      // Same rule as the sales invoice: the stored record is what proves the
      // refund document already exists, because the provider cannot dedupe it.
      return;
    }
    const req = (event.request as Record<string, unknown>) || {};
    const refundAmount = String(
      event.amount ?? req.refundPrice ?? req.price ?? record.amount ?? ''
    );
    if (!refundAmount) return;

    const snapshot = record.invoiceParams;
    const returnParams: CreateInvoiceParams = snapshot
      ? { ...snapshot, total: refundAmount }
      : {
          paymentId,
          conversationId: record.conversationId,
          buyer: { name: 'Customer' },
          items: [
            {
              name: 'Refund Return',
              quantity: 1,
              unitPrice: refundAmount,
              vatRate: defaultVatRate,
            },
          ],
          total: refundAmount,
          currency: record.currency,
        };

    try {
      refundInFlight.add(paymentId);
      if (onRefund === 'cancel' && adapter.cancelInvoice) {
        await executeWithRetry(() => adapter.cancelInvoice!(record.invoiceId!));
        record.status = 'cancelled';
        await saveRecord(record);
      } else if (onRefund === 'return-invoice' && adapter.createReturnInvoice) {
        const returnInvoice = await executeWithRetry(() =>
          adapter.createReturnInvoice!(record.invoiceId!, returnParams)
        );
        if (returnInvoice.id) record.returnInvoiceId = returnInvoice.id;
        await saveRecord(record);
      }
    } catch (err) {
      pluginCtx?.logger?.error(
        `Refund invoicing action failed for payment ${paymentId}`,
        err instanceof Error ? err : new Error(errorMessage(err))
      );
    } finally {
      refundInFlight.delete(paymentId);
    }
  }

  return definePlugin({
    id: 'invoicing',
    options,
    init: (ctx) => {
      pluginCtx = ctx;
    },
    events: {
      'payment.succeeded': (event) => handlePaymentSucceeded(event),
      'refund.succeeded': (event) => handleRefundSucceeded(event),
    },
    methods: () => ({
      invoicing: {
        get: async (paymentId: string): Promise<InvoicingRecord | undefined> =>
          await loadRecord(paymentId),
        list: async (): Promise<InvoicingRecord[]> => await store.list(),
        getFailed: async (): Promise<InvoicingRecord[]> =>
          (await store.list()).filter((r) => r.status === 'failed'),
        /** Re-runs a failed creation, then the issuance step, from the saved snapshot */
        retry: async (paymentId: string): Promise<InvoicingRecord> => {
          const record = await loadRecord(paymentId);
          if (!record) {
            throw new Error(`invoicing: no record found for paymentId '${paymentId}'`);
          }
          if (record.status === 'issued' || record.status === 'cancelled') {
            return record;
          }
          if (!record.invoiceId) {
            if (!record.invoiceParams) {
              throw new Error(
                `invoicing: paymentId '${paymentId}' has no saved invoice data to retry from`
              );
            }
            const invoice = await executeWithRetry(() =>
              adapter.createInvoice(record.invoiceParams!)
            );
            if (!invoice.id) {
              throw new Error(
                `invoicing: adapter '${adapter.name}' returned an invoice without an id; refusing to record it`
              );
            }
            record.invoiceId = invoice.id;
            record.invoiceNumber = invoice.invoiceNumber;
            record.pdfUrl = invoice.pdfUrl;
            record.status = 'created';
            record.error = undefined;
            await saveRecord(record);
          }
          if (issuanceMode !== 'none' && adapter.issueInvoice) {
            return await runIssuance(paymentId);
          }
          return record;
        },
        /** Explicit issuance: run the e-document step and wait for its outcome */
        issue: async (paymentId: string): Promise<InvoicingRecord> => {
          if (!adapter.issueInvoice) {
            throw new Error(
              `invoicing: adapter '${adapter.name}' does not support e-document issuance`
            );
          }
          return await runIssuance(paymentId);
        },
        cancel: async (paymentId: string, reason?: string): Promise<void> => {
          const record = await loadRecord(paymentId);
          if (!record || !record.invoiceId) {
            throw new Error(`invoicing: no invoice found to cancel for paymentId '${paymentId}'`);
          }
          if (!adapter.cancelInvoice) {
            throw new Error(`invoicing: adapter '${adapter.name}' does not support cancelInvoice`);
          }
          await executeWithRetry(() => adapter.cancelInvoice!(record.invoiceId!, reason));
          record.status = 'cancelled';
          await saveRecord(record);
        },
      },
    }),
  });
};
