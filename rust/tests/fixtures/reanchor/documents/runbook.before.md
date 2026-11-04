# Production deployment runbook

Use this runbook for scheduled production releases.

## Preconditions

- The release commit is signed.
- The change ticket is approved.
- The incident channel is staffed.

| Check | Owner | Required |
| --- | --- | --- |
| Database backup | Operations | Yes |
| Smoke test | Engineering | Yes |

## Deploy

Run the deployment command from the release workstation.

```bash
acme deploy --environment production
```

Wait for all health checks to become green.

## Rollback

Rollback when two consecutive health checks fail.

```bash
acme rollback --environment production
```

Notify the incident commander after rollback completes.

## Verification

Confirm that new requests use the released version.

Review error rates for at least fifteen minutes.
