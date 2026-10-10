---
"better-payment": patch
---

iyzico: a failed `completeThreeDSPayment()` result no longer carries `paymentId` or `conversationId` taken from the callback request or echoed by iyzico's error response. They are set only for a successful payment, from iyzico's response.

<!-- docs -->
en: iyzico: a failed 3D Secure result no longer carries a paymentId or conversationId taken from the callback request.
tr: iyzico: başarısız bir 3D Secure sonucu artık callback isteğinden alınan paymentId veya conversationId taşımıyor.
