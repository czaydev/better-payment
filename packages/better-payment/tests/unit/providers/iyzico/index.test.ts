import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Iyzico } from '../../../../src/providers/iyzico';
import { PaymentStatus } from '../../../../src/types';
import { mockCheckoutRequest } from '../../../fixtures/payment-data';

describe('Iyzico Provider - Unit Tests', () => {
  let iyzico: Iyzico;

  beforeEach(() => {
    iyzico = new Iyzico({
      apiKey: 'test-api-key',
      secretKey: 'test-secret-key',
      baseUrl: 'https://sandbox-api.iyzipay.com',
      locale: 'tr',
    });
  });

  describe('binCheck', () => {
    it('should map successful response correctly', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        binNumber: '454360',
        cardType: 'CREDIT_CARD',
        cardAssociation: 'VISA',
        cardFamily: 'Maximum',
        bankName: 'Türkiye İş Bankası',
        bankCode: 64,
        commercial: 0,
      };

      // Mock sendRequest
      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.binCheck('454360');

      expect(result).toEqual({
        binNumber: '454360',
        cardType: 'CREDIT_CARD',
        cardAssociation: 'VISA',
        cardFamily: 'Maximum',
        bankName: 'Türkiye İş Bankası',
        bankCode: 64,
        commercial: false,
        rawResponse: mockResponse,
      });
    });

    it('should throw error when status is failure', async () => {
      const mockResponse = {
        status: 'failure',
        errorMessage: 'BIN not found',
      };

      // Mock sendRequest
      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      await expect(iyzico.binCheck('000000')).rejects.toThrow('BIN not found');
    });
  });

  describe('mapStatus', () => {
    it('should map success to PaymentStatus.SUCCESS', () => {
      const mapStatus = (iyzico as any).mapStatus.bind(iyzico);
      expect(mapStatus('success')).toBe(PaymentStatus.SUCCESS);
    });

    it('should map failure to PaymentStatus.FAILURE', () => {
      const mapStatus = (iyzico as any).mapStatus.bind(iyzico);
      expect(mapStatus('failure')).toBe(PaymentStatus.FAILURE);
    });

    it('should map unknown status to PaymentStatus.PENDING', () => {
      const mapStatus = (iyzico as any).mapStatus.bind(iyzico);
      expect(mapStatus('unknown')).toBe(PaymentStatus.PENDING);
    });
  });

  describe('installmentInfo', () => {
    it('should return installment details successfully', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        conversationId: 'test-conversation-123',
        installmentDetails: [
          {
            binNumber: '552879',
            price: 100,
            cardType: 'CREDIT_CARD',
            cardAssociation: 'MASTER_CARD',
            cardFamilyName: 'Bonus',
            force3ds: 0,
            bankCode: 46,
            bankName: 'Akbank',
            forceCvc: 0,
            commercial: 0,
            installmentPrices: [
              {
                installmentNumber: 1,
                totalPrice: 100,
                installmentPrice: 100,
              },
              {
                installmentNumber: 2,
                totalPrice: 102,
                installmentPrice: 51,
              },
              {
                installmentNumber: 3,
                totalPrice: 104.5,
                installmentPrice: 34.83,
              },
            ],
          },
        ],
      };

      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails).toBeDefined();
      expect(result.installmentDetails).toHaveLength(1);

      const detail = result.installmentDetails![0];
      expect(detail.binNumber).toBe('552879');
      expect(detail.bankName).toBe('Akbank');
      expect(detail.cardFamilyName).toBe('Bonus');
      expect(detail.installmentPrices).toHaveLength(3);

      // Check first installment (single payment)
      expect(detail.installmentPrices[0].installmentNumber).toBe(1);
      expect(detail.installmentPrices[0].totalPrice).toBe(100);

      // Check second installment
      expect(detail.installmentPrices[1].installmentNumber).toBe(2);
      expect(detail.installmentPrices[1].totalPrice).toBe(102);
      expect(detail.installmentPrices[1].installmentPrice).toBe(51);
    });

    it('should handle multiple banks installment options', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        installmentDetails: [
          {
            binNumber: '552879',
            price: 100,
            cardType: 'CREDIT_CARD',
            cardAssociation: 'MASTER_CARD',
            cardFamilyName: 'Bonus',
            bankCode: 46,
            bankName: 'Akbank',
            commercial: 0,
            installmentPrices: [
              { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
              { installmentNumber: 2, totalPrice: 102, installmentPrice: 51 },
            ],
          },
          {
            binNumber: '552879',
            price: 100,
            cardType: 'CREDIT_CARD',
            cardAssociation: 'MASTER_CARD',
            cardFamilyName: 'Maximum',
            bankCode: 64,
            bankName: 'İş Bankası',
            commercial: 0,
            installmentPrices: [
              { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
              { installmentNumber: 3, totalPrice: 105, installmentPrice: 35 },
            ],
          },
        ],
      };

      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails).toHaveLength(2);
      expect(result.installmentDetails![0].bankName).toBe('Akbank');
      expect(result.installmentDetails![1].bankName).toBe('İş Bankası');
    });

    it('should handle commercial cards', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        installmentDetails: [
          {
            binNumber: '552879',
            price: 100,
            cardType: 'CREDIT_CARD',
            cardAssociation: 'MASTER_CARD',
            cardFamilyName: 'Business',
            bankCode: 46,
            bankName: 'Akbank',
            commercial: 1, // Commercial card
            force3ds: 1, // 3DS required
            installmentPrices: [{ installmentNumber: 1, totalPrice: 100, installmentPrice: 100 }],
          },
        ],
      };

      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.SUCCESS);
      expect(result.installmentDetails![0].commercial).toBe(1);
      expect(result.installmentDetails![0].force3ds).toBe(1);
    });

    it('should handle installment query failure', async () => {
      const mockResponse = {
        status: 'failure',
        locale: 'tr',
        systemTime: 123456789,
        errorCode: '5001',
        errorMessage: 'Invalid BIN number',
      };

      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      const result = await iyzico.installmentInfo({
        binNumber: '000000',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Invalid BIN number');
      expect(result.errorCode).toBe('5001');
      expect(result.installmentDetails).toBeUndefined();
    });

    it('should include conversationId in request', async () => {
      const mockResponse = {
        status: 'success',
        locale: 'tr',
        systemTime: 123456789,
        conversationId: 'test-conv-123',
        installmentDetails: [],
      };

      const sendRequestSpy = vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue(mockResponse);

      await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
        conversationId: 'test-conv-123',
      });

      expect(sendRequestSpy).toHaveBeenCalledWith(
        '/payment/iyzipos/installment',
        expect.objectContaining({
          conversationId: 'test-conv-123',
          binNumber: '552879',
          price: '100.00',
          locale: 'tr',
        })
      );
    });

    it('should handle network errors', async () => {
      vi.spyOn(iyzico as any, 'sendRequest').mockRejectedValue(new Error('Network error'));

      const result = await iyzico.installmentInfo({
        binNumber: '552879',
        price: '100.00',
      });

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.errorMessage).toBe('Network error');
    });
  });

  describe('createCheckout / getCheckoutResult', () => {
    it('maps the order to the checkout form and returns the hosted page', async () => {
      const send = vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'success',
        token: 'TOKEN1',
        paymentPageUrl: 'https://sandbox.iyzipay.com/checkout/TOKEN1',
        checkoutFormContent: '<script src="https://static.iyzipay.com/checkout.js"></script>',
        tokenExpireTime: 1234,
        conversationId: '123456789',
      });

      const result = await iyzico.createCheckout(mockCheckoutRequest);

      expect(send.mock.calls[0][0]).toBe('/payment/iyzipos/checkoutform/initialize/auth/ecom');
      expect(send.mock.calls[0][1]).toMatchObject({
        callbackUrl: 'https://shop.example/return',
        enabledInstallments: [1, 3, 6],
        locale: 'en',
      });
      expect(JSON.stringify(send.mock.calls[0][1])).not.toMatch(/cardNumber|cvc|4242424242424242/);
      // The init call's success only means the page is ready
      expect(result).toMatchObject({
        status: PaymentStatus.PENDING,
        redirectUrl: 'https://sandbox.iyzipay.com/checkout/TOKEN1',
        iframeUrl: 'https://sandbox.iyzipay.com/checkout/TOKEN1',
        html: '<script src="https://static.iyzipay.com/checkout.js"></script>',
        token: 'TOKEN1',
        tokenExpireTime: 1234,
        conversationId: '123456789',
      });
    });

    it('getCheckoutResult confirms the payment and returns tokens of a saved card', async () => {
      const send = vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'success',
        paymentStatus: 'SUCCESS',
        paymentId: 'PAY1',
        conversationId: '123456789',
        cardUserKey: 'CU1',
        cardToken: 'CT1',
        lastFourDigits: '4242',
      });

      const result = await iyzico.getCheckoutResult('TOKEN1');

      expect(send.mock.calls[0][0]).toBe('/payment/iyzipos/checkoutform/auth/ecom/detail');
      expect(send.mock.calls[0][1]).toMatchObject({ token: 'TOKEN1' });
      expect(result).toMatchObject({
        status: PaymentStatus.SUCCESS,
        paymentId: 'PAY1',
        conversationId: '123456789',
        storedCard: { customerToken: 'CU1', cardToken: 'CT1' },
      });
    });

    it('getCheckoutResult does not return card tokens for a failed payment', async () => {
      vi.spyOn(iyzico as any, 'sendRequest').mockResolvedValue({
        status: 'success',
        paymentStatus: 'FAILURE',
        paymentId: 'PAY1',
        cardUserKey: 'CU1',
        cardToken: 'CT1',
      });

      const result = await iyzico.getCheckoutResult('TOKEN1');

      expect(result.status).toBe(PaymentStatus.FAILURE);
      expect(result.storedCard).toBeUndefined();
    });
  });
});
