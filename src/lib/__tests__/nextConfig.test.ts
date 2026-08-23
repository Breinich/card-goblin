import { describe, expect, it } from "vitest";
import nextConfig from "../../../next.config";

describe("production host redirects", () => {
  it("redirects only the production apex host to the canonical www origin", async () => {
    const redirects = await nextConfig.redirects?.();

    expect(redirects).toEqual([
      {
        source: "/:path*",
        has: [{ type: "host", value: "cardgoblin.com" }],
        destination: "https://www.cardgoblin.com/:path*",
        permanent: true,
      },
    ]);
  });
});
