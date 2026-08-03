import { createHmac } from "node:crypto";
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { MetaProvider } from "./meta.ts";

const SECRET = "test-app-secret";
const BODY = JSON.stringify({ entry: [{ changes: [{ value: { messages: [{ id: "1", from: "55", text: {} } ] } }] }] });

const sign = (body: string, secret = SECRET) =>
  `sha256=${createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;

const headers = (signature?: string) => new Headers(signature ? { "x-hub-signature-256": signature } : {});

describe("Meta webhook signature", () => {
  const provider = new MetaProvider();
  let previous: string | undefined;

  before(() => {
    previous = process.env.WHATSAPP_META_APP_SECRET;
    process.env.WHATSAPP_META_APP_SECRET = SECRET;
  });
  after(() => {
    if (previous === undefined) delete process.env.WHATSAPP_META_APP_SECRET;
    else process.env.WHATSAPP_META_APP_SECRET = previous;
  });

  it("accepts a payload signed with the app secret", () => {
    assert.equal(provider.verifySignature(BODY, headers(sign(BODY))), "ok");
  });

  it("rejects a forged payload — the whole point of the check", () => {
    const tampered = BODY.replace("55", "66");
    assert.equal(provider.verifySignature(tampered, headers(sign(BODY))), "invalid");
  });

  it("rejects a signature made with the wrong secret", () => {
    assert.equal(provider.verifySignature(BODY, headers(sign(BODY, "another-secret"))), "invalid");
  });

  it("rejects a missing or malformed signature header", () => {
    assert.equal(provider.verifySignature(BODY, headers()), "invalid");
    assert.equal(provider.verifySignature(BODY, headers("sha256=not-hex")), "invalid");
    assert.equal(provider.verifySignature(BODY, headers("deadbeef")), "invalid");
  });

  it("reports 'unconfigured' rather than passing when no secret is set", () => {
    delete process.env.WHATSAPP_META_APP_SECRET;
    // NOT "ok": the caller must refuse, never read this as verified.
    assert.equal(provider.verifySignature(BODY, headers(sign(BODY))), "unconfigured");
    process.env.WHATSAPP_META_APP_SECRET = SECRET;
  });
});
