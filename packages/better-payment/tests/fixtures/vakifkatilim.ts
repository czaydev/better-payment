// Vakıf Katılım fixtures. Store values are made up; hashes are computed
// independently (Python hashlib). Answers follow the shape the gateway returns.
export const VAKIFKATILIM_TEST = {
  merchantId: '9999',
  customerId: '8888',
  username: 'apiuser',
  password: 'TESTPASS',
};

export const VAKIFKATILIM_BASE_URL = 'https://boa.vakifkatilim.com.tr/VirtualPOS.Gateway';

/** Hash of a 3D request / provision for ORDER1, 1.20 TRY, https://example.com/callback */
export const VAKIFKATILIM_3D_HASH = 't9Q+Z1PYSpHNNWOJ1EG92T3uzNI=';
/** Hash of a non-3D sale for ORDER1, 1.20 TRY (no return URLs) */
export const VAKIFKATILIM_NON3D_HASH = 'iob562iJuVktLwURkJN9oY7OSPk=';
/** Hash of a partial refund of 0.50 TRY for ORDER1 */
export const VAKIFKATILIM_PARTIAL_HASH = 'z6XahCrZpQatk7K1HykOVI+haeI=';

export const vakifKatilimResponse = (fields: Record<string, string> = {}) =>
  '<?xml version="1.0" encoding="utf-16"?><VPosTransactionResponseContract ' +
  'xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
  '<VPosMessage><MerchantOrderId>ECHO</MerchantOrderId><OrderId>999</OrderId></VPosMessage>' +
  '<IsEnrolled>true</IsEnrolled><IsVirtual>false</IsVirtual>' +
  Object.entries({
    ResponseCode: '00',
    ResponseMessage: 'Onaylandı',
    OrderId: '123456',
    MerchantOrderId: 'ORDER1',
    ProvisionNumber: 'P12345',
    ...fields,
  })
    .map(([key, value]) => `<${key}>${value}</${key}>`)
    .join('') +
  '</VPosTransactionResponseContract>';

/** The page ThreeDModelPayGate returns for a rejected request (seen on the gateway) */
export const VAKIFKATILIM_REJECTED_3D_PAGE =
  '<!DOCTYPE html><html><body onload="OnLoadEvent();"><form name="downloadForm" action="https://example.com/callback" method="POST">' +
  '<input type="hidden" name="ResponseCode" value="MerchantNotDefined">' +
  '<input type="hidden" name="ResponseMessage" value="Uye isyeri kullanici tanimi bulunamadi.">' +
  '<input type="hidden" name="MerchantOrderId" value="ORDER1"><input type="hidden" name="OrderId" value="0">' +
  '<input type="hidden" name="HashData"><input type="hidden" name="MD"></form></body></html>';

export const VAKIFKATILIM_ACS_PAGE =
  '<html><body onload="document.forms[0].submit()"><form action="https://acs.example.com/challenge" method="POST">' +
  '<input type="hidden" name="PaReq" value="X"></form></body></html>';

export const VAKIFKATILIM_CALLBACK = {
  ResponseCode: '00',
  ResponseMessage: 'Kart doğrulandı.',
  MerchantOrderId: 'ORDER1',
  OrderId: '0',
  MD: 'ENCRYPTEDMD==',
  HashData: 'SOMEHASH=',
};
