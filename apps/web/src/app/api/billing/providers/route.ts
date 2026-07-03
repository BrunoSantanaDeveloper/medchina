import { NextResponse } from "next/server";

import { configuredProviders } from "@gogo/billing";

/** Which payment providers are configured in this deployment. */
export async function GET() {
  return NextResponse.json({ providers: configuredProviders() });
}
