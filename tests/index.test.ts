import { afterEach, describe, expect, it, vi } from "vitest";
import { triggerTick, type Env } from "../src/index";

const env: Env = {
  CRON_SECRET: "a-secure-secret-that-is-at-least-32-characters",
  TICK_URL: "https://myturn.emirozdis.tr/api/cron/tick",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("triggerTick", () => {
  it("authenticates and accepts a successful durable tick", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      tickId: "tick-1",
      success: true,
      claimedJobs: 1,
      skippedJobs: 8,
      code: "SUCCESS",
    }), { status: 200 }));

    await triggerTick(env, Date.UTC(2026, 7, 9, 17, 0), "* * * * *", fetcher);

    expect(fetcher).toHaveBeenCalledOnce();
    const [, init] = fetcher.mock.calls[0];
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${env.CRON_SECRET}`);
    expect(init?.method).toBe("POST");
  });

  it("fails the Cloudflare event when the backend rejects the tick", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(
      JSON.stringify({ success: false, code: "JOB_FAILED" }),
      { status: 500 },
    ));

    await expect(triggerTick(env, Date.now(), "* * * * *", fetcher))
      .rejects.toThrow("Cron tick failed with HTTP 500");
  });

  it("refuses an insecure endpoint", async () => {
    await expect(triggerTick({ ...env, TICK_URL: "http://example.com/api/cron/tick" }, Date.now(), "* * * * *"))
      .rejects.toThrow("TICK_URL must use HTTPS");
  });
});

