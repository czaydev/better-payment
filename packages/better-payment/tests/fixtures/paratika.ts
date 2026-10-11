// Paratika (Payten) fixtures. Store values are made up; the callback hash is
// computed independently (Python hashlib). Answers follow the API v2 docs.
export const PARATIKA_TEST = {
  merchant: '10000000',
  merchantUser: 'api@example.com',
  merchantPassword: 'apipass',
  secretKey: 'TESTSECRET',
};

export const PARATIKA_BASE_URL = 'https://entegrasyon.paratika.com.tr/paratika/api/v2';

/** sdSha512 of PARATIKA_3D_CALLBACK with secretKey TESTSECRET */
export const PARATIKA_CALLBACK_HASH =
  'ecf8d4fb69cca9f75afdcab87d08d9c8210df5a6faa7108867d5f05f9df5161313e6ef6385ea39ad8c701e852ab46d481d660addac06a660fd3439f8dd325522';

export const PARATIKA_3D_CALLBACK = {
  merchantPaymentId: 'ORDER1',
  customerId: 'U1',
  sessionToken: 'SESSIONTOKEN123',
  pgTranId: '18285OQZD14766',
  random: 'RAND123',
  sdSha512: PARATIKA_CALLBACK_HASH,
  responseCode: '00',
  responseMsg: 'Approved',
};

export const paratikaApproved = (fields: Record<string, unknown> = {}) => ({
  responseCode: '00',
  responseMsg: 'Approved',
  merchantPaymentId: 'ORDER1',
  pgTranId: '18285OQZD14766',
  pgTranRefId: '828514893296',
  ...fields,
});

export const paratikaDeclined = (errorCode = 'ERR20051', errorMsg = 'Yetersiz limit') => ({
  responseCode: '99',
  responseMsg: 'Declined',
  errorCode,
  errorMsg,
});

export const paratikaTransactions = (list: Array<Record<string, unknown>>) => ({
  responseCode: '00',
  responseMsg: 'Approved',
  transactionCount: String(list.length),
  transactionList: list,
});

export const paratikaSale = (fields: Record<string, unknown> = {}) => ({
  pgTranId: '18285OQZD14766',
  merchantPaymentId: 'ORDER1',
  transactionStatus: 'AP',
  transactionType: 'SALE',
  amount: 1.2,
  currency: 'TRY',
  ...fields,
});
