# better-payment Katkı Rehberi

> English: [CONTRIBUTING.md](CONTRIBUTING.md)

better-payment projesine katkıda bulunmayı düşündüğünüz için teşekkür ederiz! Bu doküman, projeye nasıl katkıda bulunabileceğinizi açıklar.

## İçindekiler

- [Davranış Kuralları](#davranış-kuralları)
- [Nasıl Katkıda Bulunabilirim?](#nasıl-katkıda-bulunabilirim)
- [Geliştirme Ortamı Kurulumu](#geliştirme-ortamı-kurulumu)
- [Pull Request Süreci](#pull-request-süreci)
- [Kodlama Standartları](#kodlama-standartları)
- [Commit Mesajları](#commit-mesajları)
- [Yeni Provider Ekleme](#yeni-provider-ekleme)
- [Test Yazma](#test-yazma)
- [Dokümantasyon Çevirileri](#dokümantasyon-çevirileri)
- [Sürüm ve Yayın](#sürüm-ve-yayın)

## Davranış Kuralları

Bu proje ve topluluğu herkes için açık ve misafirperver bir deneyim sağlamayı taahhüt eder. Lütfen saygılı ve yapıcı olun. Tüm katılımcılar [Davranış Kuralları](CODE_OF_CONDUCT.md)'na uyar.

Güvenlik açıklarını asla herkese açık bir issue olarak bildirmeyin; [SECURITY.md](SECURITY.md)'deki gibi [gizli bildirim](https://github.com/czaydev/better-payment/security/advisories/new) kullanın.

## Nasıl Katkıda Bulunabilirim?

### Bug Raporlama

Bug bulduğunuzda lütfen bir issue açın ve aşağıdaki bilgileri ekleyin:

- Bug'ın detaylı açıklaması
- Hatayı yeniden oluşturma adımları
- Beklenen davranış
- Gerçek davranış
- Ortam bilgileri (Node.js versiyonu, işletim sistemi, vb.)
- Varsa hata mesajları ve stack trace

### Özellik Önerisi

Yeni özellik önerileri için:

1. Önce [Discussions](https://github.com/czaydev/better-payment/discussions) bölümünde önerinizi paylaşın
2. Topluluktan geri bildirim alın
3. Onaylandıktan sonra bir issue açın

### Dokümantasyon

Dokümantasyon iyileştirmeleri her zaman değerlidir:

- README.md güncellemeleri
- Kod yorumları
- Örnek kodlar
- Kullanım kılavuzları

## Geliştirme Ortamı Kurulumu

### Gereksinimler

- Node.js 20.x veya üzeri
- pnpm 10.x (sürüm kök `package.json` içindeki `packageManager` alanıyla sabitlenmiştir; `corepack enable` yeterlidir)

### Kurulum Adımları

1. Repository'yi fork edin

2. Fork'unuzu klonlayın:
```bash
git clone https://github.com/KULLANICI_ADINIZ/better-payment.git
cd better-payment
```

3. Upstream remote'u ekleyin:
```bash
git remote add upstream https://github.com/czaydev/better-payment.git
```

4. Bağımlılıkları yükleyin:
```bash
pnpm install
```

5. Paketi derleyin ve kontrolleri çalıştırın (CI'ın çalıştırdığı komutların aynısı):
```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

6. Doküman sitesini yerelde açmak için (`apps/web`):
```bash
pnpm dev
```

Testler provider'lara gerçek istek atmaz. Sandbox'ta denemek isterseniz kendi
test hesabı bilgilerinizi ortam değişkenleriyle verin ve `mode: 'sandbox'` kullanın.

## Pull Request Süreci

1. **Branch Oluşturun**
```bash
git checkout -b feature/amazing-feature
# veya
git checkout -b fix/bug-description
```

Branch isimlendirme kuralları:
- `feature/` - Yeni özellikler için
- `fix/` - Bug düzeltmeleri için
- `docs/` - Dokümantasyon güncellemeleri için
- `refactor/` - Kod yeniden yapılandırma için
- `test/` - Test güncellemeleri için
- `chore/` - Diğer değişiklikler için

2. **Değişikliklerinizi Yapın**
- Kodlama standartlarına uyun
- Test yazın
- Dokümantasyon güncelleyin

3. **Commit Edin**
```bash
git add .
git commit -m "feat: Add amazing feature"
```

4. **Pull Request Açın**
- Branch'inizi fork'unuza push edin
- GitHub'da Pull Request açın
- Değişiklikleri ve test sonuçlarını açıklayın
- Kullanıcıyı etkileyen her değişiklik için `pnpm changeset` ile bir changeset ekleyin

5. **Code Review**
- Geri bildirimlere yanıt verin
- Gerekli değişiklikleri yapın
- CI/CD pipeline'ının geçmesini sağlayın

## Kodlama Standartları

### TypeScript

- Strict mode kullanın
- Her zaman tip tanımlamaları yapın
- `any` kullanmaktan kaçının
- Interface'leri tercih edin

```typescript
// İyi ✅
interface PaymentConfig {
  apiKey: string;
  secretKey: string;
}

function createPayment(config: PaymentConfig): Promise<PaymentResponse> {
  // ...
}

// Kötü ❌
function createPayment(config: any) {
  // ...
}
```

### Kod Formatı

Prettier ve ESLint otomatik olarak çalışır:

```bash
# Format kontrolü
pnpm format:check

# Format uygula
pnpm format

# Lint kontrolü
pnpm lint
```

### İsimlendirme Kuralları

- **Dosyalar**: kebab-case (`payment-provider.ts`)
- **Sınıflar**: PascalCase (`PaymentProvider`)
- **Fonksiyonlar**: camelCase (`createPayment`)
- **Sabitler**: UPPER_SNAKE_CASE (`API_VERSION`)
- **Interface'ler**: PascalCase, "I" prefix kullanmayın (`PaymentRequest`)

### Error Handling

```typescript
// İyi ✅
try {
  const result = await provider.createPayment(request);
  return result;
} catch (error) {
  if (error instanceof PaymentError) {
    // Spesifik hata işleme
  }
  throw new PaymentError('Payment failed', error);
}

// Kötü ❌
try {
  const result = await provider.createPayment(request);
  return result;
} catch (e) {
  console.log(e);
}
```

## Commit Mesajları

[Conventional Commits](https://www.conventionalcommits.org/) standardını kullanıyoruz.

### Format

```
<tip>(<kapsam>): <kısa açıklama>

<detaylı açıklama (opsiyonel)>

<footer (opsiyonel)>
```

### Tipler

- `feat`: Yeni özellik
- `fix`: Bug düzeltme
- `docs`: Dokümantasyon değişiklikleri
- `style`: Kod formatı değişiklikleri
- `refactor`: Kod yeniden yapılandırma
- `test`: Test ekleme veya düzeltme
- `chore`: Build, CI/CD vb. değişiklikler
- `perf`: Performans iyileştirmeleri

### Örnekler

```bash
# Yeni özellik
git commit -m "feat(iyzico): Add installment support"

# Bug düzeltme
git commit -m "fix(paytr): Fix token generation issue"

# Dokümantasyon
git commit -m "docs: Update installation instructions"

# Breaking change
git commit -m "feat(core)!: Change API response structure

BREAKING CHANGE: Response structure changed from {data} to {result}"
```


## Yeni Provider Ekleme

### 1. Klasör Yapısı

```
src/providers/your-provider/
├── index.ts   # Provider sınıfı ve config tipi
├── types.ts   # Provider'a özgü istek/yanıt tipleri
└── utils.ts   # İmza, format ve eşleme yardımcıları
tests/unit/providers/your-provider/
├── index.test.ts
└── utils.test.ts
```

### 2. Config Tipi ve Doğrulama

Her provider yalnızca gerçekten kullandığı kimlik bilgilerini ister. Eksik alanlar
constructor'da `ConfigurationError` ile bildirilir.

```typescript
// src/providers/your-provider/index.ts
import { PaymentProvider, PaymentProviderConfig } from '../../core/PaymentProvider';
import { ConfigurationError } from '../../core/errors';

export interface YourProviderConfig extends PaymentProviderConfig {
  merchantId: string;
  secretKey: string;
}

export class YourProvider extends PaymentProvider<YourProviderConfig> {
  protected validateConfig(): void {
    const missing = (['merchantId', 'secretKey'] as const).filter((k) => !this.config[k]);
    if (missing.length > 0) {
      throw new ConfigurationError(`YourProvider configuration is missing: ${missing.join(', ')}`, 'your-provider');
    }
  }

  // createPayment, initThreeDSPayment, completeThreeDSPayment,
  // refund, cancel, getPayment
}
```

### 3. Uyulması Gereken Kurallar

- **Callback'lere güvenmeyin.** `completeThreeDSPayment` imzayı yalnızca config'teki
  gizli anahtarla doğrulamalı (`safeEqual` ile, sabit zamanlı), eksik alanlarda
  asla başarı dönmemeli ve provider bir kesinleştirme/provizyon adımı istiyorsa onu çağırmalı.
- **Durumlar:** `success` yalnızca provider onayladığında; ağ hatası ve timeout
  `pending` + `errorCode: 'NETWORK_ERROR'` (bkz. `isNetworkError`).
- **Retry:** ödeme/iade/iptal istekleri asla tekrar edilmez; salt-okunur sorgular
  `retryable: true` ile işaretlenebilir.
- **Kimlikler:** `paymentId` iade/iptal/sorguda kullanılabilecek değer olmalı
  (genelde sipariş no; yoksa `generateOrderId()`).
- **Tutarlar:** `formatDecimal` / `toMinorUnits` kullanın, float çarpımı yapmayın.
  Desteklenmeyen para birimini sessizce TRY'ye çevirmeyin, hata verin.
- **Loglama:** istek/yanıt gövdesi (kart, anahtar) asla loglanmaz.

### 4. Testler

- İmza fonksiyonlarını mümkünse provider dokümanındaki ya da güvenilir bir
  referans implementasyondaki **test vektörleriyle** doğrulayın.
- HTTP istemcisini mock'layıp gönderilen isteğin alanlarını ve imzasını kontrol edin.
- Sahte/değiştirilmiş callback'lerin reddedildiğini test edin.

### 5. Kayıt

- `src/core/BetterPaymentConfig.ts`: `ProviderType` ve `PROVIDER_DEFAULT_URLS`
  (sandbox/production)
- Provider dosyasında bir fabrika fonksiyonu (`export const xbank = (config) =>
  defineProvider(...)`); mevcut provider'lardaki gibi `withProviderDefaults` kullanın
- `src/index.ts`: sınıf, fabrika fonksiyonu ve tip export'ları

Provider ekleme adımları [Özel sağlayıcılar](https://better-payment.czaylabs.com/tr/docs/guides/custom-providers)
sayfasında da anlatılıyor. Yeni bir özellik çekirdeğe mi yoksa bir plugin'e mi
ait, emin değilseniz önce bir issue açın: sağlayıcıdan bağımsız davranışlar
(yönlendirme, bildirimler, hata mesajı çevirileri) plugin olarak yazılır. Bkz.
[Plugin yazmak](https://better-payment.czaylabs.com/tr/docs/guides/writing-plugins).

### 6. Dokümantasyon

- `apps/web/content/docs/` altına provider sayfası ekleyin ve `meta.json`'a kaydedin
- README'deki provider tablosunu güncelleyin

## Test Yazma

### Test Yapısı

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('Feature Name', () => {
  beforeEach(() => {
    // Setup
  });

  it('should handle success case', async () => {
    // Arrange
    const provider = new Provider(config);
    const request = createTestRequest();

    // Act
    const result = await provider.method(request);

    // Assert
    expect(result.status).toBe('success');
    expect(result).toHaveProperty('paymentId');
  });

  it('should handle error case', async () => {
    // Test error scenarios
  });
});
```

### Test Çalıştırma

```bash
# Tüm testler
pnpm test

# Watch mode
pnpm test:watch

# UI ile
pnpm test:ui

# Coverage (eşikler vitest.config.ts içinde)
pnpm test:coverage

# Sağlayıcı test ortamları (bkz. Sandbox Testleri)
pnpm test:sandbox
```

### Test Coverage

Minimum %80 test coverage hedefleyin:
- Tüm public metodlar test edilmeli
- Error case'ler test edilmeli
- Edge case'ler test edilmeli

### Sandbox Testleri

`tests/sandbox/` altındaki testler sağlayıcıların gerçek test ortamlarına istek atar.
Normal `pnpm test` bu testleri çalıştırmaz. Bir sağlayıcının kimlik bilgileri
tanımlı değilse o sağlayıcının testleri atlanır, dolayısıyla komut her yerde güvenle
çalıştırılabilir.

```bash
IYZICO_SANDBOX_API_KEY=... IYZICO_SANDBOX_SECRET_KEY=... pnpm test:sandbox
```

| Sağlayıcı | Zorunlu değişkenler | Opsiyonel |
| --------- | ------------------- | --------- |
| iyzico    | `IYZICO_SANDBOX_API_KEY`, `IYZICO_SANDBOX_SECRET_KEY` | `IYZICO_SANDBOX_CARD_*` (varsayılan: iyzico test kartı `5528790000000008`) |
| PayTR     | `PAYTR_SANDBOX_MERCHANT_ID`, `PAYTR_SANDBOX_MERCHANT_KEY`, `PAYTR_SANDBOX_MERCHANT_SALT` | `PAYTR_SANDBOX_CARD_NUMBER` (BIN/taksit sorgusu için) |
| Parampos  | `PARAMPOS_SANDBOX_CLIENT_CODE`, `PARAMPOS_SANDBOX_CLIENT_USERNAME`, `PARAMPOS_SANDBOX_CLIENT_PASSWORD`, `PARAMPOS_SANDBOX_GUID` | `PARAMPOS_SANDBOX_BASE_URL`, `PARAMPOS_SANDBOX_CARD_*` |
| Akbank    | `AKBANK_SANDBOX_MERCHANT_SAFE_ID`, `AKBANK_SANDBOX_TERMINAL_SAFE_ID`, `AKBANK_SANDBOX_SECRET_KEY` | `AKBANK_SANDBOX_CARD_*` |

Kart değişkenleri: `<PREFIX>_CARD_NUMBER`, `<PREFIX>_CARD_EXPIRE_MONTH`,
`<PREFIX>_CARD_EXPIRE_YEAR`, `<PREFIX>_CARD_CVC`, `<PREFIX>_CARD_HOLDER`
(örnek: `AKBANK_SANDBOX_CARD_NUMBER`). Parampos ve Akbank'ta ödeme/iptal/iade
testleri yalnızca test kartı tanımlıysa çalışır. Test kartları test hesabıyla
birlikte verilir.

`SANDBOX_RECORD=1` verildiğinde sağlayıcı yanıtları maskelenerek
`tests/fixtures/recorded/<sağlayıcı>/` altına yazılır: sırlar, kişisel veriler
ve kart numaraları maskelenir. Bu dosyalar contract testleri için kullanılır. Commit
etmeden önce içeriklerini kontrol edin.

CI'da `.github/workflows/sandbox.yml` her gece ve elle tetiklendiğinde çalışır.
Değişkenler aynı isimlerle repository secret olarak tanımlanır. Elle tetiklerken
`record` seçeneği işaretlenirse kaydedilen yanıtlar workflow artifact'ı olarak
yüklenir.

## Dokümantasyon Çevirileri

Web sitesi ve dokümantasyon İngilizce (varsayılan, `/docs/...`) ve Türkçe (`/tr/docs/...`) yayınlanır. Her `content/docs/<yol>.mdx` sayfasının bir `<yol>.tr.mdx` çevirisi, her `meta.json`'ın bir `meta.tr.json`'ı vardır. Ana sayfa metinleri `apps/web/lib/i18n/dictionary.ts` içindedir.

- Yalnızca metin çevrilir; kod blokları İngilizce sayfayla birebir aynı kalır.
- Başlık yapısı aynı kalır ve her Türkçe başlık İngilizce başlığın id'sini taşır (`## Taksit [#installments]`).
- Bir İngilizce sayfayı değiştirdiğinizde Türkçesini aynı PR'da güncelleyin.
- Terimler için sözlüğe uyun (ön provizyon, taksit, sanal POS, …).

Kurallar ve terim sözlüğü: [apps/web/TRANSLATIONS.md](apps/web/TRANSLATIONS.md). CI şu kontrolü çalıştırır:

```bash
cd apps/web
node scripts/check-translations.mjs        # eksik çeviri, farklı kod bloğu, başlık id'leri
node scripts/check-translations.mjs --fix  # başlık id'lerini ekler
```

**Hata mesajı dilleri** (`localizedErrors`), `packages/better-payment/src/plugins/localized-errors/` altında her dil için bir dosyadır. Mesajları müşteriye doğal gelecek şekilde yazın. Paket boyutu kontrolüne (`pnpm --filter better-payment size`) sığdırmak için asla kısaltmayın: yeni bir dil sınırı aşarsa PR'da belirtin, sınırı bakımcılar yükseltir.

## Sürüm ve Yayın

Proje [Changesets](https://github.com/changesets/changesets) kullanır.

1. Kullanıcıyı etkileyen her PR bir changeset içerir: `pnpm changeset`.
2. Sürüm hazırlanırken `pnpm run version` changeset'leri `package.json` sürümüne ve
   `CHANGELOG.md`'ye işler; bu değişiklik bir PR ile main'e alınır.
3. Yayın, GitHub Actions'taki **Publish to NPM** workflow'u ile elle başlatılır
   (`npm_tag` genelde `latest`). Workflow lint, typecheck ve testleri çalıştırır,
   ardından npm **trusted publishing** (OIDC) ile yayınlar; npm token gerekmez ve
   paket provenance kaydıyla yayınlanır.

Sürüm geçmişi `0.0.1` ile sıfırlandı; `0.x` boyunca kırıcı değişiklikler minor
sürümle yayınlanır ve changelog'da geçiş notuyla belirtilir.

## Sorular ve Destek

- 📖 [Dokümantasyon](https://better-payment.czaylabs.com)
- 🐛 [Issues](https://github.com/czaydev/better-payment/issues)
- 💬 [Discussions](https://github.com/czaydev/better-payment/discussions)

## Lisans

Katkıda bulunarak, değişikliklerinizin MIT Lisansı altında lisanslanmasını kabul etmiş olursunuz.

---

Tekrar teşekkürler! Katkılarınız better-payment'ı daha iyi hale getiriyor. ❤️
