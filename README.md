# MyTurn Cloudflare cron trigger

This Worker calls the durable MyTurn scheduler endpoint once per minute. The application database remains the source of truth for job schedules, retries, leases, and duplicate protection.

This private repository is linked into the [MyTurn parent](https://github.com/emirozdis/myturn) as `myturn-cron-worker/`. Its target API is maintained in [myturn-backend](https://github.com/emirozdis/myturn-backend).

## Deploy

Use the same `CRON_SECRET` value configured in the Vercel production environment.

```bash
npm ci
npx wrangler login
npx wrangler secret put CRON_SECRET
npm run deploy
```

When prompted by `wrangler secret put`, paste the secret value. Do not place it in `wrangler.jsonc` or commit it.

Run the commands from this repository's root. Check `TICK_URL` in `wrangler.jsonc` before deploying to a different environment. `npm run typecheck` and `npm test` run the local checks without deploying.

## Verify

```bash
npx wrangler deployments list
npx wrangler tail
```

The trigger runs in UTC, but `* * * * *` means every minute in every timezone. In the Cloudflare dashboard, the run history is under **Workers & Pages → myturn-cron-trigger → Triggers** and persisted logs are under **Observability**.

After confirming successful Cloudflare events, disable the Ubuntu timer so only one primary trigger remains:

```bash
sudo systemctl disable --now myturn-cron-tick.timer
```

The backend safely deduplicates concurrent calls, but leaving two schedulers active creates unnecessary traffic and noisier logs.

## Local test

Create an ignored `.dev.vars` file containing `CRON_SECRET` and run:

```bash
npm run dev
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*&format=json"
```

For local development, point `TICK_URL` at a development backend instead of the production URL before invoking the trigger. Commit and push worker changes here, then update the parent's submodule reference.
