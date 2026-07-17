import { Redirect, Stack } from "expo-router";

import { useSession } from "@/providers/session";

export default function AuthLayout() {
  const { session, loading, needsMfa, assurance, pendingPath } = useSession();

  if (loading || (session && assurance === "unknown")) return null;
  if (session && needsMfa) return <Stack screenOptions={{ headerShown: false }} />;
  if (session) return <Redirect href={pendingPath ?? "/"} />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
