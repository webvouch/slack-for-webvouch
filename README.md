# WebVouch Slack Review Bridge

An open-source, self-hosted bridge that sends new WebVouch reviews to Slack and lets channel members publish public replies without leaving Slack.

The bridge uses Slack Socket Mode, so it opens outbound connections only. You do not need to expose a public callback endpoint.

## What it does

- Polls the WebVouch Customer API for new reviews awaiting a reply.
- Posts matching reviews to one configured Slack channel.
- Supports all reviews, positive reviews (4–5), or critical reviews (1–2).
- Opens a Slack modal from the review card and publishes the submitted reply through WebVouch.
- Updates the original card and adds the published reply to its Slack thread.
- Persists delivery cursors and reply state in a small local SQLite database.
- Exposes liveness and readiness endpoints for container monitoring.

The first successful poll records existing reviews without posting them. Only reviews discovered after initialization are delivered.

## Requirements

- A WebVouch Vouched plan and verified company
- A WebVouch Customer API client with `reviews:read` and `reviews:reply`
- A customer-owned Slack app created from `slack-app-manifest.yaml`
- Docker Engine with Docker Compose v2

## Quick start

### 1. Create the WebVouch API client

Create a Customer API client in the WebVouch business dashboard with these scopes:

```text
reviews:read
reviews:reply
```

Copy the client ID and one-time client secret. Treat both as production credentials.

### 2. Create the Slack app

1. Open Slack's **Create an app from a manifest** flow.
2. Select your workspace and paste `slack-app-manifest.yaml`.
3. Enable Socket Mode.
4. Create an app-level token with `connections:write` and copy its `xapp-...` value.
5. Install the app and copy its `xoxb-...` bot token.
6. Invite the bot to the destination channel with `/invite @WebVouch`.
7. Copy the channel ID from Slack's channel details.

The app requests only `chat:write`. It does not subscribe to message events or read channel history.

### 3. Start the bridge

```bash
cp .env.example .env
# Replace every placeholder in .env.
docker compose up --detach --build
docker compose ps
curl --fail http://127.0.0.1:8080/readyz
```

Keep the named `/data` volume across upgrades. It contains the SQLite delivery cursor and Slack message references.

## Configuration

| Variable | Required | Default | Description |
|---|---:|---|---|
| `WEBVOUCH_API_BASE_URL` | No | `https://api.webvouch.com/api` | WebVouch Customer API base URL. HTTPS is required outside local testing. |
| `WEBVOUCH_ALLOW_INSECURE_HTTP` | No | `false` | Test-only override that disables TLS enforcement for any configured WebVouch host. Never enable it in production. |
| `WEBVOUCH_CLIENT_ID` | Yes | — | Customer API client ID. |
| `WEBVOUCH_CLIENT_SECRET` | Yes | — | Customer API client secret. |
| `SLACK_BOT_TOKEN` | Yes | — | Slack bot token beginning with `xoxb-`. |
| `SLACK_APP_TOKEN` | Yes | — | Socket Mode app token beginning with `xapp-`. |
| `SLACK_CHANNEL_ID` | Yes | — | Destination public or private channel ID. |
| `POLL_INTERVAL_SECONDS` | No | `60` | Poll interval from 30 to 3,600 seconds. |
| `RATING_FILTER` | No | `all` | `all`, `positive`, or `critical`. |
| `STATE_DIR` | No | `/data` | Persistent SQLite state directory. |
| `HEALTH_PORT` | No | `8080` | HTTP health endpoint port. |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error`. |

## Health endpoints

- `/healthz` reports process liveness.
- `/readyz` requires successful WebVouch authentication, Slack authentication, and a recent review poll. Its unauthenticated JSON response includes coarse authentication and poll status, the last poll timestamp, and the most recent poll error.

The health server listens on all interfaces inside the container. The supplied Compose service publishes it to `127.0.0.1` only; direct Docker or orchestrator deployments must restrict access to the port themselves.

## Updating

Back up the named data volume, pull the new source tag, and rebuild the container:

```bash
docker compose build --pull
docker compose up --detach
docker compose ps
curl --fail http://127.0.0.1:8080/readyz
```

Tagged releases also publish a multi-platform container image to this repository's GitHub Container Registry package. Pin a complete version or image digest in production rather than relying on `latest`.

## Security and data handling

- Store `.env` in a server-side secret store and never commit it.
- Anyone able to use the Reply button in the configured channel can publish the organization's public reply. Use a private channel when appropriate.
- WebVouch access tokens are cached only in process memory.
- The SQLite database stores review IDs, Slack message references, idempotency keys, reply status, and a bounded diagnostic error string—not review bodies, reply bodies, reviewer email addresses, API credentials, or Slack tokens. Because upstream error messages may be retained, protect the volume as potentially sensitive operational data.
- The container runs as a non-root user with a read-only filesystem, all Linux capabilities dropped, and `no-new-privileges` enabled by Compose.
- Review delivery is at-least-once. A rare duplicate is possible after an uncertain Slack response.
- Reply requests use stable WebVouch idempotency keys.
- The Slack user ID associated with a reply is written to process logs for operational attribution but is not persisted in SQLite.
- Content posted to Slack is governed by the workspace's Slack retention and export policies.

Please report vulnerabilities privately as described in `SECURITY.md` and do not open public security issues.

## Development

Node.js 24 or newer is required.

```bash
npm ci
npm run typecheck
npm test
npm run build
docker build --tag webvouch/slack-review-bridge:local .
```

Tests use local fakes and do not require real WebVouch or Slack credentials.

## Community contributions

Community improvements are welcome. You can open an issue for a feature request or reproducible problem and submit a pull request with fixes, new deployment documentation, tests, dependency updates, or carefully scoped functionality.

Please read `CONTRIBUTING.md` before starting a larger change. Pull requests must preserve the least-privilege Slack app model, avoid logging or persisting credentials and review bodies, remain safe for unattended Docker operation, and include tests for changed behavior. Maintainers may request revisions before merging to protect existing self-hosted installations.

Security vulnerabilities must be reported privately through the process in `SECURITY.md`, not through a public issue.

## Releasing

1. Update `version` in `package.json` and `package-lock.json`.
2. Run the full development checks.
3. Commit the release and create a matching tag, for example `v1.0.0`.
4. Push the tag. GitHub Actions validates the version, publishes the GHCR image, generates provenance, and creates a GitHub Release.
5. After the first image is published, set the package visibility to public in GitHub if it does not inherit public visibility automatically.

## Support

- Product website: https://webvouch.com
- Customer API documentation: https://api.webvouch.com/api/public/v1/docs
- General support: support@webvouch.com

## License

Licensed under the Apache License 2.0. See `LICENSE`.
