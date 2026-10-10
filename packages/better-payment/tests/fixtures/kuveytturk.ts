// Kuveyt Türk KT Pay Gate fixtures. Response shapes as returned by the
// KT Pay Gate test environment; ids and amounts are made up.
export const KUVEYTTURK_TEST = {
  merchantId: '12345',
  customerId: '67890',
  username: 'apiuser',
  password: 'secret123',
};

export const KUVEYTTURK_BASE_URL = 'https://boatest.kuveytturk.com.tr/boa.virtualpos.services';

/** Payment rejected before 3D: the bank answers with a form posting to failUrl */
export const KUVEYTTURK_PAYMENT_REJECTED_HTML = `
            <form name="responseForm" action="https://shop.test/payment/fail" method="POST">
                <input type="hidden" name="Success" value="False" />
                <input type="hidden" name="ResponseCode" value="HashDataError" />
                <input type="hidden" name="ResponseMessage" value="Şifrelenen veriler (Hashdata) uyuşmamaktadır." />
                <input type="hidden" name="BusinessKey" value="" />
                <input type="hidden" name="TransactionTime" value="1791604497" />
            </form>
            <script type="text/javascript">document.responseForm.submit();</script>`;

/** Payment accepted: the bank answers with its 3D Secure page */
export const KUVEYTTURK_PAYMENT_3D_HTML = `<html><body onload="document.forms[0].submit()">
<form action="https://acs.example-bank.test/challenge" method="POST">
<input type="hidden" name="PaReq" value="eJxVUttugkAQ" />
<input type="hidden" name="TermUrl" value="https://boatest.kuveytturk.com.tr/term" />
<input type="hidden" name="MD" value="abc+/=" />
</form></body></html>`;

/** successUrl POST after a successful card verification */
export const KUVEYTTURK_CALLBACK = {
  Success: 'True',
  ResponseCode: '00',
  ResponseMessage: 'Kart doğrulandı.',
  MD: 'mdValue+/=',
  OrderId: '334210503',
  MerchantOrderId: 'ORDER3D',
  BusinessKey: '202610109999000000002137378',
  TransactionTime: '1791604509',
};

export const kuveytTurkTransaction = (overrides: Record<string, unknown> = {}) => ({
  MerchantId: 12345,
  PosTerminalId: 'VP000001',
  OrderId: 334210503,
  MerchantOrderId: 'ORDER3D',
  CardNumber: '979216****8083',
  CardType: 'Troy',
  TransactionTime: '2026-10-10T13:43:48.133',
  IsCancellable: 1,
  IsRefundable: 0,
  IsPartialRefundable: 0,
  OrderStatus: 'Satış (1)',
  LastOrderStatus: 'Satış (1)',
  OrderType: 'Peşin (1)',
  TransactionStatus: 'Başarılı (1)',
  FirstAmount: 120,
  DrawbackAmount: 0,
  CancelAmount: 0,
  ClosedAmount: 0,
  FEC: 'TRY (0949)',
  InstallmentCount: 0,
  TransactionSecurity: '3d İşlem (3)',
  ResponseCode: '00',
  ResponseExplain: '',
  ProvisionNumber: '123456',
  ...overrides,
});

export const kuveytTurkResponse = (overrides: Record<string, unknown> = {}) => ({
  Result: null,
  Success: true,
  ResponseCode: 'Successfull',
  ResponseMessage: 'İşleminiz başarıyla gerçekleştirildi.',
  BusinessKey: '202610109999000000002129515',
  TransactionTime: 1791604558,
  ...overrides,
});

export const kuveytTurkTransactions = (...transactions: Record<string, unknown>[]) =>
  kuveytTurkResponse({ Result: { Transactions: transactions } });
