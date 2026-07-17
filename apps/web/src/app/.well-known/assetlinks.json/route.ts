import { NextResponse } from "next/server";

export const dynamic = "force-static";

export function GET() {
  const fingerprint = process.env.ANDROID_CERT_SHA256;
  const statements = fingerprint
    ? [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: {
            namespace: "android_app",
            package_name: "com.medchina.app",
            sha256_cert_fingerprints: [fingerprint],
          },
        },
      ]
    : [];
  return NextResponse.json(statements, {
    headers: { "cache-control": "public, max-age=3600", "content-type": "application/json" },
  });
}
