# Acme API

The Acme API exposes projects, deployments, and audit events.

## Authentication and authorization

Clients authenticate using a short-lived OAuth bearer token.

Tokens expire after sixty minutes and must never be written to logs.

```http
Authorization: Bearer <token>
```

## Deployments

A deployment references an existing project.

Set the rollout strategy before starting a deployment.

The default rollout strategy is progressive.

Retry failed deployments with the same idempotency key.

## Projects

Create a project before submitting its first deployment.

Project names are unique within an organization.

### Configuration

Set the project region and retention period.

The default retention period is thirty days.

## Audit events

Audit events are retained independently from project logs.

Events can be exported to an organization archive.
