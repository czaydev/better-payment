// QNB (PayFor) fixtures. The store values are the public 3D Model demo merchant on
// vpos.qnb.com.tr/Help; hashes are computed independently (Python hashlib).
export const QNB_TEST = {
  merchantId: '085300000009597',
  userCode: 'QNB_API_KULLANICI',
  userPass: 'FwCX2',
  merchantPass: '12345678',
};

export const QNB_BASE_URL = 'https://vpostest.qnb.com.tr';

export const QNB_FORM_HASH = 'Zf29qjUJV9sxtrOZspFcjvecWxc=';

/** 3DModel: card verified (V033), charged later with 3DModelPayment */
export const QNB_3DMODEL_CALLBACK = {
  OrderId: 'ORDER3D',
  MerchantID: QNB_TEST.merchantId,
  SecureType: '3DModel',
  '3DStatus': '1',
  RequestGuid: '1000000128757956',
  PurchAmount: '1.20',
  Currency: '949',
  ProcReturnCode: 'V033',
  TxnResult: 'Failed',
  ErrMsg: '3D Kullanıcı Doğrulama Adımı Başarılı',
  AuthCode: '',
  HostRefNum: '',
  Eci: '05',
  ResponseRnd: 'PF639273336051392939',
  ResponseHash: 'gZrDp47gIQ8N0nCWSYNW80NZoe0=',
  HashType: 'Sha1',
};

/** 3DPay: the bank charged the card */
export const QNB_3DPAY_CALLBACK = {
  OrderId: 'ORDERPAY',
  MerchantID: QNB_TEST.merchantId,
  SecureType: '3DPay',
  '3DStatus': '1',
  RequestGuid: '1000000128757960',
  PurchAmount: '1.00',
  Currency: '949',
  ProcReturnCode: '00',
  TxnResult: 'Success',
  ErrMsg: 'Onaylandı',
  AuthCode: 'S59045',
  HostRefNum: '628416660077',
  Eci: '05',
  ResponseRnd: 'PF639273336051392940',
  ResponseHash: '3Yllopti5IiA/HlqGAZkwGQw7Oo=',
  HashType: 'Sha1',
};

export const qnbXml = (fields: Record<string, string>) =>
  '<?xml version="1.0" encoding="utf-8"?><PayforResponse>' +
  Object.entries(fields)
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join('') +
  '</PayforResponse>';

export const QNB_APPROVED_XML = qnbXml({
  OrderId: 'ORDER3D',
  ProcReturnCode: '00',
  ErrMsg: 'Onaylandı',
  AuthCode: 'S70439',
  HostRefNum: '628416660070',
});

export const qnbInquiryXml = (fields: Record<string, string> = {}) =>
  qnbXml({
    OrderId: 'ORDERPAY',
    TxnResult: 'Success',
    ProcReturnCode: '00',
    ErrMsg: 'Onaylandı',
    AuthCode: 'S59045',
    HostRefNum: '\r\n  ',
    TxnStatus: 'Y',
    IsVoided: 'false',
    IsRefunded: 'false',
    PurchAmount: '1.00',
    TxnType: 'Auth',
    ...fields,
  });
