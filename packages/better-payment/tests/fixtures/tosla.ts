/** Made-up Tosla credentials for unit tests */
export const TOSLA_TEST = {
  clientId: '1000000001',
  apiUser: 'POS_TEST_USER',
  apiPass: 'POS_TEST_PASS',
};

export const TOSLA_BASE_URL = 'https://prepentegrasyon.tosla.com';

/** inquiry answer, shaped like the test host's (field names from its answer) */
export const toslaInquiry = (overrides: Record<string, unknown> = {}) => ({
  TransactionType: 1,
  CreateDate: '20261012150000',
  OrderId: 'ORDERTS',
  BankResponseCode: '00',
  BankResponseMessage: 'Onaylandı',
  AuthCode: '123456',
  HostReferenceNumber: '628512345678',
  Amount: 120,
  Currency: 949,
  InstallmentCount: 1,
  ClientId: 1000000001,
  CardNo: '552879******0008',
  RequestStatus: 1,
  RefundedAmount: 0,
  PostAuthedAmount: 0,
  TransactionId: 'TX1',
  Code: 0,
  Message: 'Başarılı',
  ...overrides,
});

/** GetCommissionAndInstallmentInfo answer */
export const TOSLA_COMMISSION = {
  CardPrefix: 540667,
  BankId: 46,
  BankCode: '0046',
  BankName: 'Akbank',
  CardName: 'Axess',
  CardClass: 'Ticari',
  CardType: 'Kredi Kartı',
  Country: 'TR',
  CommissionPackages: [
    { InstallmentRate: { T1: { Rate: 0 }, T3: { Rate: 3.5 }, T6: { Rate: 6 }, T9: null } },
  ],
  Code: 0,
  Message: 'Başarılı',
};
