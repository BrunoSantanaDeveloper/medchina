"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Auth() {
  const router = useRouter();

  useEffect(() => {
    router.push("/auth/sign-in");
  }, [router]);

  // Pure redirect — rendering nothing avoids a flash of untranslated text.
  return null;
}
