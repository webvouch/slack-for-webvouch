# Contributing

Thank you for improving WebVouch Slack Review Bridge.

## Before opening a pull request

1. Open an issue before making a substantial behavior or interface change.
2. Keep pull requests focused and include tests for behavior changes.
3. Preserve least-privilege Slack scopes and the outbound-only Socket Mode deployment model.
4. Do not commit `.env`, Slack tokens, WebVouch credentials, customer data, production logs, or SQLite state.
5. Keep logs free of review bodies and credentials.

Run all checks before submitting:

```bash
npm ci
npm run typecheck
npm test
npm run build
docker build --tag webvouch/slack-review-bridge:local .
```

Do not report vulnerabilities in a public issue. Follow `SECURITY.md` instead.

By submitting a contribution, you agree that it is licensed under Apache-2.0, the license used by this repository.

