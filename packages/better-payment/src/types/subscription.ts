import type { PaymentErrorCode } from '../core/error-codes';
/**
 * Subscription Types
 *
 * Types for the iyzico subscription payment system
 */

import { Address, PaymentCard, PaymentStatus } from './common';

/**
 * Subscription statuses
 */
export enum SubscriptionStatus {
  ACTIVE = 'ACTIVE',
  PENDING = 'PENDING',
  CANCELED = 'CANCELED',
  EXPIRED = 'EXPIRED',
  UNPAID = 'UNPAID',
}

/**
 * Payment interval types
 */
export enum PaymentInterval {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

/**
 * Subscription customer details
 */
export interface SubscriptionCustomer {
  name: string;
  surname: string;
  email: string;
  gsmNumber: string;
  identityNumber: string;
  billingAddress: Address;
  shippingAddress?: Address;
}

/**
 * Subscription initialization request
 */
export interface SubscriptionInitializeRequest {
  locale?: string;
  conversationId?: string;
  pricingPlanReferenceCode: string;
  subscriptionInitialStatus: SubscriptionStatus.ACTIVE | SubscriptionStatus.PENDING;
  customer: SubscriptionCustomer;
  paymentCard: PaymentCard;
}

/**
 * Subscription initialization response
 */
export interface SubscriptionInitializeResponse {
  status: PaymentStatus;
  systemTime?: number;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  data?: {
    referenceCode: string;
    parentReferenceCode?: string;
    pricingPlanReferenceCode: string;
    customerReferenceCode: string;
    subscriptionStatus: SubscriptionStatus;
    trialDays?: number;
    trialStartDate?: number;
    trialEndDate?: number;
    createdDate: number;
    startDate: number;
    endDate?: number;
  };
}

/**
 * Subscription cancellation request
 */
export interface SubscriptionCancelRequest {
  subscriptionReferenceCode: string;
}

/**
 * Subscription cancellation response
 */
export interface SubscriptionCancelResponse {
  status: PaymentStatus;
  systemTime?: number;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  data?: {
    referenceCode: string;
    subscriptionStatus: SubscriptionStatus;
  };
}

/**
 * Subscription upgrade request
 */
export interface SubscriptionUpgradeRequest {
  subscriptionReferenceCode: string;
  newPricingPlanReferenceCode: string;
  useTrial?: boolean;
  resetRecurrenceCount?: boolean;
}

/**
 * Subscription upgrade response
 */
export interface SubscriptionUpgradeResponse {
  status: PaymentStatus;
  systemTime?: number;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  data?: {
    referenceCode: string;
    pricingPlanReferenceCode: string;
    subscriptionStatus: SubscriptionStatus;
  };
}

/**
 * Subscription details request
 */
export interface SubscriptionRetrieveRequest {
  subscriptionReferenceCode: string;
}

/**
 * Subscription details response
 */
export interface SubscriptionRetrieveResponse {
  status: PaymentStatus;
  systemTime?: number;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  data?: {
    referenceCode: string;
    parentReferenceCode?: string;
    pricingPlanReferenceCode: string;
    pricingPlanName: string;
    customerReferenceCode: string;
    subscriptionStatus: SubscriptionStatus;
    trialDays?: number;
    trialStartDate?: number;
    trialEndDate?: number;
    createdDate: number;
    startDate: number;
    endDate?: number;
  };
}

/**
 * Card update request (via Checkout Form)
 */
export interface SubscriptionCardUpdateRequest {
  locale?: string;
  conversationId?: string;
  subscriptionReferenceCode: string;
  callbackUrl: string;
}

/**
 * Card update response
 */
export interface SubscriptionCardUpdateResponse {
  status: PaymentStatus;
  systemTime?: number;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  token?: string;
  checkoutFormContent?: string;
  tokenExpireTime?: number;
  paymentPageUrl?: string;
}

/**
 * Subscription product creation request
 */
export interface SubscriptionProductCreateRequest {
  locale?: string;
  conversationId?: string;
  name: string;
  description?: string;
}

/**
 * Subscription product response
 */
export interface SubscriptionProductResponse {
  status: PaymentStatus;
  systemTime?: number;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  data?: {
    referenceCode: string;
    name: string;
    description?: string;
    createdDate: number;
  };
}

/**
 * Pricing plan creation request
 */
export interface PricingPlanCreateRequest {
  locale?: string;
  conversationId?: string;
  productReferenceCode: string;
  name: string;
  price: string;
  currency?: string;
  paymentInterval: PaymentInterval;
  paymentIntervalCount: number;
  trialPeriodDays?: number;
  recurrenceCount?: number;
}

/**
 * Pricing plan response
 */
export interface PricingPlanResponse {
  status: PaymentStatus;
  systemTime?: number;
  /** Normalized error code, set on failures */
  code?: PaymentErrorCode;
  /** The provider's raw error code */
  errorCode?: string;
  errorMessage?: string;
  /** The original message when a plugin replaced `errorMessage` (e.g. `localizedErrors`) */
  providerMessage?: string;
  data?: {
    referenceCode: string;
    productReferenceCode: string;
    name: string;
    price: string;
    currency: string;
    paymentInterval: PaymentInterval;
    paymentIntervalCount: number;
    trialPeriodDays?: number;
    recurrenceCount?: number;
    createdDate: number;
  };
}
