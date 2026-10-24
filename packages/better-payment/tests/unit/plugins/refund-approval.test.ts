import { describe, it, expect, vi } from 'vitest';
import { betterPayment, PaymentStatus, BetterPaymentError } from 'better-payment';
import { MockProvider } from 'better-payment/testing';
import { refundApproval } from 'better-payment/plugins';
import { mockPaymentRequest } from '../../fixtures/payment-data';

const testPayment = { ...mockPaymentRequest, price: '5000.00', paidPrice: '5000.00' };

describe('refundApproval plugin', () => {
  it('executes refunds below threshold directly without approval', async () => {
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      plugins: [
        refundApproval({
          threshold: 1000,
        }),
      ],
    });

    const init = await payment.createPayment(testPayment);
    expect(init.status).toBe(PaymentStatus.SUCCESS);

    // Refund of 500 TRY (<= 1000 threshold)
    const refundRes = await payment.refund({
      paymentId: init.paymentId!,
      price: '500.00',
      currency: 'TRY',
      ip: '127.0.0.1',
    });

    expect(refundRes.status).toBe(PaymentStatus.SUCCESS);
    const pendingList = await payment.refunds.list();
    expect(pendingList.length).toBe(0);
  });

  it('holds refunds above threshold in pending state and stores approval request', async () => {
    const mock = new MockProvider();
    const notifySpy = vi.fn();

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        refundApproval({
          threshold: 1000,
          notify: notifySpy,
        }),
      ],
    });

    const init = await payment.createPayment(testPayment);
    expect(init.status).toBe(PaymentStatus.SUCCESS);

    // Refund of 2500 TRY (> 1000 threshold)
    const refundRes = await payment.refund({
      paymentId: init.paymentId!,
      price: '2500.00',
      currency: 'TRY',
      ip: '127.0.0.1',
      requestedBy: 'agent-alice',
    } as any);

    expect(refundRes.status).toBe(PaymentStatus.PENDING);
    expect((refundRes as any).code).toBe('REFUND_APPROVAL_REQUIRED');
    expect((refundRes as any).approvalId).toBeDefined();

    expect(notifySpy).toHaveBeenCalledOnce();
    expect(notifySpy.mock.calls[0][0].amount).toBe(2500);

    const pendingList = await payment.refunds.list({ status: 'pending' });
    expect(pendingList.length).toBe(1);
    expect(pendingList[0].id).toBe((refundRes as any).approvalId);
    expect(pendingList[0].requestedBy).toBe('agent-alice');
  });

  it('approves and executes the refund on provider when authorized', async () => {
    const mock = new MockProvider();
    const refundSpy = vi.spyOn(mock, 'refund');

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        refundApproval({
          threshold: 1000,
          approvers: (user) => user?.role === 'finance',
        }),
      ],
    });

    const init = await payment.createPayment(testPayment);
    const refundRes = await payment.refund({
      paymentId: init.paymentId!,
      price: '1500.00',
      currency: 'TRY',
      ip: '127.0.0.1',
      requestedBy: 'agent-1',
    } as any);

    const approvalId = (refundRes as any).approvalId;

    // Approve as finance manager
    const approvedRes = await payment.refunds.approve(approvalId, {
      by: { id: 'mgr-finance', role: 'finance' },
    });

    expect(approvedRes.status).toBe(PaymentStatus.SUCCESS);
    expect(refundSpy).toHaveBeenCalledOnce();

    const item = await payment.refunds.get(approvalId);
    expect(item?.status).toBe('approved');
    expect(item?.approvedBy).toEqual({ id: 'mgr-finance', role: 'finance' });
  });

  it('drops the refund when rejected', async () => {
    const mock = new MockProvider();
    const refundSpy = vi.spyOn(mock, 'refund');

    const payment = betterPayment({
      providers: { mock },
      plugins: [
        refundApproval({
          threshold: 500,
        }),
      ],
    });

    const init = await payment.createPayment(testPayment);
    const refundRes = await payment.refund({
      paymentId: init.paymentId!,
      price: '800.00',
      currency: 'TRY',
      ip: '127.0.0.1',
    });

    const approvalId = (refundRes as any).approvalId;

    const rejected = await payment.refunds.reject(approvalId, {
      by: 'supervisor',
      reason: 'Customer did not return item',
    });

    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectionReason).toBe('Customer did not return item');
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('refuses self-approval by the requester', async () => {
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      plugins: [
        refundApproval({
          threshold: 1000,
        }),
      ],
    });

    const init = await payment.createPayment(testPayment);
    const refundRes = await payment.refund({
      paymentId: init.paymentId!,
      price: '2000.00',
      currency: 'TRY',
      ip: '127.0.0.1',
      requestedBy: 'agent-bob',
    } as any);

    const approvalId = (refundRes as any).approvalId;

    // Self-approval must fail
    await expect(
      payment.refunds.approve(approvalId, {
        by: 'agent-bob',
      })
    ).rejects.toThrow('Requester cannot approve their own refund request');
  });

  it('refuses approval by unauthorized users', async () => {
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      plugins: [
        refundApproval({
          threshold: 1000,
          approvers: (user) => user?.role === 'finance',
        }),
      ],
    });

    const init = await payment.createPayment(testPayment);
    const refundRes = await payment.refund({
      paymentId: init.paymentId!,
      price: '3000.00',
      currency: 'TRY',
      ip: '127.0.0.1',
      requestedBy: 'agent-charlie',
    } as any);

    const approvalId = (refundRes as any).approvalId;

    await expect(
      payment.refunds.approve(approvalId, {
        by: { id: 'support-1', role: 'support' },
      })
    ).rejects.toThrow('User is not authorized to approve refunds');
  });

  it('does not let a request body mark itself approved', async () => {
    const mock = new MockProvider();
    const refundSpy = vi.spyOn(mock, 'refund');
    const payment = betterPayment({
      providers: { mock },
      plugins: [refundApproval({ threshold: 1000 })],
    });

    const init = await payment.createPayment(testPayment);
    const refundRes = await payment.refund({
      paymentId: init.paymentId!,
      price: '2000.00',
      currency: 'TRY',
      ip: '127.0.0.1',
      __approved: true,
    } as any);

    expect((refundRes as any).code).toBe('REFUND_APPROVAL_REQUIRED');
    expect(refundSpy).not.toHaveBeenCalled();
  });

  it('holds amounts it cannot read strictly', async () => {
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      plugins: [refundApproval({ threshold: 1000 })],
    });

    const init = await payment.createPayment(testPayment);
    const refundRes = await payment.refund({
      paymentId: init.paymentId!,
      price: '1,500.00',
      currency: 'TRY',
      ip: '127.0.0.1',
    });

    expect((refundRes as any).code).toBe('REFUND_APPROVAL_REQUIRED');
  });

  it('holds cancellations unless cancelAmount puts them under the threshold', async () => {
    const mock = new MockProvider();
    const cancelSpy = vi.spyOn(mock, 'cancel');
    const amounts: Record<string, number> = {};
    const payment = betterPayment({
      providers: { mock },
      plugins: [
        refundApproval({
          threshold: 1000,
          cancelAmount: (request) => amounts[request.paymentId],
        }),
      ],
    });

    const small = await payment.createPayment(testPayment);
    amounts[small.paymentId!] = 200;
    const direct = await payment.cancel({ paymentId: small.paymentId!, ip: '127.0.0.1' });
    expect(direct.status).toBe(PaymentStatus.SUCCESS);
    expect(cancelSpy).toHaveBeenCalledOnce();

    const unknown = await payment.createPayment(testPayment);
    const held = await payment.cancel({ paymentId: unknown.paymentId!, ip: '127.0.0.1' });
    expect((held as any).code).toBe('REFUND_APPROVAL_REQUIRED');
    expect(cancelSpy).toHaveBeenCalledOnce();
  });

  it('holds every cancellation without cancelAmount', async () => {
    const mock = new MockProvider();
    const payment = betterPayment({
      providers: { mock },
      plugins: [refundApproval({ threshold: 1000 })],
    });

    const init = await payment.createPayment(testPayment);
    const held = await payment.cancel({
      paymentId: init.paymentId!,
      ip: '127.0.0.1',
      amount: 1,
    } as any);
    expect((held as any).code).toBe('REFUND_APPROVAL_REQUIRED');
  });

  it('refunds once when the same request is approved twice', async () => {
    const mock = new MockProvider();
    const refundSpy = vi.spyOn(mock, 'refund');
    const payment = betterPayment({
      providers: { mock },
      plugins: [refundApproval({ threshold: 1000 })],
    });

    const init = await payment.createPayment(testPayment);
    const refundRes = await payment.refund({
      paymentId: init.paymentId!,
      price: '2000.00',
      currency: 'TRY',
      ip: '127.0.0.1',
    });
    const approvalId = (refundRes as any).approvalId;

    const results = await Promise.allSettled([
      payment.refunds.approve(approvalId, { by: 'mgr-1' }),
      payment.refunds.approve(approvalId, { by: 'mgr-2' }),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(refundSpy).toHaveBeenCalledOnce();
  });

  describe('HTTP endpoints', () => {
    const create = (getActor?: (request: any) => any) => {
      const mock = new MockProvider();
      const refundSpy = vi.spyOn(mock, 'refund');
      const payment = betterPayment({
        providers: { mock },
        plugins: [
          refundApproval({
            threshold: 1000,
            approvers: (user: any) => user?.role === 'finance',
            getActor,
          }),
        ],
        handler: { basePath: '/api/pay', authorize: () => true },
      });
      return { payment, refundSpy };
    };

    const queue = async (payment: any) => {
      const init = await payment.createPayment(testPayment);
      const res = await payment.refund({
        paymentId: init.paymentId!,
        price: '2000.00',
        currency: 'TRY',
        ip: '127.0.0.1',
        requestedBy: 'agent-alice',
      } as any);
      return (res as any).approvalId as string;
    };

    const post = (payment: any, path: string, body: unknown, user?: string) =>
      payment.handler.handle({
        method: 'POST',
        url: `http://localhost/api/pay${path}`,
        headers: { 'content-type': 'application/json', ...(user ? { 'x-user': user } : {}) },
        body,
      });

    const users: Record<string, { id: string; role: string }> = {
      alice: { id: 'agent-alice', role: 'finance' },
      carol: { id: 'mgr-carol', role: 'finance' },
      dave: { id: 'support-dave', role: 'support' },
    };
    const actor = (request: any) => users[request.headers['x-user']];

    it('refuses to approve without a getActor option', async () => {
      const { payment, refundSpy } = create();
      const id = await queue(payment);

      const res = await post(payment, '/refunds/approve', {
        id,
        by: { id: 'mgr-carol', role: 'finance' },
      });

      expect(res.status).toBe(403);
      expect(refundSpy).not.toHaveBeenCalled();
    });

    it('ignores an approver named in the body', async () => {
      const { payment, refundSpy } = create(actor);
      const id = await queue(payment);

      const res = await post(
        payment,
        '/refunds/approve',
        { id, by: { id: 'mgr-carol', role: 'finance' } },
        'dave'
      );

      expect(res.status).toBe(403);
      expect(refundSpy).not.toHaveBeenCalled();
      expect((await payment.refunds.get(id))?.status).toBe('pending');
    });

    it('refuses self-approval by the signed-in requester', async () => {
      const { payment, refundSpy } = create(actor);
      const id = await queue(payment);

      const res = await post(payment, '/refunds/approve', { id, by: 'someone-else' }, 'alice');

      expect(res.status).toBe(403);
      expect(refundSpy).not.toHaveBeenCalled();
      expect((await payment.refunds.get(id))?.status).toBe('pending');
    });

    it('approves as the signed-in approver', async () => {
      const { payment, refundSpy } = create(actor);
      const id = await queue(payment);

      const res = await post(payment, '/refunds/approve', { id }, 'carol');

      expect(res.status).toBe(200);
      expect(refundSpy).toHaveBeenCalledOnce();
      expect((await payment.refunds.get(id))?.approvedBy).toEqual(users.carol);
    });
  });
});
