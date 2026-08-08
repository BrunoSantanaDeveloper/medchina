"use client";

import { useEffect, useState } from "react";

/**
 * False during server rendering and the first client paint, true once React
 * has attached its handlers.
 *
 * Used to keep a submit button inert until the form's `onSubmit` actually
 * exists. Before hydration a click submits the form NATIVELY, which for an
 * authentication form is not a cosmetic problem: found by walking the sign-in
 * flow, a pre-hydration submit sent the credentials as a GET query string
 * (`/auth/sign-in?email=…&password=…`), putting the password in the browser
 * history, the referrer and the server access log.
 *
 * `method="post"` on the form is the guarantee that nothing ever lands in a
 * URL; this hook is what keeps the normal path from reaching that native
 * submit at all.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
