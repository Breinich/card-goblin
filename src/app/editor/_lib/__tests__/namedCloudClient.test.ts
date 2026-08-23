import { describe, expect, it, vi } from "vitest";
import {
  CLOUD_REQUEST_TIMEOUT_MS,
  createNamedCloudProject,
  downloadNamedProjectAsset,
  getNamedCloudProject,
  listNamedCloudProjects,
  probeProjectSession,
  sha256Hex,
  uploadNamedProjectAsset,
} from "@/app/editor/_lib/namedCloudClient";

const PROJECT_ID = "123e4567-e89b-42d3-a456-426614174000";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("named cloud client", () => {
  it("aborts a hung session probe and reaches the retryable unavailable state", async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_input: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }));
      const fetcher = fetchMock as unknown as typeof fetch;
      const pending = probeProjectSession(fetcher);
      const unavailable = expect(pending).rejects.toMatchObject({ kind: "unavailable" });
      await vi.advanceTimersByTimeAsync(CLOUD_REQUEST_TIMEOUT_MS);
      await unavailable;
      expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out when response headers arrive but the JSON body never finishes", async () => {
    vi.useFakeTimers();
    try {
      const body = new ReadableStream<Uint8Array>({ start() {} });
      const fetcher = vi.fn(async () => new Response(body, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;
      const pending = probeProjectSession(fetcher);
      const unavailable = expect(pending).rejects.toMatchObject({ kind: "unavailable" });
      await vi.advanceTimersByTimeAsync(CLOUD_REQUEST_TIMEOUT_MS);
      await unavailable;
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats only an authoritative 401 as anonymous", async () => {
    await expect(probeProjectSession(vi.fn(async () => json({}, 401)) as typeof fetch))
      .resolves.toBe("anonymous");
    await expect(
      probeProjectSession(vi.fn(async () => json({ authenticated: false }, 503)) as typeof fetch),
    ).rejects.toMatchObject({ kind: "unavailable", status: 503 });
    await expect(
      probeProjectSession(vi.fn(async () => json({ authenticated: false })) as typeof fetch),
    ).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("accepts a verified admin probe", async () => {
    const fetcher = vi.fn(async () => json({ authenticated: true })) as unknown as typeof fetch;
    await expect(probeProjectSession(fetcher)).resolves.toBe("admin");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/cloud/session",
      expect.objectContaining({ cache: "no-store", credentials: "same-origin" }),
    );
  });

  it("parses readable and damaged list entries without trusting damaged metadata", async () => {
    const fetcher = vi.fn(async () => json({
      projects: [
        {
          id: PROJECT_ID,
          name: "Deck",
          createdAt: "2026-08-22T01:02:03.000Z",
          updatedAt: "2026-08-22T02:03:04.000Z",
          revision: 1,
          readable: true,
          legacy: false,
        },
        { id: "default", readable: false, name: "<script>" },
      ],
    })) as unknown as typeof fetch;

    await expect(listNamedCloudProjects(fetcher)).resolves.toEqual([
      {
        id: PROJECT_ID,
        name: "Deck",
        createdAt: "2026-08-22T01:02:03.000Z",
        updatedAt: "2026-08-22T02:03:04.000Z",
        readable: true,
      },
      {
        id: "default",
        name: "Damaged project (default)",
        createdAt: "",
        updatedAt: "",
        readable: false,
      },
    ]);
  });

  it("grandfathers the deployed legacy default envelope, including a zero-byte manifest entry", async () => {
    const emptyHash = await sha256Hex(new Uint8Array());
    const fetcher = vi.fn(async () => json({
      project: {
        formatVersion: 2,
        id: "default",
        name: "Legacy Cloud Project",
        createdAt: "1970-01-01T00:00:00.000Z",
        updatedAt: "1970-01-01T00:00:00.000Z",
        revision: 4,
        code: "",
        sheets: {},
        assets: [{ name: "empty", mime: "image/png", size: 0, hash: emptyHash }],
        legacy: true,
      },
    })) as unknown as typeof fetch;

    await expect(getNamedCloudProject("default", fetcher)).resolves.toMatchObject({
      id: "default",
      legacy: true,
      assets: [{ name: "empty", size: 0, hash: emptyHash }],
    });
  });

  it("rejects an invalid list atomically", async () => {
    const fetcher = vi.fn(async () => json({
      projects: [{ id: PROJECT_ID, readable: true, name: "Deck" }],
    })) as unknown as typeof fetch;
    await expect(listNamedCloudProjects(fetcher)).rejects.toMatchObject({
      kind: "invalid-response",
    });
  });

  it("keeps one create operation's immutable ID and idempotency token in its body", async () => {
    const project = {
      name: "Deck",
      starterId: "blank" as const,
      code: "",
      sheets: {},
      assets: [],
    };
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return json({ project: {
        formatVersion: 2,
        id: PROJECT_ID,
        name: "Deck",
        starterId: "blank",
        createdAt: "2026-08-22T01:02:03.000Z",
        updatedAt: "2026-08-22T01:02:03.000Z",
        revision: 1,
        code: "",
        sheets: {},
        assets: [],
        legacy: false,
      } }, 201);
    });
    const fetcher = fetchMock as unknown as typeof fetch;

    await expect(createNamedCloudProject({
      id: PROJECT_ID,
      idempotencyToken: "1234567890abcdef",
      project,
    }, fetcher)).resolves.toMatchObject({ id: PROJECT_ID, name: "Deck", revision: 1 });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      id: PROJECT_ID,
      idempotencyToken: "1234567890abcdef",
      project,
    });
  });

  it("deduplicates an already-present immutable upload", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/api/cloud/projects/${PROJECT_ID}/assets/presign`)) {
        return json({ url: null, alreadyPresent: true, verifyUrl: "https://r2.invalid/verify" });
      }
      if (url === "https://r2.invalid/verify") return new Response(bytes);
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;
    const result = await uploadNamedProjectAsset(
      PROJECT_ID,
      { name: "art", mime: "image/png", bytes },
      fetcher,
    );
    expect(result).toEqual({
      name: "art",
      mime: "image/png",
      size: 3,
      hash: await sha256Hex(bytes),
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uploads through the returned URL and verifies downloads byte-for-byte", async () => {
    const bytes = new Uint8Array([9, 8, 7, 6]);
    const hash = await sha256Hex(bytes);
    let prepareCount = 0;
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/assets/presign")) {
        prepareCount += 1;
        return prepareCount === 1
          ? json({ url: "https://r2.invalid/put", alreadyPresent: false, verifyUrl: null })
          : json({ url: null, alreadyPresent: true, verifyUrl: "https://r2.invalid/verify" });
      }
      if (url === "https://r2.invalid/put") return new Response(null, { status: 200 });
      if (url.endsWith(`/assets/${hash}`)) return json({ url: "https://r2.invalid/get" });
      if (url === "https://r2.invalid/verify") return new Response(bytes);
      if (url === "https://r2.invalid/get") return new Response(bytes);
      throw new Error(`unexpected ${url}`);
    }) as unknown as typeof fetch;

    await expect(uploadNamedProjectAsset(
      PROJECT_ID,
      { name: "art", mime: "image/png", bytes },
      fetcher,
    )).resolves.toMatchObject({ hash, size: 4 });
    await expect(downloadNamedProjectAsset(
      PROJECT_ID,
      { name: "art", mime: "image/png", size: 4, hash },
      false,
      fetcher,
    )).resolves.toEqual({ name: "art", mime: "image/png", bytes });
  });

  it("rejects downloaded bytes that do not match the manifest", async () => {
    const hash = await sha256Hex(new Uint8Array([1]));
    const fetcher = vi.fn(async (input: string | URL | Request) =>
      String(input).startsWith("/api/")
        ? json({ url: "https://r2.invalid/get" })
        : new Response(new Uint8Array([2])),
    ) as unknown as typeof fetch;
    await expect(downloadNamedProjectAsset(
      PROJECT_ID,
      { name: "art", mime: "image/png", size: 1, hash },
      false,
      fetcher,
    )).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("maps thrown network failures to a fixed safe error", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("secret upstream detail");
    }) as unknown as typeof fetch;
    await expect(listNamedCloudProjects(fetcher)).rejects.toEqual(
      expect.objectContaining({
        kind: "unavailable",
        message: "The cloud service could not be reached. Check your connection and retry.",
      }),
    );
  });
});
