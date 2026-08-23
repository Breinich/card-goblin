import { describe, expect, it } from "vitest";
import { isAdminSignedOutEvent } from "@/lib/cloud/authEvents";

describe("admin auth cross-tab event parser", () => {
  it("accepts only the bounded signed-out event shape or its storage JSON", () => {
    expect(isAdminSignedOutEvent({ type: "signed-out" })).toBe(true);
    expect(isAdminSignedOutEvent('{"type":"signed-out","nonce":"1"}')).toBe(true);
    expect(isAdminSignedOutEvent({ type: "signed-in" })).toBe(false);
    expect(isAdminSignedOutEvent("not-json")).toBe(false);
    expect(isAdminSignedOutEvent(null)).toBe(false);
  });
});
