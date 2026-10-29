import type { ProviderSlug } from "@/lib/providers-data";

/** Logo files live in public/; `dark` marks logos drawn for light backgrounds (they get a light tile in dark mode) */
export interface ProviderMeta {
  logo: string;
  w: number;
  h: number;
  protocol: string;
  auth: string;
  threeDs: { tr: string; en: string };
  tagline: { tr: string; en: string };
}

const EST = { protocol: "EST (Nestpay) XML", auth: "HASH ver3 · SHA-512" };

export const PROVIDER_META: Record<ProviderSlug, ProviderMeta> = {
  iyzico: {
    logo: "/iyzico.svg", w: 120, h: 40, protocol: "REST · JSON", auth: "HMAC imzası",
    threeDs: { tr: "Yönlendirmeli 3D Secure", en: "Redirect 3D Secure" },
    tagline: { tr: "Pazar yeri ve taksit odaklı ödeme kuruluşu", en: "Marketplace and installment-first gateway" },
  },
  paytr: {
    logo: "/paytr.svg", w: 120, h: 40, protocol: "iFrame · token", auth: "HMAC-SHA256",
    threeDs: { tr: "iFrame içinde 3D Secure", en: "3D Secure inside an iFrame" },
    tagline: { tr: "iFrame ve doğrudan API ile ödeme", en: "iFrame and direct API checkout" },
  },
  sipay: {
    logo: "/brand/institutions/sipay.svg", w: 140, h: 68, protocol: "REST · JSON", auth: "Token + hash_key",
    threeDs: { tr: "3D Secure ve Non-3D", en: "3D Secure and Non-3D" },
    tagline: { tr: "Cüzdan ve tekrarlayan ödemeler", en: "Wallet and recurring payments" },
  },
  parampos: {
    logo: "/param.svg", w: 120, h: 40, protocol: "SOAP · XML", auth: "islemHash",
    threeDs: { tr: "3D Secure ve Non-3D", en: "3D Secure and Non-3D" },
    tagline: { tr: "TurkPOS ile kurumsal sanal POS", en: "Enterprise virtual POS via TurkPOS" },
  },
  akbank: {
    logo: "/akbank.svg", w: 75, h: 38, protocol: "JSON API", auth: "HMAC-SHA512",
    threeDs: { tr: "3D Secure, hash imzalı callback", en: "3D Secure, signed callback" },
    tagline: { tr: "Yeni nesil sanal POS", en: "Next-generation virtual POS" },
  },
  kuveytturk: {
    logo: "/brand/banks/kuveyt-turk.svg", w: 227, h: 41, protocol: "KT Pay Gate · JSON", auth: "HMAC-SHA512",
    threeDs: { tr: "3D Secure + provizyon", en: "3D Secure + provision" },
    tagline: { tr: "Katılım bankası sanal POS", en: "Participation bank virtual POS" },
  },
  isbank: {
    logo: "/brand/banks/is-bankasi.svg", w: 157, h: 49, ...EST,
    threeDs: { tr: "3d / 3d_pay / 3d_pay_hosting", en: "3d / 3d_pay / 3d_pay_hosting" },
    tagline: { tr: "EST altyapılı sanal POS", en: "EST-based virtual POS" },
  },
  halkbank: {
    logo: "/brand/banks/halkbank.svg", w: 512, h: 99, ...EST,
    threeDs: { tr: "3d / 3d_pay / 3d_pay_hosting", en: "3d / 3d_pay / 3d_pay_hosting" },
    tagline: { tr: "EST altyapılı sanal POS", en: "EST-based virtual POS" },
  },
  ziraat: {
    logo: "/brand/banks/ziraat.svg", w: 142, h: 27, ...EST,
    threeDs: { tr: "3d / 3d_pay / 3d_pay_hosting", en: "3d / 3d_pay / 3d_pay_hosting" },
    tagline: { tr: "EST altyapılı sanal POS", en: "EST-based virtual POS" },
  },
  teb: {
    logo: "/brand/banks/teb.png", w: 971, h: 421, ...EST,
    threeDs: { tr: "3d / 3d_pay / 3d_pay_hosting", en: "3d / 3d_pay / 3d_pay_hosting" },
    tagline: { tr: "EST altyapılı sanal POS", en: "EST-based virtual POS" },
  },
  sekerbank: {
    logo: "/brand/docs-logos/banks-sekerbank.png", w: 200, h: 60, ...EST,
    threeDs: { tr: "3d / 3d_pay / 3d_pay_hosting", en: "3d / 3d_pay / 3d_pay_hosting" },
    tagline: { tr: "EST altyapılı sanal POS", en: "EST-based virtual POS" },
  },
};
