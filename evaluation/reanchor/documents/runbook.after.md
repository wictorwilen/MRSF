# Production deployment runbook

Use this runbook for scheduled and emergency production releases.

## Preconditions

- The incident channel is staffed.
- The release commit is signed and verified.
- The change ticket is approved.
- A rollback owner is assigned.

| Check | Owner | Required |
| --- | --- | --- |
| Smoke test | Engineering | Yes |
| Database backup | Operations | Yes |

## Deploy

Run the deployment command from the secured release workstation.

```bash
acme deploy --environment production
```

Wait for all regional health checks to become green.

## Verification

Confirm that new requests use the released version.

Review error rates for at least thirty minutes.

## Rollback

Rollback when two consecutive regional health checks fail.

```bash
acme rollback --environment production
```

Notify the incident commander and rollback owner after completion.
