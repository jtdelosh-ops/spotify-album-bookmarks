import type { Env } from './types.ts';

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export async function hash(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}
export async function equalSecret(a: string, b: string): Promise<boolean> {
  const x = await hash(a), y = await hash(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}
async function key(env: Env): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(env.ENCRYPTION_KEY), c => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('Invalid encryption key');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function encrypt(env: Env, plain: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:new TextEncoder().encode(context)}, await key(env), new TextEncoder().encode(plain));
  return `${base64url(iv)}.${base64url(new Uint8Array(cipher))}`;
}
export async function decrypt(env: Env, stored: string, context: string): Promise<string> {
  const decode = (s: string) => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
  const [iv, cipher] = stored.split('.');
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM', iv:decode(iv), additionalData:new TextEncoder().encode(context)}, await key(env), decode(cipher)));
}
