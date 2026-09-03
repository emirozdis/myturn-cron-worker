export interface Env {
  CRON_SECRET: string;
  TICK_URL: string;
}

type TickResult = {
  tickId?: string;
  success?: boolean;
  code?: string;
  claimedJobs?: number;
  skippedJobs?: number;
};

const REQUEST_TIMEOUT_MS = 290_000;
const MAX_RESPONSE_LOG_CHARS = 4_000;

function log(level: "info" | "error", event: string, context: Record<string, unknown>): void {
  const entry = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: "myturn-cron-trigger",
    event,
    ...context,
  });

  if (level === "error") {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

function validateEnvironment(env: Env): void {
  if (!env.CRON_SECRET || env.CRON_SECRET.length < 32) {
    throw new Error("CRON_SECRET is missing or shorter than 32 characters");
  }

  const url = new URL(env.TICK_URL);
  if (url.protocol !== "https:") {
    throw new Error("TICK_URL must use HTTPS");
  }
}

async function readResponseBody(response: Response): Promise<{ raw: string; parsed: TickResult | null }> {
  const raw = (await response.text()).slice(0, MAX_RESPONSE_LOG_CHARS);

  try {
    return { raw, parsed: JSON.parse(raw) as TickResult };
  } catch {
    return { raw, parsed: null };
  }
}

export async function triggerTick(
  env: Env,
  scheduledTime: number,
  cron: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  validateEnvironment(env);

  const invocationId = crypto.randomUUID();
  const startedAt = Date.now();

  log("info", "cron.trigger.started", {
    invocationId,
    cron,
    scheduledFor: new Date(scheduledTime).toISOString(),
    tickUrl: env.TICK_URL,
  });

  let response: Response;
  try {
    response = await fetcher(env.TICK_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CRON_SECRET}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "myturn-cloudflare-cron/1.0",
        "X-MyTurn-Cron-Invocation": invocationId,
        "X-MyTurn-Cron-Scheduled-For": new Date(scheduledTime).toISOString(),
      },
      body: JSON.stringify({
        source: "cloudflare-cron",
        invocationId,
        cron,
        scheduledFor: new Date(scheduledTime).toISOString(),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    log("error", "cron.trigger.request_failed", {
      invocationId,
      cron,
      scheduledFor: new Date(scheduledTime).toISOString(),
      durationMs: Date.now() - startedAt,
      error: error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { message: String(error) },
    });
    throw error;
  }

  const body = await readResponseBody(response);
  const context = {
    invocationId,
    cron,
    scheduledFor: new Date(scheduledTime).toISOString(),
    durationMs: Date.now() - startedAt,
    httpStatus: response.status,
    tickId: body.parsed?.tickId,
    tickSuccess: body.parsed?.success,
    tickCode: body.parsed?.code,
    claimedJobs: body.parsed?.claimedJobs,
    skippedJobs: body.parsed?.skippedJobs,
  };

  if (!response.ok || body.parsed?.success === false) {
    log("error", "cron.trigger.rejected", {
      ...context,
      responseBody: body.raw,
    });
    throw new Error(`Cron tick failed with HTTP ${response.status}`);
  }

  log("info", "cron.trigger.completed", context);
}

export default {
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    await triggerTick(env, controller.scheduledTime, controller.cron);
  },
} satisfies ExportedHandler<Env>;

