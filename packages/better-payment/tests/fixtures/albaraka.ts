// Albaraka Türk fixtures. Store values are made up; MACs are computed
// independently (Python hashlib). Answers follow the shape the test host returns.
export const ALBARAKA_TEST = {
  merchantId: '6700000067',
  terminalId: '67000067',
  posnetId: '1010',
  encKey: 'TESTENCKEY',
};

export const ALBARAKA_BASE_URL = 'https://epostest.albarakaturk.com.tr';

/** MAC of a sale of 1.20 TRY with card 5400010000000004, CVC 000, expiry 12/30 */
export const ALBARAKA_SALE_MAC = 'xCjbJqQIpeOedM8oXV+hXi4EBzPAhgzvNTnqasZ5Nhk=';
/** MAC of the 3D sale for ALBARAKA_3D_CALLBACK */
export const ALBARAKA_3D_MAC = 'kL3uVm4J5E8zZCovFjs2n7ij/Sf0HBUARECmyHdVWig=';
/** MAC of Return / Reverse for ReferenceCode REF123 */
export const ALBARAKA_REFERENCE_MAC = 'BNCLNNvobKR7HEgtmuMW6fPN9JMhy5iE9N5JLK9zpHE=';

/** MAC of TransactionInquiry for order ORDER1 (sent as 00000000000000ORDER1) */
export const ALBARAKA_INQUIRY_MAC = '/oCQsEflmYDWrPPy2VvLXlhAqJ8Q3gFQi02vVWKNRY4=';

export const ALBARAKA_3D_CALLBACK = {
  MdStatus: '1',
  MdErrorMessage: 'Authenticated',
  SecureTransactionId: 'SECTXN1',
  CAVV: 'CAVVVALUE=',
  ECI: '05',
  MD: 'MDVALUE',
};

export const albarakaResponse = (code = '00', fields: Record<string, unknown> = {}) => ({
  ServiceResponseData: {
    ResponseCode: code,
    ResponseDescription: code === '00' ? 'APPROVED' : 'UNAUTHORIZED REQUEST',
  },
  AuthCode: code === '00' ? '123456' : null,
  ReferenceCode: code === '00' ? 'REF123' : null,
  PointDataList: null,
  InstallmentData: null,
  MessageData: null,
  ...fields,
});
