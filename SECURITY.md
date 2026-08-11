# Security Policy

## Supported Versions

Security fixes are provided for the latest published release. Self-hosters
should upgrade before reporting a vulnerability affecting an older release.

| Version | Supported |
|---|---|
| Latest release | Yes |
| Earlier releases | No |

## Reporting a Vulnerability

Do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.

Email `support@webvouch.com` with the subject
`[SECURITY][Slack Review Bridge]` and include:

- the affected Review Bridge version and deployment environment;
- a description of the vulnerability and its potential impact;
- minimal reproduction steps or a proof of concept;
- relevant configuration or logs with all credentials, review content, and
  customer data removed;
- whether the vulnerability is already publicly known.

We aim to acknowledge reports within three business days and to provide a
triage update within seven business days. If you receive no acknowledgement
within seven business days, please resend the report. Remediation and
disclosure timing depend on severity, affected releases, and the availability
of a safe fix; we will coordinate a disclosure date with you before anything
is published.

Test only against systems and Slack workspaces you own or are authorized to
test. Do not access customer data, disrupt production installations, perform
denial-of-service testing, or publish the vulnerability before coordinated
disclosure. We will not pursue action against good-faith research that
respects these boundaries.

## System and Scope

This policy covers the WebVouch Slack Review Bridge source, Docker image,
Compose configuration, Slack app manifest, local SQLite state, health
endpoints, WebVouch Customer API client, Slack Socket Mode connection, review
delivery, and reply workflow.

The hosted WebVouch Slack integration is a separate implementation and is not
part of this repository. Slack, the WebVouch hosted platform, container
runtimes, operating systems, and hosting providers are outside this repository
unless the bridge introduces or materially increases the vulnerability.

## Threat Model and Trust Boundaries

Treat as untrusted input: WebVouch API responses, review and reply content,
Slack interaction payloads, network responses, and persisted SQLite state.
Environment configuration is operator-controlled but remains
integrity-sensitive because it selects credential and network trust roots.

Important assets include Slack bot and app tokens, WebVouch client credentials
and access tokens, review and reply content in transit, reply authorization,
idempotency state, and Slack message references.

Trust boundaries:

- The self-hoster controls the host, environment file, container runtime,
  destination channel, Slack app, and WebVouch API client. Anyone who controls
  those components is trusted with the bridge's data and credentials.
- Any Slack member able to use the Reply button in the configured channel can
  publish the organization's public reply by design. The bridge does not map
  Slack users to WebVouch users or roles.
- Slack actions are accepted only for the configured channel and the original
  managed review message. Other Slack users, channels, messages, and remote
  service responses are untrusted.

## Security Invariants

Violations of these are reportable vulnerabilities:

- Slack and WebVouch credentials and access tokens must never be written to
  logs or SQLite.
- SQLite may store review IDs, Slack message references, idempotency keys,
  reply status, and one bounded free-text diagnostic field for the most recent
  upstream error. Credentials, reviewer personal data, review bodies, and
  reply bodies reaching SQLite are defects.
- WebVouch communication must use HTTPS. Plain HTTP is accepted for a short
  allowlist of local test hosts. Setting `WEBVOUCH_ALLOW_INSECURE_HTTP=true`
  disables TLS enforcement for any configured host and is a test-only,
  operator-controlled override.
- The Slack app must retain the documented least-privilege `chat:write` bot
  scope and `connections:write` app-token scope. It must not subscribe to
  message events or read channel history.
- Review actions must remain bound to the configured channel, the original
  managed Slack message, and the corresponding WebVouch review.
- Stable idempotency keys must prevent duplicate reply publication across
  retries and process recovery. The bridge does not guarantee at-most-once
  delivery when an upstream response is lost or ambiguous.
- Health endpoints are unauthenticated and may expose only coarse operational
  state: liveness, WebVouch and Slack authentication flags, poll state and
  timestamp, and the most recent poll error. They must not expose credentials,
  tokens, review content, reply content, or personal data.
- The supplied container must run as a non-root user and remain compatible
  with the documented read-only filesystem, dropped capabilities, and
  no-new-privileges controls.
- Invalid configuration and malformed remote responses must prevent startup
  or fail the affected operation closed.

## Reportable Findings

Reportable issues include credential disclosure, unauthorized reply
publication, cross-channel, cross-message, or cross-review action confusion,
API endpoint validation bypass, SSRF, injection, unsafe logging, persistence
of prohibited data, reply idempotency bypass, state corruption leading to
unauthorized actions, health endpoint disclosure beyond the documented
coarse state, and container configuration flaws that create realistic
privilege or filesystem impact.

A report should demonstrate realistic reachability and impact in a supported
deployment.

## Known Limitations

These are pre-declared and are not new findings unless you can escalate them:

- Any Slack member able to interact with a managed review card in the
  configured channel can submit the organization's public reply. Self-hosters
  should use a private or appropriately restricted channel when necessary.
- The Slack user ID associated with a reply is emitted to process logs for
  operational attribution but is not stored in SQLite. Log retention and
  access controls are the self-hoster's responsibility.
- The health server listens on all interfaces inside the container. The
  supplied Compose file publishes it to `127.0.0.1` only; direct container or
  Kubernetes deployments must restrict the port themselves.
- SQLite is not application-level encrypted. It intentionally excludes
  credentials, review bodies, and reply bodies, but does include operational
  identifiers and a bounded diagnostic error string. Protect the volume and
  its backups as potentially sensitive operational data.
- Review notification delivery is at-least-once. A rare duplicate Slack
  notification is possible after an uncertain Slack response.
- Self-hosters are responsible for host security, secret storage, volume and
  log access, backups, token rotation, dependency and image updates, and Slack
  channel membership.

## Out of Scope

The following are normally out of scope unless they expose a distinct bridge
vulnerability:

- vulnerabilities entirely within Slack, WebVouch, Docker, the host operating
  system, or another dependency;
- self-hosters intentionally publishing environment files, tokens, SQLite
  state, logs, or health ports;
- intentionally configuring an untrusted endpoint while using
  `WEBVOUCH_ALLOW_INSECURE_HTTP=true`;
- a channel member using the documented Reply button in the configured
  channel;
- rare duplicate review notifications caused by the documented at-least-once
  delivery model;
- unsupported bridge versions;
- denial of service requiring unrealistic traffic or resource consumption;
- social engineering, physical access, and compromised host administrators;
- reports containing only automated scanner output without a reproducible
  security impact.
