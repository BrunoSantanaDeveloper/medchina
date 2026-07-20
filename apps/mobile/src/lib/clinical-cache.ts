import AsyncStorage from "@react-native-async-storage/async-storage";

import { decryptJson, encryptJson } from "@/lib/recording-crypto";
import type { TodayConsultation } from "@/lib/clinical";

/**
 * The last successful read of the day, so a phone with no signal still opens on
 * the day's list instead of an empty screen (PRD §11.2, "offline first").
 *
 * Patient names and complaints are clinical data: the cache is encrypted with
 * the same device key as the recording queue, is scoped to the signed-in user
 * and is dropped on sign-out. It NEVER serves a different day — an old list
 * presented as today's would be worse than no list at all.
 */

const ORG_KEY = "medchina.cache.org.v1";
const TODAY_KEY = "medchina.cache.today.v1";

type CachedOrg = { userId: string; orgId: string };

type CachedDay = {
  orgId: string;
  day: string;
  cachedAt: string;
  consultations: TodayConsultation[];
};

export function localDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function readEncrypted<T>(key: string, scope: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) return null;
  try {
    return await decryptJson<T>(raw, scope);
  } catch {
    await AsyncStorage.removeItem(key);
    return null;
  }
}

export async function cacheOrgId(userId: string, orgId: string): Promise<void> {
  await AsyncStorage.setItem(ORG_KEY, await encryptJson({ userId, orgId }, "clinical-cache:org"));
}

export async function readCachedOrgId(userId: string): Promise<string | null> {
  const cached = await readEncrypted<CachedOrg>(ORG_KEY, "clinical-cache:org");
  return cached && cached.userId === userId ? cached.orgId : null;
}

export async function cacheTodayConsultations(orgId: string, consultations: TodayConsultation[]): Promise<void> {
  const value: CachedDay = { orgId, day: localDay(), cachedAt: new Date().toISOString(), consultations };
  await AsyncStorage.setItem(TODAY_KEY, await encryptJson(value, "clinical-cache:today"));
}

async function readCachedDay(orgId: string): Promise<CachedDay | null> {
  const cached = await readEncrypted<CachedDay>(TODAY_KEY, "clinical-cache:today");
  if (!cached || cached.orgId !== orgId || cached.day !== localDay()) return null;
  return cached;
}

export async function readCachedTodayConsultations(
  orgId: string,
): Promise<{ consultations: TodayConsultation[]; cachedAt: string } | null> {
  const cached = await readCachedDay(orgId);
  return cached ? { consultations: cached.consultations, cachedAt: cached.cachedAt } : null;
}

export async function readCachedConsultation(orgId: string, consultationId: string): Promise<TodayConsultation | null> {
  const cached = await readCachedDay(orgId);
  return cached?.consultations.find((consultation) => consultation.id === consultationId) ?? null;
}

/** Another professional must never inherit this device's cached day. */
export async function clearClinicalCache(): Promise<void> {
  await AsyncStorage.multiRemove([ORG_KEY, TODAY_KEY]);
}
