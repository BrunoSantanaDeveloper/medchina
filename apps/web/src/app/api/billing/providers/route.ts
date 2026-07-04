import { NextResponse } from "next/server";

import { configuredProviders } from "@flyee/billing";

/** Which payment providers are configured in this deployment. */
export async function GET() {
  return NextResponse.json({ providers: configuredProviders() });
}
