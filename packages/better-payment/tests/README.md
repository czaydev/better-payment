# Testing Guide

Better Payment testlerinin yapısı ve çalıştırma rehberi. Kurulum için [katkı rehberine](../../../CONTRIBUTING.tr.md) bakın.

## Test Klasör Yapısı

Bu ağaç `packages/better-payment/` altındadır. Unit test dosyaları yerine test grupları gösterilmiştir.

```text
tests/
├── unit/
│   ├── adapters/              # Framework adapter'ları
│   ├── client/                # Tarayıcı istemcisi
│   ├── core/                  # Ödeme, handler, doğrulama, sepet ve hata mantığı
│   ├── examples/              # Özel provider örneği
│   ├── plugins/               # localizedErrors
│   ├── providers/             # iyzico, PayTR, Parampos, Akbank ve ortak işlemler
│   ├── testing/               # MockProvider
│   ├── sandbox-redact.test.ts # Sandbox kayıtlarının hassas veri temizliği
│   └── version.test.ts        # Paket sürümü
├── integration/
│   ├── core/
│   │   └── multi-provider.test.ts
│   └── providers/
│       └── iyzico.test.ts
├── sandbox/
│   ├── akbank.sandbox.test.ts
│   ├── iyzico.sandbox.test.ts
│   ├── parampos.sandbox.test.ts
│   ├── paytr.sandbox.test.ts
│   └── setup.ts               # Ortam değişkenleri, test verisi ve kayıt yardımcıları
├── fixtures/
│   ├── akbank.ts
│   ├── parampos-installments.ts
│   ├── payment-data.ts
│   ├── provider-responses.ts
│   └── subscription-data.ts
└── helpers/
    ├── fake-payment.ts
    └── request-validator.ts
```

## Test Türleri

### Unit testler

`tests/unit/`, fonksiyonları ve bileşenleri izole olarak test eder. Provider testlerinde sahte `fetch`, mock yanıtlar veya HTTP istemcisi stub'ları kullanılır. Core akışlarında `MockProvider` ve ortak test yardımcıları kullanılabilir. Gerçek provider API'lerine istek gönderilmez.

### Integration testler

`tests/integration/core/multi-provider.test.ts`, birden fazla provider ile çalışan core akışlarını test eder. `tests/integration/providers/iyzico.test.ts`, HTTP istemcisinin `request` metodunu mock'layarak üretilen endpoint, header ve gövdeyi yakalar. Yanıtlar da sahtedir; integration testler ağ erişimi veya credential gerektirmez.

Bu testlerde yalnızca başarılı sonucu değil, gönderilecek isteğin formatını ve alan eşlemesini de doğrulayın. Güncel iyzico yetkilendirme örnekleri için [mevcut integration testini](integration/providers/iyzico.test.ts) kullanın.

### Sandbox testleri

`tests/sandbox/`, provider'ların gerçek test ortamlarına bağlanır. Normal test çalıştırmasına dahil değildir; ayrı [Vitest yapılandırması](../vitest.sandbox.config.ts) ile çalışır. Gerekli ortam değişkenleri bulunmayan provider suite'leri atlanır.

Credential ve test kartı gereksinimleri [Sandbox Testleri](../../../CONTRIBUTING.tr.md#sandbox-testleri) bölümündedir. Yalnızca test ortamı verilerini kullanın. `SANDBOX_RECORD=1` ile açılan kayıt modu, hassas verileri temizlenmiş yanıtları `tests/fixtures/recorded/` altına yazar; bu klasör gerektiğinde oluşturulur.

## Test Çalıştırma

Aşağıdaki komutları repository kökünden çalıştırın:

```bash
# Unit ve integration testlerini bir kez çalıştırır, sandbox hariçtir
pnpm test

# Yalnızca unit veya integration testlerini bir kez çalıştırır
pnpm --filter better-payment test:unit --run
pnpm --filter better-payment test:integration --run

# Coverage raporu ve yapılandırılmış eşikler
pnpm --filter better-payment test:coverage

# Watch mode
pnpm --filter better-payment test:watch

# Aynı testleri edge-runtime ortamında çalıştırır
pnpm --filter better-payment test:edge

# Gerçek provider sandbox'ları, gerekli ortam değişkenleri ayarlandıktan sonra
pnpm --filter better-payment test:sandbox
```

`test:unit` ve `test:integration` komutlarında `--run`, yerel çalıştırmanın watch mode'a geçmesini önler. Paket klasöründeyseniz `--filter better-payment` kısmını çıkarabilirsiniz.

## Yeni Test Yazarken

1. Mevcut bir test grubunda `*.test.ts` dosyası oluşturun ve benzer testin kurulumunu izleyin.
2. Paylaşılan istek ve yanıt verileri için `fixtures/`, test yardımcıları için `helpers/` klasörlerini kullanın. Gerçek credential, müşteri veya kart verisi eklemeyin.
3. Unit ve integration testlerinde ağ çağrılarını sahte `fetch`, stub veya `MockProvider` ile karşılayın. Gerçek sandbox çağrıları yalnızca ayrı sandbox suite'lerinde bulunmalıdır.
4. Başarılı senaryoya ek olarak ilgili hata, timeout ve geçersiz girdi yollarını doğrulayın. Callback ve imza testlerinde sahte veya eksik imzaların reddedildiğini kontrol edin.
5. Testler arasında mock, spy ve global değişiklikleri temizleyin. Testlerin çalışma sırasına bağımlı olmayın.

Örnek alınabilecek dosyalar:

- [iyzico unit testleri](unit/providers/iyzico/index.test.ts)
- [iyzico istek formatı testleri](integration/providers/iyzico.test.ts)
- [Çoklu provider testleri](integration/core/multi-provider.test.ts)
- [MockProvider testleri](unit/testing/mock-provider.test.ts)

## Coverage

Coverage eşiklerinin kaynağı [vitest.config.ts](../vitest.config.ts) içindeki `coverage.thresholds` ayarıdır. `pnpm --filter better-payment test:coverage` bu eşikleri uygular ve `packages/better-payment/coverage/` altında rapor üretir. Yeni test eklerken kapsamı koruyun; eşikleri yalnızca mevcut değerleri doğruladıktan sonra güncelleyin.

## CI

[CI workflow'u](../../../.github/workflows/ci.yml), `main` push'larında ve pull request'lerde Node.js 20, 22 ve 24 üzerinde coverage eşikleriyle testleri ve edge-runtime suite'ini çalıştırır. Ayrıca lint, format, typecheck, örneklerin typecheck'i, build, paket boyutu ve build çıktılarının smoke kontrolleri vardır.

[Sandbox workflow'u](../../../.github/workflows/sandbox.yml) upstream repository'de gecelik veya manuel çalışır. Gerekli secret'ları bulunmayan provider suite'leri atlanır. Kayıt seçeneği açıkken temizlenmiş yanıtlar workflow artifact'i olarak yüklenir.
