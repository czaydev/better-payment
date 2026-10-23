import type { PaymentProvider } from './PaymentProvider';
import type {
  ApprovePayoutRequest,
  CreateSubMerchantRequest,
  PayoutResponse,
  RetrieveSubMerchantRequest,
  SubMerchantResponse,
  UpdateSubMerchantRequest,
} from '../types';

/**
 * The marketplace (split payment) methods of a provider, as
 * `payment.iyzico.marketplace.*`.
 *
 * On the payment object the calls go through the plugin hooks and events of the
 * matching operations; providers without a marketplace API throw `NOT_SUPPORTED`.
 */
export class MarketplaceClient {
  constructor(private readonly provider: PaymentProvider) {}

  /** Registers a seller; the result carries the `subMerchantKey` for basket items */
  createSubMerchant(request: CreateSubMerchantRequest): Promise<SubMerchantResponse> {
    return this.provider.createSubMerchant(request);
  }

  /** Updates a registered seller */
  updateSubMerchant(request: UpdateSubMerchantRequest): Promise<SubMerchantResponse> {
    return this.provider.updateSubMerchant(request);
  }

  /** Looks a seller up by your own `externalId` */
  retrieveSubMerchant(request: RetrieveSubMerchantRequest): Promise<SubMerchantResponse> {
    return this.provider.retrieveSubMerchant(request);
  }

  /** Releases one seller's share of a paid basket item */
  approvePayout(request: ApprovePayoutRequest): Promise<PayoutResponse> {
    return this.provider.approvePayout(request);
  }

  /** Takes back an approval before the seller is paid out */
  disapprovePayout(request: ApprovePayoutRequest): Promise<PayoutResponse> {
    return this.provider.disapprovePayout(request);
  }
}
