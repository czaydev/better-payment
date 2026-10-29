import { describe, it, expect } from 'vitest';
import { buildInstallmentTable } from '../../../src/core/installments';
import { buildInstallmentTable as clientBuildInstallmentTable } from '../../../src/client';
import { PaymentStatus } from '../../../src/types';

describe('buildInstallmentTable', () => {
  it('is exported identically from root and client entry points', () => {
    expect(buildInstallmentTable).toBe(clientBuildInstallmentTable);
  });

  describe('iyzico responses', () => {
    const mockIyzicoResponse = {
      status: PaymentStatus.SUCCESS,
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
            { installmentNumber: 3, totalPrice: 106, installmentPrice: 35.33 },
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
            { installmentNumber: 6, totalPrice: 109, installmentPrice: 18.17 },
          ],
        },
      ],
    };

    it('builds sorted installment rows with formatted amounts and differences', () => {
      const rows = buildInstallmentTable(mockIyzicoResponse);

      expect(rows).toHaveLength(3);
      // Rows sorted by installment count: 1, 2, 3
      expect(rows.map((r) => r.count)).toEqual([1, 2, 3]);

      // Row 1 (single payment)
      const single = rows[0];
      expect(single.count).toBe(1);
      expect(single.isSinglePayment).toBe(true);
      expect(single.total).toBe(100);
      expect(single.monthlyAmount).toBe(100);
      expect(single.difference).toBe(0);
      expect(single.cardFamily).toBe('Bonus');
      expect(single.bankName).toBe('Akbank');
      expect(single.bankCode).toBe(46);
      expect(single.cardAssociation).toBe('MASTER_CARD');
      expect(single.cardType).toBe('CREDIT_CARD');
      expect(single.commercial).toBe(0);
      expect(single.formattedTotal).toContain('100,00');
      expect(single.formattedMonthlyAmount).toContain('100,00');
      expect(single.formattedDifference).toContain('0,00');

      // Row 2 (2 installments)
      const inst2 = rows[1];
      expect(inst2.count).toBe(2);
      expect(inst2.isSinglePayment).toBe(false);
      expect(inst2.total).toBe(102);
      expect(inst2.monthlyAmount).toBe(51);
      expect(inst2.difference).toBe(2);
      expect(inst2.formattedTotal).toContain('102,00');
      expect(inst2.formattedMonthlyAmount).toContain('51,00');
      expect(inst2.formattedDifference).toContain('2,00');

      // Row 3 (3 installments)
      const inst3 = rows[2];
      expect(inst3.count).toBe(3);
      expect(inst3.isSinglePayment).toBe(false);
      expect(inst3.total).toBe(106);
      expect(inst3.monthlyAmount).toBe(35.33);
      expect(inst3.difference).toBe(6);
      expect(inst3.formattedTotal).toContain('106,00');
      expect(inst3.formattedMonthlyAmount).toContain('35,33');
      expect(inst3.formattedDifference).toContain('6,00');
    });

    it('filters by card family name', () => {
      const rows = buildInstallmentTable(mockIyzicoResponse, {
        cardFamily: 'Maximum',
      });

      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.count)).toEqual([1, 6]);
      expect(rows[0].cardFamily).toBe('Maximum');
      expect(rows[0].bankName).toBe('İş Bankası');
      expect(rows[1].total).toBe(109);
      expect(rows[1].difference).toBe(9);
    });

    it('filters by bank code', () => {
      const rows = buildInstallmentTable(mockIyzicoResponse, {
        bankCode: 64,
      });

      expect(rows).toHaveLength(2);
      expect(rows[0].bankName).toBe('İş Bankası');
    });

    it('supports allDetails option to aggregate all card families', () => {
      const rows = buildInstallmentTable(mockIyzicoResponse, {
        allDetails: true,
      });

      expect(rows).toHaveLength(5);
      expect(rows.map((r) => r.count)).toEqual([1, 1, 2, 3, 6]);
    });
  });

  describe('PayTR responses', () => {
    const mockPaytrResponse = {
      status: PaymentStatus.SUCCESS,
      installmentDetails: [
        {
          binNumber: '415956',
          price: 100,
          cardType: 'CREDIT_CARD',
          cardAssociation: 'MASTERCARD',
          cardFamilyName: 'bonus',
          bankCode: 62,
          bankName: 'Garanti',
          commercial: 0,
          installmentPrices: [
            { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
            { installmentNumber: 2, totalPrice: 102, installmentPrice: 51 },
            { installmentNumber: 3, totalPrice: 103.5, installmentPrice: 34.5 },
          ],
        },
      ],
    };

    it('handles PayTR fractional amounts and preserves kuruş accuracy', () => {
      const rows = buildInstallmentTable(mockPaytrResponse);

      expect(rows).toHaveLength(3);
      expect(rows[2].count).toBe(3);
      expect(rows[2].total).toBe(103.5);
      expect(rows[2].monthlyAmount).toBe(34.5);
      expect(rows[2].difference).toBe(3.5);
      expect(rows[2].formattedTotal).toContain('103,50');
      expect(rows[2].formattedMonthlyAmount).toContain('34,50');
      expect(rows[2].formattedDifference).toContain('3,50');
    });
  });

  describe('Parampos responses', () => {
    const mockParamposResponse = {
      status: PaymentStatus.SUCCESS,
      installmentDetails: [
        {
          binNumber: '435508',
          price: 100,
          cardType: 'CREDIT_CARD',
          cardAssociation: 'VISA',
          cardFamilyName: 'Axess',
          bankCode: 46,
          bankName: 'AKBANK T.A.Ş.',
          commercial: 0,
          installmentPrices: [
            {
              installmentNumber: 1,
              totalPrice: 101.75,
              installmentPrice: 101.75,
              commissionRate: 1.75,
            },
            {
              installmentNumber: 2,
              totalPrice: 103.2,
              installmentPrice: 51.6,
              commissionRate: 3.2,
            },
            {
              installmentNumber: 3,
              totalPrice: 104.1,
              installmentPrice: 34.7,
              commissionRate: 4.1,
            },
            {
              installmentNumber: 6,
              totalPrice: 107.9,
              installmentPrice: 17.98,
              commissionRate: 7.9,
            },
          ],
        },
      ],
    };

    it('retains commissionRate and calculates kuruş-accurate differences', () => {
      const rows = buildInstallmentTable(mockParamposResponse);

      expect(rows).toHaveLength(4);
      expect(rows[0].commissionRate).toBe(1.75);
      expect(rows[0].difference).toBe(0);

      // 103.20 - 101.75 = 1.45 exactly
      expect(rows[1].difference).toBe(1.45);
      expect(rows[1].commissionRate).toBe(3.2);
      expect(rows[1].formattedDifference).toContain('1,45');

      // 104.10 - 101.75 = 2.35 exactly
      expect(rows[2].difference).toBe(2.35);
      expect(rows[2].commissionRate).toBe(4.1);
      expect(rows[2].formattedDifference).toContain('2,35');

      // 107.90 - 101.75 = 6.15 exactly
      expect(rows[3].difference).toBe(6.15);
      expect(rows[3].commissionRate).toBe(7.9);
      expect(rows[3].formattedDifference).toContain('6,15');
    });
  });

  describe('formatting options', () => {
    const response = {
      status: PaymentStatus.SUCCESS,
      installmentDetails: [
        {
          binNumber: '552879',
          price: 250,
          cardType: 'CREDIT_CARD',
          cardAssociation: 'VISA',
          cardFamilyName: 'Axess',
          bankCode: 46,
          bankName: 'Akbank',
          commercial: 0,
          installmentPrices: [
            { installmentNumber: 1, totalPrice: 250, installmentPrice: 250 },
            { installmentNumber: 3, totalPrice: 260, installmentPrice: 86.67 },
          ],
        },
      ],
    };

    it('formats with foreign currency and custom locale', () => {
      const rows = buildInstallmentTable(response, {
        locale: 'en-US',
        currency: 'USD',
      });

      expect(rows[0].formattedTotal).toBe('$250.00');
      expect(rows[1].formattedTotal).toBe('$260.00');
      expect(rows[1].formattedMonthlyAmount).toBe('$86.67');
      expect(rows[1].formattedDifference).toBe('$10.00');
    });

    it('supports custom singlePaymentTotal override when count 1 is missing', () => {
      const responseWithoutSingle = {
        status: PaymentStatus.SUCCESS,
        installmentDetails: [
          {
            binNumber: '552879',
            price: 100,
            cardType: 'CREDIT_CARD',
            cardAssociation: 'VISA',
            cardFamilyName: 'Bonus',
            bankCode: 62,
            bankName: 'Garanti',
            commercial: 0,
            installmentPrices: [
              { installmentNumber: 2, totalPrice: 102, installmentPrice: 51 },
              { installmentNumber: 3, totalPrice: 105, installmentPrice: 35 },
            ],
          },
        ],
      };

      const rows = buildInstallmentTable(responseWithoutSingle, {
        singlePaymentTotal: 100,
      });

      expect(rows[0].difference).toBe(2);
      expect(rows[1].difference).toBe(5);
    });
  });

  describe('direct input structures and edge cases', () => {
    it('accepts a direct InstallmentPrice object', () => {
      const priceDetail = {
        binNumber: '415956',
        price: 50,
        cardType: 'CREDIT_CARD',
        cardAssociation: 'VISA',
        cardFamilyName: 'Bonus',
        bankCode: 62,
        bankName: 'Garanti',
        commercial: 0,
        installmentPrices: [{ installmentNumber: 1, totalPrice: 50, installmentPrice: 50 }],
      };

      const rows = buildInstallmentTable(priceDetail);
      expect(rows).toHaveLength(1);
      expect(rows[0].count).toBe(1);
      expect(rows[0].total).toBe(50);
    });

    it('accepts a direct array of InstallmentDetail', () => {
      const details = [
        { installmentNumber: 1, totalPrice: 100, installmentPrice: 100 },
        { installmentNumber: 2, totalPrice: 104, installmentPrice: 52 },
      ];

      const rows = buildInstallmentTable(details);
      expect(rows).toHaveLength(2);
      expect(rows[1].difference).toBe(4);
    });

    it('safely handles null, undefined, empty, or failed responses', () => {
      expect(buildInstallmentTable(null)).toEqual([]);
      expect(buildInstallmentTable(undefined)).toEqual([]);
      expect(buildInstallmentTable({ status: PaymentStatus.FAILURE })).toEqual([]);
      expect(
        buildInstallmentTable({ status: PaymentStatus.SUCCESS, installmentDetails: [] })
      ).toEqual([]);
      expect(buildInstallmentTable([])).toEqual([]);
    });

    it('provides compatibility aliases (installmentNumber, installmentPrice, totalPrice)', () => {
      const rows = buildInstallmentTable([
        { installmentNumber: 3, totalPrice: 150, installmentPrice: 50 },
      ]);
      expect(rows[0].installmentNumber).toBe(rows[0].count);
      expect(rows[0].installmentPrice).toBe(rows[0].monthlyAmount);
      expect(rows[0].totalPrice).toBe(rows[0].total);
    });
  });
});
