# Acme API

The Acme API exposes projects, deployments, and audit events.

## Authentication

Clients authenticate with a short-lived bearer token.

Tokens expire after sixty minutes and must never be written to logs.

```http
Authorization: Bearer <token>
```

## Projects

Create a project before submitting its first deployment.

Project names are unique within an organization.

### Configuration

Set the project region and retention period.

The default retention period is thirty days.

## Deployments

A deployment references an existing project.

Retry failed deployments with the same idempotency key.

### Configuration

Set the rollout strategy before starting a deployment.

The default rollout strategy is gradual.

## Audit events

Audit events are retained independently from project logs.
