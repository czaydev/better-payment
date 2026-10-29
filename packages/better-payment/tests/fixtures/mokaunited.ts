/** Made-up Moka United dealer for unit tests */
export const MOKAUNITED_TEST = {
  dealerCode: 'DEALER1',
  username: 'apiuser',
  password: 'apipass',
};

export const MOKAUNITED_BASE_URL = 'https://service.refmokaunited.com';

/** The envelope Moka United answers with (developer.mokaunited.com) */
export const mokaOk = (data: Record<string, unknown>) => ({
  Data: data,
  ResultCode: 'Success',
  ResultMessage: '',
  Exception: null,
});

export const mokaError = (resultCode: string) => ({
  Data: null,
  ResultCode: resultCode,
  ResultMessage: '',
  Exception: null,
});

/** GetDealerPaymentTrxDetailList answer for an order */
export const mokaDetail = (
  detail: Record<string, unknown> = {},
  trx: Array<Record<string, unknown>> = [
    { TrxType: 2, TrxStatus: 1, Amount: 1.2, VirtualPosOrderId: 'ORDER-17131QQFG04026575' },
  ]
) =>
  mokaOk({
    IsSuccessful: true,
    ResultCode: '00',
    ResultMessage: '',
    PaymentDetail: {
      DealerPaymentId: 27405,
      OtherTrxCode: 'ORDERMU',
      Amount: 1.2,
      RefAmount: 0,
      CurrencyCode: 'TL',
      InstallmentNumber: 0,
      IsThreeD: true,
      PaymentStatus: 2,
      TrxStatus: 1,
      ...detail,
    },
    ListItemCount: trx.length,
    PaymentTrxDetailList: trx,
  });
