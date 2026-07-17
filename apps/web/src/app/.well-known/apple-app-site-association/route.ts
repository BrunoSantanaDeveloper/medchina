import { NextResponse } from "next/server";

export const dynamic = "force-static";

export function GET() {
  const teamId = process.env.APPLE_TEAM_ID;
  const details = teamId
    ? [
        {
          appIDs: [`${teamId}.com.medchina.app`],
          components: [{ "/": "/consultas/*" }, { "/": "/consulta/*" }],
        },
      ]
    : [];
  return NextResponse.json(
    { applinks: { apps: [], details } },
    { headers: { "cache-control": "public, max-age=3600", "content-type": "application/json" } },
  );
}
