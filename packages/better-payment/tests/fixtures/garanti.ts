// Garanti BBVA fixtures. The terminal values are the public test terminal on
// dev.garantibbva.com.tr; hashes are computed independently (Python hashlib, ISO-8859-9).
export const GARANTI_TEST = {
  merchantId: '7000679',
  terminalId: '30691297',
  password: '123qweASD/',
  storeKey: '12345678',
};

export const GARANTI_BASE_URL = 'https://sanalposprovtest.garantibbva.com.tr';

export const GARANTI_SECURITY_DATA = 'BAF0BF326B0261A4288A7273F18674FF35E9826F';

const HASH_PARAMS = 'clientid:oid:authcode:procreturncode:response:mdstatus:cavv:eci:md:rnd:';

/** 3D model: card verified, the merchant provisions it */
export const GARANTI_3D_CALLBACK = {
  clientid: '30691297',
  oid: 'ORDER3D',
  orderid: 'ORDER3D',
  terminalid: '30691297',
  terminalmerchantid: '7000679',
  authcode: '',
  procreturncode: '',
  response: '',
  mdstatus: '1',
  mderrormessage: 'Authenticated',
  cavv: 'CAVVVALUE=',
  eci: '02',
  md: 'MDVALUE123',
  xid: 'XIDVALUE=',
  rnd: 'RNDVALUE',
  txnamount: '120',
  txncurrencycode: '949',
  txninstallmentcount: '',
  txntype: 'sales',
  customeripaddress: '85.34.78.112',
  secure3dsecuritylevel: '3D',
  hashparams: HASH_PARAMS,
  hashparamsval: '30691297ORDER3D1CAVVVALUE=02MDVALUE123RNDVALUE',
  hash: '2E3F98459F27F83DF8F2208C765130FEF3C4F5253605FA258A9112D53D58541CA9AD7EBCD3E719CC6F51AF2118C0799517D0D101B7179C5AB7DD191CFF06AFDF',
};

/** 3D_PAY model: the bank charged the card */
export const GARANTI_3DPAY_CALLBACK = {
  ...GARANTI_3D_CALLBACK,
  oid: 'ORDERPAY',
  orderid: 'ORDERPAY',
  authcode: '123456',
  procreturncode: '00',
  response: 'Approved',
  secure3dsecuritylevel: '3D_PAY',
  hashparamsval: '30691297ORDERPAY12345600Approved1CAVVVALUE=02MDVALUE123RNDVALUE',
  hash: 'BE6C74AF86901D3689C4A088CECF3597D8D6C696EC0E08652EEAF3A031372AC6F778553D53AC4BA8729D081C0A74B230B84379BC0682993DF3BC247D8D2E2F89',
};

/** GVPSResponse shaped like the test environment's answers */
export const garantiXml = (
  response: Record<string, string>,
  transaction: Record<string, string> = {},
  orderInquiry?: Record<string, string>
) => {
  const tags = (fields: Record<string, string>) =>
    Object.entries(fields)
      .map(([key, value]) => `<${key}>${value}</${key}>`)
      .join('');
  return (
    '<GVPSResponse><Mode></Mode><Terminal><ProvUserID>PROVAUT</ProvUserID><ID>30691297</ID></Terminal>' +
    '<Order><OrderID>ORDER</OrderID><GroupID></GroupID>' +
    (orderInquiry ? `<OrderInqResult>${tags(orderInquiry)}</OrderInqResult>` : '') +
    '</Order><Transaction><Response>' +
    tags({
      Source: 'HOST',
      ReasonCode: '',
      Message: '',
      ErrorMsg: '',
      SysErrMsg: '',
      ...response,
    }) +
    '</Response>' +
    tags({ RetrefNum: '', AuthCode: '', ProvDate: '20261011 14:45:51', ...transaction }) +
    '</Transaction></GVPSResponse>'
  );
};

export const GARANTI_APPROVED_XML = garantiXml(
  { Code: '00', ReasonCode: '00', Message: 'Approved' },
  { RetrefNum: '628408842186', AuthCode: '405119' }
);

export const garantiInquiryXml = (order: Record<string, string> = {}) =>
  garantiXml(
    { Source: 'GVPS', Code: '00', Message: 'Approved' },
    {},
    {
      ChargeType: 'S',
      AuthAmount: '120',
      Status: 'APPROVED',
      Code: '00',
      ReasonCode: '00',
      RetrefNum: '628408842186',
      ...order,
    }
  );
