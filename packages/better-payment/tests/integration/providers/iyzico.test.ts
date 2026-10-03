import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Iyzico } from '../../../src/providers/iyzico';
import {
  mockPaymentRequest,
  mockThreeDSPaymentRequest,
  mockRefundRequest,
} from '../../fixtures/payment-data';
import {
  mockSubscriptionInitializeRequest,
  mockSubscriptionCancelRequest,
  mockSubscriptionUpgradeRequest,
  mockSubscriptionRetrieveRequest,
  mockSubscriptionCardUpdateRequest,
  mockSubscriptionProductRequest,
  mockPricingPlanRequest,
} from '../../fixtures/subscription-data';

/**
 * REAL Integration Tests for Iyzico Provider
 *
 * These tests verify that Iyzico sends CORRECT request format:
 * - HTTP method and endpoint
 * - Request headers (Authorization, Content-Type)
 * - Request body structure and data mapping
 * - Signature calculation
 *
 * We spy on the actual HTTP client to capture real requests
 */

describe('Iyzico Provider - Integration Tests', () => {
  let iyzico: Iyzico;
  let capturedRequests: any[] = [];

  beforeEach(() => {
    capturedRequests = [];

    iyzico = new Iyzico({
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key',
      baseUrl: 'https://sandbox-api.iyzipay.com',
      locale: 'tr',
    });

    // Spy on the internal HTTP client's request method
    const client = (iyzico as any).client;
    vi.spyOn(client, 'request').mockImplementation(async (...args: unknown[]) => {
      const [config] = args as [any];
      const url: string = config.url;
      const data = config.data ?? '{}';

      // Capture the request
      capturedRequests.push({
        url,
        data: typeof data === 'string' ? JSON.parse(data) : data,
        headers: config?.headers || {},
        rawData: data,
      });

      // Return mock response based on endpoint
      if (url.includes('/subscription/products')) {
        return {
          data: {
            status: 'success',
            data: {
              referenceCode: 'product-ref-123',
              name: 'Test Product',
              createdDate: Date.now(),
            },
          },
          status: 200,
        };
      } else if (url.includes('/pricing-plans')) {
        return {
          data: {
            status: 'success',
            data: {
              referenceCode: 'plan-ref-123',
              productReferenceCode: 'product-ref-123',
              name: 'Monthly Plan',
              price: 99.9,
              currency: 'TRY',
              paymentInterval: 'MONTHLY',
              paymentIntervalCount: 1,
              createdDate: Date.now(),
            },
          },
          status: 200,
        };
      } else if (url.includes('/subscription/initialize')) {
        return {
          data: {
            status: 'success',
            data: {
              referenceCode: 'subscription-ref-123',
              pricingPlanReferenceCode: 'plan-ref-123',
              customerReferenceCode: 'customer-ref-123',
              subscriptionStatus: 'ACTIVE',
              createdDate: Date.now(),
              startDate: Date.now(),
            },
          },
          status: 200,
        };
      } else if (url.includes('/cancel')) {
        return {
          data: {
            status: 'success',
            data: {
              referenceCode: 'subscription-ref-123',
              subscriptionStatus: 'CANCELED',
            },
          },
          status: 200,
        };
      } else if (url.includes('/upgrade')) {
        return {
          data: {
            status: 'success',
            data: {
              referenceCode: 'subscription-ref-123',
              pricingPlanReferenceCode: 'new-plan-ref-123',
              subscriptionStatus: 'ACTIVE',
            },
          },
          status: 200,
        };
      } else if (url.includes('/card-update')) {
        return {
          data: {
            status: 'success',
            token: 'card-update-token-123',
            paymentPageUrl: 'https://sandbox-api.iyzipay.com/card-update/test-token',
          },
          status: 200,
        };
      } else if (url.includes('/subscription/subscriptions/')) {
        return {
          data: {
            status: 'success',
            data: {
              referenceCode: 'subscription-ref-123',
              pricingPlanReferenceCode: 'plan-ref-123',
              pricingPlanName: 'Monthly Plan',
              customerReferenceCode: 'customer-ref-123',
              subscriptionStatus: 'ACTIVE',
              createdDate: Date.now(),
              startDate: Date.now(),
            },
          },
          status: 200,
        };
      }

      // Default payment response
      return {
        data: {
          status: 'success',
          paymentId: 'test-payment-id',
          conversationId: 'test-conversation-id',
        },
        status: 200,
        statusText: 'OK',
        headers: {},
        config: {},
      };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Request Format Validation', () => {
    it('should send payment request with correct Iyzico format', async () => {
      await iyzico.createPayment(mockPaymentRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe('/payment/auth');

      // Verify content type
      expect(request.headers['Content-Type']).toBe('application/json');

      // Verify body structure
      expect(request.data).toHaveProperty('locale', 'tr');
      expect(request.data).toHaveProperty('conversationId', mockPaymentRequest.conversationId);
      expect(request.data).toHaveProperty('price', mockPaymentRequest.price);
      expect(request.data).toHaveProperty('paidPrice', mockPaymentRequest.paidPrice);
      expect(request.data).toHaveProperty('currency', mockPaymentRequest.currency);
      expect(request.data).toHaveProperty('basketId', mockPaymentRequest.basketId);
      expect(request.data).toHaveProperty('paymentChannel', 'WEB');
      expect(request.data).toHaveProperty('paymentGroup', 'PRODUCT');
    });

    it('should include correct authorization header with signature', async () => {
      await iyzico.createPayment(mockPaymentRequest);

      const request = capturedRequests[0];

      // Authorization header should exist and start with IYZWSv2
      expect(request.headers.Authorization).toBeDefined();
      expect(request.headers.Authorization).toMatch(/^IYZWSv2 /);

      // Random header should exist
      expect(request.headers['x-iyzi-rnd']).toBeDefined();
      expect(typeof request.headers['x-iyzi-rnd']).toBe('string');
    });

    it('should calculate authorization signature correctly', async () => {
      await iyzico.createPayment(mockPaymentRequest);

      const request = capturedRequests[0];
      const authHeader = request.headers.Authorization;

      // Should start with IYZWSv2
      expect(authHeader).toMatch(/^IYZWSv2 /);

      // Should have a base64 encoded token
      const [prefix, token] = authHeader.split(' ');
      expect(prefix).toBe('IYZWSv2');
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);

      // Token should be base64
      expect(token).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('should send 3DS init request with callback URL', async () => {
      await iyzico.initThreeDSPayment(mockThreeDSPaymentRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe('/payment/3dsecure/initialize');

      // Should have callback URL
      expect(request.data).toHaveProperty('callbackUrl', mockThreeDSPaymentRequest.callbackUrl);
    });

    it('should refund the payment by paymentId with the v2 endpoint', async () => {
      await iyzico.refund(mockRefundRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      expect(request.url).toBe('/v2/payment/refund');
      expect(request.data).toHaveProperty('paymentId', mockRefundRequest.paymentId);
      expect(request.data).not.toHaveProperty('paymentTransactionId');
      expect(request.data).toHaveProperty('price', mockRefundRequest.price);
      expect(request.data).toHaveProperty('currency', mockRefundRequest.currency);
      expect(request.data).toHaveProperty('ip', mockRefundRequest.ip);
    });

    it('should refund a basket item by paymentTransactionId', async () => {
      await iyzico.refund({ ...mockRefundRequest, paymentTransactionId: '987654' });

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      expect(request.url).toBe('/payment/refund');
      expect(request.data).toHaveProperty('paymentTransactionId', '987654');
      expect(request.data).not.toHaveProperty('paymentId');
      expect(request.data).toHaveProperty('price', mockRefundRequest.price);
    });
  });

  describe('Request Transformation', () => {
    it('should transform payment card data correctly', async () => {
      await iyzico.createPayment(mockPaymentRequest);

      const request = capturedRequests[0];
      const { paymentCard } = request.data;

      expect(paymentCard.cardHolderName).toBe(mockPaymentRequest.paymentCard.cardHolderName);
      expect(paymentCard.cardNumber).toBe(mockPaymentRequest.paymentCard.cardNumber);
      expect(paymentCard.expireMonth).toBe(mockPaymentRequest.paymentCard.expireMonth);
      expect(paymentCard.expireYear).toBe(mockPaymentRequest.paymentCard.expireYear);
      expect(paymentCard.cvc).toBe(mockPaymentRequest.paymentCard.cvc);
    });

    it('should transform buyer data correctly', async () => {
      await iyzico.createPayment(mockPaymentRequest);

      const request = capturedRequests[0];
      const { buyer } = request.data;

      expect(buyer.id).toBe(mockPaymentRequest.buyer.id);
      expect(buyer.name).toBe(mockPaymentRequest.buyer.name);
      expect(buyer.surname).toBe(mockPaymentRequest.buyer.surname);
      expect(buyer.email).toBe(mockPaymentRequest.buyer.email);
      expect(buyer.gsmNumber).toBe(mockPaymentRequest.buyer.gsmNumber);
      expect(buyer.ip).toBe(mockPaymentRequest.buyer.ip);
    });

    it('should transform basket items correctly', async () => {
      await iyzico.createPayment(mockPaymentRequest);

      const request = capturedRequests[0];
      const { basketItems } = request.data;

      expect(basketItems).toHaveLength(mockPaymentRequest.basketItems.length);

      basketItems.forEach((item: any, index: number) => {
        const originalItem = mockPaymentRequest.basketItems[index];
        expect(item.id).toBe(originalItem.id);
        expect(item.name).toBe(originalItem.name);
        expect(item.category1).toBe(originalItem.category1);
        expect(item.price).toBe(originalItem.price);
      });
    });
  });

  describe('Endpoint Validation', () => {
    it('should use correct endpoint for direct payment', async () => {
      await iyzico.createPayment(mockPaymentRequest);
      expect(capturedRequests[0].url).toBe('/payment/auth');
    });

    it('should use correct endpoint for 3DS init', async () => {
      await iyzico.initThreeDSPayment(mockThreeDSPaymentRequest);
      expect(capturedRequests[0].url).toBe('/payment/3dsecure/initialize');
    });

    it('should use correct endpoint for refund', async () => {
      await iyzico.refund(mockRefundRequest);
      expect(capturedRequests[0].url).toBe('/v2/payment/refund');
    });
  });

  describe('Subscription Product Management', () => {
    it('should create subscription product with correct format', async () => {
      await iyzico.createSubscriptionProduct(mockSubscriptionProductRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe('/v2/subscription/products');

      // Verify request body
      expect(request.data).toHaveProperty('locale', 'tr');
      expect(request.data).toHaveProperty(
        'conversationId',
        mockSubscriptionProductRequest.conversationId
      );
      expect(request.data).toHaveProperty('name', mockSubscriptionProductRequest.name);
      expect(request.data).toHaveProperty(
        'description',
        mockSubscriptionProductRequest.description
      );
    });

    it('should create pricing plan with correct format', async () => {
      await iyzico.createPricingPlan(mockPricingPlanRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe(
        `/v2/subscription/products/${mockPricingPlanRequest.productReferenceCode}/pricing-plans`
      );

      // Verify request body
      expect(request.data).toHaveProperty(
        'productReferenceCode',
        mockPricingPlanRequest.productReferenceCode
      );
      expect(request.data).toHaveProperty('name', mockPricingPlanRequest.name);
      expect(request.data).toHaveProperty('price', mockPricingPlanRequest.price);
      expect(request.data).toHaveProperty('currency', mockPricingPlanRequest.currency);
      expect(request.data).toHaveProperty(
        'paymentInterval',
        mockPricingPlanRequest.paymentInterval
      );
      expect(request.data).toHaveProperty(
        'paymentIntervalCount',
        mockPricingPlanRequest.paymentIntervalCount
      );
      expect(request.data).toHaveProperty(
        'trialPeriodDays',
        mockPricingPlanRequest.trialPeriodDays
      );
      expect(request.data).toHaveProperty(
        'recurrenceCount',
        mockPricingPlanRequest.recurrenceCount
      );
    });
  });

  describe('Subscription Initialization', () => {
    it('should initialize subscription with correct format', async () => {
      await iyzico.initializeSubscription(mockSubscriptionInitializeRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe('/v2/subscription/initialize');

      // Verify request body
      expect(request.data).toHaveProperty('locale', 'tr');
      expect(request.data).toHaveProperty(
        'pricingPlanReferenceCode',
        mockSubscriptionInitializeRequest.pricingPlanReferenceCode
      );
      expect(request.data).toHaveProperty(
        'subscriptionInitialStatus',
        mockSubscriptionInitializeRequest.subscriptionInitialStatus
      );

      // Verify customer data
      expect(request.data).toHaveProperty('customer');
      expect(request.data.customer).toHaveProperty(
        'name',
        mockSubscriptionInitializeRequest.customer.name
      );
      expect(request.data.customer).toHaveProperty(
        'surname',
        mockSubscriptionInitializeRequest.customer.surname
      );
      expect(request.data.customer).toHaveProperty(
        'email',
        mockSubscriptionInitializeRequest.customer.email
      );
      expect(request.data.customer).toHaveProperty(
        'gsmNumber',
        mockSubscriptionInitializeRequest.customer.gsmNumber
      );
      expect(request.data.customer).toHaveProperty(
        'identityNumber',
        mockSubscriptionInitializeRequest.customer.identityNumber
      );

      // Verify billing address
      expect(request.data.customer).toHaveProperty('billingAddress');
      expect(request.data.customer.billingAddress).toHaveProperty('contactName');
      expect(request.data.customer.billingAddress).toHaveProperty('city');
      expect(request.data.customer.billingAddress).toHaveProperty('country');
      expect(request.data.customer.billingAddress).toHaveProperty('address');

      // Verify payment card
      expect(request.data).toHaveProperty('paymentCard');
      expect(request.data.paymentCard).toHaveProperty(
        'cardHolderName',
        mockSubscriptionInitializeRequest.paymentCard.cardHolderName
      );
      expect(request.data.paymentCard).toHaveProperty(
        'cardNumber',
        mockSubscriptionInitializeRequest.paymentCard.cardNumber
      );
      expect(request.data.paymentCard).toHaveProperty(
        'expireMonth',
        mockSubscriptionInitializeRequest.paymentCard.expireMonth
      );
      expect(request.data.paymentCard).toHaveProperty(
        'expireYear',
        mockSubscriptionInitializeRequest.paymentCard.expireYear
      );
      expect(request.data.paymentCard).toHaveProperty(
        'cvc',
        mockSubscriptionInitializeRequest.paymentCard.cvc
      );
    });
  });

  describe('Subscription Management', () => {
    it('should cancel subscription with correct endpoint', async () => {
      await iyzico.cancelSubscription(mockSubscriptionCancelRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint includes subscription reference code
      expect(request.url).toBe(
        `/v2/subscription/subscriptions/${mockSubscriptionCancelRequest.subscriptionReferenceCode}/cancel`
      );
    });

    it('should upgrade subscription with correct format', async () => {
      await iyzico.upgradeSubscription(mockSubscriptionUpgradeRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe(
        `/v2/subscription/subscriptions/${mockSubscriptionUpgradeRequest.subscriptionReferenceCode}/upgrade`
      );

      // Verify request body
      expect(request.data).toHaveProperty(
        'newPricingPlanReferenceCode',
        mockSubscriptionUpgradeRequest.newPricingPlanReferenceCode
      );
      expect(request.data).toHaveProperty('useTrial', mockSubscriptionUpgradeRequest.useTrial);
      expect(request.data).toHaveProperty(
        'resetRecurrenceCount',
        mockSubscriptionUpgradeRequest.resetRecurrenceCount
      );
    });

    it('should retrieve subscription with correct endpoint', async () => {
      await iyzico.retrieveSubscription(mockSubscriptionRetrieveRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe(
        `/v2/subscription/subscriptions/${mockSubscriptionRetrieveRequest.subscriptionReferenceCode}`
      );
    });

    it('should update subscription card with correct format', async () => {
      await iyzico.updateSubscriptionCard(mockSubscriptionCardUpdateRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe('/v2/subscription/card-update/checkoutform/initialize');

      // Verify request body
      expect(request.data).toHaveProperty('locale', 'tr');
      expect(request.data).toHaveProperty(
        'subscriptionReferenceCode',
        mockSubscriptionCardUpdateRequest.subscriptionReferenceCode
      );
      expect(request.data).toHaveProperty(
        'callbackUrl',
        mockSubscriptionCardUpdateRequest.callbackUrl
      );
      expect(request.data).toHaveProperty(
        'conversationId',
        mockSubscriptionCardUpdateRequest.conversationId
      );
    });
  });

  describe('Subscription Authorization', () => {
    it('should include IYZWSv2 authorization in subscription requests', async () => {
      await iyzico.initializeSubscription(mockSubscriptionInitializeRequest);

      const request = capturedRequests[0];

      // Should have IYZWSv2 authorization
      expect(request.headers.Authorization).toBeDefined();
      expect(request.headers.Authorization).toMatch(/^IYZWSv2 /);
    });
  });

  describe('BIN Check', () => {
    it('should send correct BIN check request', async () => {
      await iyzico.binCheck('454360');

      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe('/payment/bin/check');

      // Verify request body
      expect(request.data).toHaveProperty('locale', 'tr');
      expect(request.data).toHaveProperty('binNumber', '454360');
      expect(request.data).toHaveProperty('conversationId');
    });
  });

  describe('PWI (Payment With IBAN - Korumalı Havale/EFT)', () => {
    beforeEach(() => {
      const client = (iyzico as any).client;
      vi.spyOn(client, 'request').mockImplementation(async (...args: unknown[]) => {
        const [config] = args as [any];
        const url: string = config.url;
        const data = config.data ?? '{}';

        capturedRequests.push({
          url,
          data: typeof data === 'string' ? JSON.parse(data) : data,
          headers: config?.headers || {},
          rawData: data,
        });

        if (url.includes('/payment/iyzipos/item/initialize')) {
          return {
            data: {
              status: 'success',
              locale: 'tr',
              systemTime: Date.now(),
              conversationId: 'test-conversation-id',
              htmlContent: '<html>PWI payment page</html>',
              token: 'pwi-token-123',
              tokenExpireTime: Date.now() + 3600000,
              paymentPageUrl: 'https://sandbox-api.iyzipay.com/payment/pwi/test-token',
            },
            status: 200,
          };
        } else if (url.includes('/payment/iyzipos/item/detail')) {
          return {
            data: {
              status: 'success',
              locale: 'tr',
              systemTime: Date.now(),
              conversationId: 'test-conversation-id',
              token: 'pwi-token-123',
              callbackUrl: 'https://your-site.com/payment/callback',
              paymentStatus: 'WAITING',
              iban: 'TR123456789012345678901234',
              bankName: 'Test Bank',
              buyerName: 'John',
              buyerSurname: 'Doe',
              buyerEmail: 'john.doe@example.com',
              price: 100.0,
              paidPrice: 100.0,
              currency: 'TRY',
              basketId: 'B67832',
            },
            status: 200,
          };
        }

        return {
          data: {
            status: 'success',
            paymentId: 'test-payment-id',
            conversationId: 'test-conversation-id',
          },
          status: 200,
        };
      });
    });

    it('should initialize PWI payment with correct format', async () => {
      const pwiRequest = {
        price: '100.00',
        paidPrice: '100.00',
        currency: 'TRY',
        basketId: 'B67832',
        callbackUrl: 'https://your-site.com/payment/callback',
        buyer: mockPaymentRequest.buyer,
        shippingAddress: mockPaymentRequest.shippingAddress,
        billingAddress: mockPaymentRequest.billingAddress,
        // iyzico requires basket item prices to add up to price
        basketItems: [{ ...mockPaymentRequest.basketItems[0], price: '100.00' }],
        conversationId: 'test-pwi-conversation',
      };

      await iyzico.initPWIPayment(pwiRequest);

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe('/payment/iyzipos/item/initialize');

      // Verify request body
      expect(request.data).toHaveProperty('locale', 'tr');
      expect(request.data).toHaveProperty('conversationId', 'test-pwi-conversation');
      expect(request.data).toHaveProperty('price', '100.00');
      expect(request.data).toHaveProperty('paidPrice', '100.00');
      expect(request.data).toHaveProperty('currency', 'TRY');
      expect(request.data).toHaveProperty('basketId', 'B67832');
      expect(request.data).toHaveProperty('paymentGroup', 'PRODUCT');
      expect(request.data).toHaveProperty('callbackUrl', 'https://your-site.com/payment/callback');

      // Verify buyer data
      expect(request.data).toHaveProperty('buyer');
      expect(request.data.buyer).toHaveProperty('id', mockPaymentRequest.buyer.id);
      expect(request.data.buyer).toHaveProperty('name', mockPaymentRequest.buyer.name);
      expect(request.data.buyer).toHaveProperty('email', mockPaymentRequest.buyer.email);

      // Verify basket items
      expect(request.data).toHaveProperty('basketItems');
      expect(request.data.basketItems).toHaveLength(1);
    });

    it('should retrieve PWI payment status with correct format', async () => {
      await iyzico.retrievePWIPayment('pwi-token-123', 'test-conversation-id');

      expect(capturedRequests).toHaveLength(1);
      const request = capturedRequests[0];

      // Verify endpoint
      expect(request.url).toBe('/payment/iyzipos/item/detail');

      // Verify request body
      expect(request.data).toHaveProperty('locale', 'tr');
      expect(request.data).toHaveProperty('conversationId', 'test-conversation-id');
      expect(request.data).toHaveProperty('token', 'pwi-token-123');
    });

    it('should include authorization header in PWI requests', async () => {
      const pwiRequest = {
        price: '100.00',
        paidPrice: '100.00',
        currency: 'TRY',
        basketId: 'B67832',
        callbackUrl: 'https://your-site.com/payment/callback',
        buyer: mockPaymentRequest.buyer,
        shippingAddress: mockPaymentRequest.shippingAddress,
        billingAddress: mockPaymentRequest.billingAddress,
        // iyzico requires basket item prices to add up to price
        basketItems: [{ ...mockPaymentRequest.basketItems[0], price: '100.00' }],
      };

      await iyzico.initPWIPayment(pwiRequest);

      const request = capturedRequests[0];

      // Should have IYZWSv2 authorization
      expect(request.headers.Authorization).toBeDefined();
      expect(request.headers.Authorization).toMatch(/^IYZWSv2 /);
      expect(request.headers['x-iyzi-rnd']).toBeDefined();
    });

    it('should handle PWI payment with all required fields', async () => {
      const pwiRequest = {
        price: '250.50',
        paidPrice: '250.50',
        currency: 'TRY',
        basketId: 'B12345',
        callbackUrl: 'https://example.com/callback',
        buyer: {
          id: 'BY123',
          name: 'Jane',
          surname: 'Smith',
          email: 'jane@example.com',
          identityNumber: '11111111111',
          registrationAddress: '123 Main St',
          city: 'Ankara',
          country: 'Turkey',
          ip: '192.168.1.1',
          gsmNumber: '+905551234567',
        },
        shippingAddress: {
          contactName: 'Jane Smith',
          city: 'Ankara',
          country: 'Turkey',
          address: '123 Main St',
          zipCode: '06000',
        },
        billingAddress: {
          contactName: 'Jane Smith',
          city: 'Ankara',
          country: 'Turkey',
          address: '123 Main St',
          zipCode: '06000',
        },
        basketItems: [
          {
            id: 'BI1',
            name: 'Item 1',
            category1: 'Electronics',
            itemType: 'PHYSICAL',
            price: '250.50',
          },
        ],
        conversationId: 'pwi-conv-123',
      };

      const result = await iyzico.initPWIPayment(pwiRequest);

      expect(result.status).toBe('success');
      expect(result.htmlContent).toBeDefined();
      expect(result.token).toBe('pwi-token-123');
      expect(result.paymentPageUrl).toBeDefined();
      expect(result.tokenExpireTime).toBeGreaterThan(Date.now());
    });

    it('should retrieve PWI payment with IBAN details', async () => {
      const result = await iyzico.retrievePWIPayment('pwi-token-123');

      // Transfer not received yet: the payment is pending, not successful
      expect(result.status).toBe('pending');
      expect(result.paymentStatus).toBe('WAITING');
      expect(result.iban).toBe('TR123456789012345678901234');
      expect(result.bankName).toBe('Test Bank');
      expect(result.buyerName).toBe('John');
      expect(result.buyerSurname).toBe('Doe');
      expect(result.buyerEmail).toBe('john.doe@example.com');
    });
  });
});
