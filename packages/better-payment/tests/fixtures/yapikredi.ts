// Yapı Kredi (Posnet) fixtures. Store values are made up; the MAC is computed
// independently (Python hashlib). Response shapes follow the test endpoint.
export const YAPIKREDI_TEST = {
  merchantId: '6706598320',
  terminalId: '67005551',
  posnetId: '9644',
  encKey: '10,10,10,10,10,10,10,10',
};

export const YAPIKREDI_BASE_URL = 'https://setmpos.ykb.com';

export const YAPIKREDI_MAC = 'A301mJz3V6ewHXJuWUHMpyCCMaIYmq/JG+dBMSmG7m8=';

export const YAPIKREDI_CALLBACK = {
  BankPacket: 'BANKPACKET0123456789',
  MerchantPacket: 'MERCHANTPACKET0123456789',
  Sign: 'SIGN0123456789',
  CCPrefix: '450634',
  TranType: 'Sale',
};

export const ykbXml = (
  fields: Record<string, string>,
  blocks: Record<string, Record<string, string>> = {}
) => {
  const tags = (o: Record<string, string>) =>
    Object.entries(o)
      .map(([key, value]) => `<${key}>${value}</${key}>`)
      .join('');
  return (
    "<?xml version='1.0' encoding='iso-8859-9'?><posnetResponse>" +
    tags(fields) +
    Object.entries(blocks)
      .map(([name, content]) => `<${name}>${tags(content)}</${name}>`)
      .join('') +
    '</posnetResponse>'
  );
};

export const YKB_OOS_REQUEST_XML = ykbXml(
  { approved: '1' },
  { oosRequestDataResponse: { data1: 'DATA1VALUE', data2: 'DATA2VALUE', sign: 'SIGNVALUE' } }
);

export const ykbResolveXml = (data: Record<string, string> = {}) =>
  ykbXml(
    { approved: '1' },
    {
      oosResolveMerchantDataResponse: {
        xid: '0000000000000ORDER3D',
        amount: '120',
        currency: 'TL',
        installment: '00',
        point: '0',
        pointAmount: '0',
        txStatus: 'Y',
        mdStatus: '1',
        mdErrorMessage: 'Authenticated',
        ...data,
      },
    }
  );

export const YKB_APPROVED_XML = ykbXml({
  approved: '1',
  hostlogkey: '021000000000000123',
  authCode: '123456',
  tranDate: '261011144551',
});

export const YKB_DECLINED_XML = ykbXml({
  approved: '0',
  respCode: '0225',
  respText: 'ONAYLANMADI',
});
