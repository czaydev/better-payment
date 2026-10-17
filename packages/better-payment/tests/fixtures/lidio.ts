/** Made-up Lidio merchant for unit tests */
export const LIDIO_TEST = {
  merchantCode: 'MERCHANT1',
  apiKey: 'TESTAPIKEY',
  merchantKey: 'TESTMERCHANTKEY',
};

export const LIDIO_BASE_URL = 'https://test.lidio.com/api';

/**
 * A 3D Secure return for ORDERLD, 1.20, signed for the customer
 * buyer@example.com. The hashes were computed independently (Python hashlib):
 * Base64(SHA-256("ORDERLD:TESTMERCHANTKEY:1.20:3DSuccess:buyer@example.com")).
 */
export const LIDIO_3D_RETURN = {
  OrderId: 'ORDERLD',
  SystemTransId: 'SYS123',
  Result: '3DSuccess',
  TotalAmount: '1.20',
  InstallmentCount: '0',
  MDStatus: '1',
  Hash: 'dtMD7MsNrpG8z8mKDnK3mV6Vn9PS3ueX53ZaZSefpKA=',
};

/** The same return with Result 3DFailed, signed */
export const LIDIO_3D_FAILED_RETURN = {
  ...LIDIO_3D_RETURN,
  Result: '3DFailed',
  MDStatus: '0',
  Hash: 'mx4a4D5fER578FpNA0tjiGH7YAAZXiUPrAyq8GcCsRo=',
};

export const LIDIO_CONTEXT = {
  orderId: 'ORDERLD',
  amount: '1.20',
  customer: 'buyer@example.com',
};

/** A payment answer (ProcessPayment, FinishPaymentProcess, PaymentInquiry, ...) */
export const lidioPayment = (
  fields: Record<string, unknown> = {},
  paymentInfo: Record<string, unknown> = {}
) => ({
  result: 'Success',
  resultDetail: 'Success',
  resultMessage: '',
  paymentInfo: {
    orderId: 'ORDERLD',
    systemTransId: 'SYS123',
    amountRequested: 1.2,
    amountProcessed: 1.2,
    currency: 'TRY',
    acquirerResultDetail: { pos: { returnCode: '00', message: 'Onaylandı' } },
    ...paymentInfo,
  },
  ...fields,
});

/** A bank refusal, with the bank's code */
export const lidioRefused = (returnCode = '51', message = 'Yetersiz bakiye') =>
  lidioPayment(
    { result: 'Refused', resultDetail: 'Refused', resultMessage: 'Refused' },
    { acquirerResultDetail: { pos: { returnCode, message } } }
  );
