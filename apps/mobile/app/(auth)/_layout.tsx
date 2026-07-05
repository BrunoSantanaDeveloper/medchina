import { Redirect, Stack } from "expo-router";

import { useSession } from "@/providers/session";

export default function AuthLayout() {
  const { session } = useSession();

  // Signed-in users don't need the sign-in screen.
  if (session) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
