import { createSign, randomBytes, timingSafeEqual, pbkdf2Sync } from 'crypto';

type ServiceAccount = {
  projectId: string;
  clientEmail: string;
  privateKey: string;
};

type FirestoreDocument<T = any> = {
  id: string;
  name: string;
  data: T;
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

const base64Url = (value: string | Buffer) =>
  Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

const signJwt = (payload: Record<string, any>, privateKey: string) => {
  const header = { alg: 'RS256', typ: 'JWT' };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const body = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign('RSA-SHA256');
  signer.update(body);
  signer.end();
  return `${body}.${base64Url(signer.sign(privateKey))}`;
};

export const getServiceAccount = (): ServiceAccount => {
  const rawJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (rawJson) {
    const parsed = JSON.parse(rawJson);
    return {
      projectId: parsed.project_id || parsed.projectId || process.env.FIREBASE_PROJECT_ID || 'carmagne-instal-2024',
      clientEmail: parsed.client_email || parsed.clientEmail,
      privateKey: (parsed.private_key || parsed.privateKey || '').replace(/\\n/g, '\n'),
    };
  }

  return {
    projectId: process.env.FIREBASE_PROJECT_ID || 'carmagne-instal-2024',
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  };
};

const assertServiceAccount = (serviceAccount = getServiceAccount()) => {
  if (!serviceAccount.clientEmail || !serviceAccount.privateKey || !serviceAccount.projectId) {
    throw new Error('Firebase Admin no está configurado en el servidor.');
  }
  return serviceAccount;
};

export const normalizeSpanishPhone = (phone: string): string => {
  let cleaned = phone.trim().replace(/\s/g, '');
  if (cleaned.startsWith('0034')) cleaned = '+34' + cleaned.slice(4);
  if (cleaned.length === 9 && /^[6789]/.test(cleaned)) cleaned = '+34' + cleaned;
  if (cleaned.startsWith('34') && cleaned.length === 11) cleaned = '+' + cleaned;
  return cleaned;
};

export const isSpanishPhone = (phone: string): boolean => /^\+34[6789]\d{8}$/.test(phone);

export const getSpanishPhoneLookupVariants = (phone: string): string[] => {
  const normalized = normalizeSpanishPhone(phone);
  const compact = phone.trim().replace(/\s/g, '');
  const withoutPrefix = normalized.startsWith('+34') ? normalized.slice(3) : normalized;
  const withoutPlus = normalized.startsWith('+') ? normalized.slice(1) : normalized;

  return Array.from(new Set([
    normalized,
    withoutPlus,
    withoutPrefix,
    compact,
  ].filter(Boolean)));
};

export const hashSecret = (secret: string) => {
  const iterations = 120000;
  const salt = randomBytes(16).toString('base64url');
  const hash = pbkdf2Sync(secret, salt, iterations, 32, 'sha256').toString('base64url');
  return `pbkdf2_sha256$${iterations}$${salt}$${hash}`;
};

export const verifySecret = (secret: string, storedHash?: string, legacyPlainText?: string) => {
  if (storedHash?.startsWith('pbkdf2_sha256$')) {
    const [, iterationText, salt, expectedHash] = storedHash.split('$');
    const iterations = Number(iterationText);
    if (!iterations || !salt || !expectedHash) return false;
    const actual = pbkdf2Sync(secret, salt, iterations, 32, 'sha256').toString('base64url');
    return safeCompare(actual, expectedHash);
  }

  return safeCompare(secret, legacyPlainText || '');
};

const safeCompare = (actual: string, expected: string) => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actualBuffer, expectedBuffer);
};

const getGoogleAccessToken = async () => {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60000) {
    return cachedAccessToken.token;
  }

  const serviceAccount = assertServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const assertion = signJwt(
    {
      iss: serviceAccount.clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    serviceAccount.privateKey
  );

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error_description || data?.error || 'No se pudo autenticar Firebase Admin.');
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return cachedAccessToken.token;
};

const firestoreBaseUrl = () => {
  const { projectId } = assertServiceAccount();
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
};

const firestoreValueToJs = (value: any): any => {
  if (!value || typeof value !== 'object') return undefined;
  if ('stringValue' in value) return value.stringValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('booleanValue' in value) return Boolean(value.booleanValue);
  if ('nullValue' in value) return null;
  if ('timestampValue' in value) return new Date(value.timestampValue).getTime();
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(firestoreValueToJs);
  if ('mapValue' in value) {
    const fields = value.mapValue.fields || {};
    return Object.fromEntries(Object.entries(fields).map(([key, fieldValue]) => [key, firestoreValueToJs(fieldValue)]));
  }
  return undefined;
};

const jsToFirestoreValue = (value: any): any => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(jsToFirestoreValue) } };
  }
  if (typeof value === 'object') {
    return {
      mapValue: {
        fields: Object.fromEntries(Object.entries(value).map(([key, fieldValue]) => [key, jsToFirestoreValue(fieldValue)])),
      },
    };
  }
  return { stringValue: String(value) };
};

const docToJs = <T = any>(doc: any): FirestoreDocument<T> => ({
  id: String(doc.name || '').split('/').pop() || '',
  name: doc.name,
  data: Object.fromEntries(
    Object.entries(doc.fields || {}).map(([key, value]) => [key, firestoreValueToJs(value)])
  ) as T,
});

export const getFirestoreDocument = async <T = any>(path: string): Promise<FirestoreDocument<T> | null> => {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${firestoreBaseUrl()}/${path.replace(/^\/+/, '')}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) return null;
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'No se pudo leer Firestore.');
  }
  return docToJs<T>(data);
};

export const setFirestoreDocument = async (path: string, data: Record<string, any>) => {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${firestoreBaseUrl()}/${path.replace(/^\/+/, '')}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      fields: Object.fromEntries(Object.entries(data).map(([key, value]) => [key, jsToFirestoreValue(value)])),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || 'No se pudo escribir Firestore.');
  }
  return docToJs(body);
};

export const queryFirestoreByField = async <T = any>(
  collectionId: string,
  fieldPath: string,
  value: string | boolean,
  limit = 1
): Promise<FirestoreDocument<T>[]> => {
  const accessToken = await getGoogleAccessToken();
  const response = await fetch(`${firestoreBaseUrl()}:runQuery`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: typeof value === 'boolean' ? { booleanValue: value } : { stringValue: value },
          },
        },
        limit,
      },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || 'No se pudo consultar Firestore.');
  }

  return (Array.isArray(data) ? data : [])
    .filter((row) => row.document)
    .map((row) => docToJs<T>(row.document));
};

export const queryFirestoreByAnyFieldValue = async <T = any>(
  collectionId: string,
  fieldPath: string,
  values: Array<string | boolean>,
  limit = 1
): Promise<FirestoreDocument<T>[]> => {
  const results: FirestoreDocument<T>[] = [];
  const seen = new Set<string>();

  for (const value of Array.from(new Set(values))) {
    const matches = await queryFirestoreByField<T>(collectionId, fieldPath, value, limit);
    for (const match of matches) {
      if (!seen.has(match.id)) {
        seen.add(match.id);
        results.push(match);
      }
      if (results.length >= limit) return results;
    }
  }

  return results;
};

export const createFirebaseCustomToken = (uid: string, claims: Record<string, any>) => {
  const serviceAccount = assertServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  return signJwt(
    {
      iss: serviceAccount.clientEmail,
      sub: serviceAccount.clientEmail,
      aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
      iat: now,
      exp: now + 3600,
      uid: uid.slice(0, 128),
      claims,
    },
    serviceAccount.privateKey
  );
};
