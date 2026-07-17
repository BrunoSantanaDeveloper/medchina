import { gcm } from "@noble/ciphers/aes";
import { concatBytes, utf8ToBytes } from "@noble/ciphers/utils";
import { getRandomBytes } from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const KEY_NAME = "medchina.recording-key.v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;

function bytesToBase64(bytes: Uint8Array): string {
  let value = "";
  for (let offset = 0; offset < bytes.length; offset += 8_192) {
    value += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 8_192, bytes.length)));
  }
  return btoa(value);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function getRecordingKey(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(KEY_NAME);
  if (stored) return base64ToBytes(stored);

  const key = getRandomBytes(KEY_BYTES);
  await SecureStore.setItemAsync(KEY_NAME, bytesToBase64(key), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

function aad(scope: string): Uint8Array {
  return utf8ToBytes(`medchina:${scope}:v1`);
}

export async function encryptBytes(value: Uint8Array, scope: string): Promise<Uint8Array> {
  const key = await getRecordingKey();
  const nonce = getRandomBytes(NONCE_BYTES);
  const ciphertext = gcm(key, nonce, aad(scope)).encrypt(value);
  return concatBytes(nonce, ciphertext);
}

export async function decryptBytes(value: Uint8Array, scope: string): Promise<Uint8Array> {
  if (value.length <= NONCE_BYTES) throw new Error("recording_payload_corrupt");
  const key = await getRecordingKey();
  const nonce = value.subarray(0, NONCE_BYTES);
  const ciphertext = value.subarray(NONCE_BYTES);
  return gcm(key, nonce, aad(scope)).decrypt(ciphertext);
}

export async function encryptJson(value: unknown, scope: string): Promise<string> {
  return bytesToBase64(await encryptBytes(utf8ToBytes(JSON.stringify(value)), scope));
}

export async function decryptJson<T>(value: string, scope: string): Promise<T> {
  const bytes = await decryptBytes(base64ToBytes(value), scope);
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
