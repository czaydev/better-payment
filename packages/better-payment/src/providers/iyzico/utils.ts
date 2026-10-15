import { digest, hmac, toBase64, toHex } from '../../core/crypto';
import { VERSION } from '../../version';

/**
 * Generates an iyzico V2 authorization header
 * Following the official iyzico-node SDK algorithm
 */
export async function generateIyzicoAuthStringV2(
  apiKey: string,
  secretKey: string,
  randomString: string,
  uri: string,
  requestBody: string
): Promise<string> {
  // 1. Create the signature: HMAC-SHA256(randomString + uri + requestBody)
  const signature = toHex(await hmac('SHA-256', secretKey, randomString + uri + requestBody));

  // 2. Combine the authorization parameters
  const authorizationParams = [
    `apiKey:${apiKey}`,
    `randomKey:${randomString}`,
    `signature:${signature}`,
  ];

  // 3. Base64 encode et
  const base64Auth = toBase64(authorizationParams.join('&'));

  return `IYZWSv2 ${base64Auth}`;
}

/**
 * Generates an iyzico V1 authorization header (fallback)
 */
export async function generateIyzicoAuthStringV1(
  apiKey: string,
  secretKey: string,
  randomString: string,
  pkiString: string
): Promise<string> {
  const dataToEncrypt = apiKey + randomString + secretKey + pkiString;
  const hash = toBase64(await digest('SHA-1', dataToEncrypt));
  return `IYZWS ${apiKey}:${hash}`;
}

/**
 * Generates a random string
 */
export function generateRandomString(): string {
  // Format compatible with the iyzico SDK: timestamp + random
  return Date.now() + Math.random().toString(36).slice(2);
}

/**
 * Creates headers for an iyzico API request
 */
export async function createIyzicoHeaders(
  apiKey: string,
  secretKey: string,
  uri: string,
  requestBody: string,
  pkiString?: string
): Promise<Record<string, string>> {
  const randomString = generateRandomString();
  const authStringV2 = await generateIyzicoAuthStringV2(
    apiKey,
    secretKey,
    randomString,
    uri,
    requestBody
  );

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: authStringV2,
    'x-iyzi-rnd': randomString,
    'x-iyzi-client-version': `better-payment-${VERSION}`,
  };

  // V1 fallback header ekle (iyzico bazen bunu da kontrol eder)
  if (pkiString) {
    headers['Authorization_Fallback'] = await generateIyzicoAuthStringV1(
      apiKey,
      secretKey,
      randomString,
      pkiString
    );
  }

  return headers;
}
