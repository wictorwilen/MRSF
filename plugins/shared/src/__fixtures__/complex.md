# API Reference

This document describes the public API surface.

## Authentication

All endpoints require a valid **Bearer token** in the `Authorization` header.

> **Note**: Tokens expire after 24 hours.
> Contact the admin team for renewal.

### Token Format

Tokens use the [JWT standard](https://jwt.io) with the following claims:

- `sub` — the user identifier
- `iat` — issued-at timestamp
- `exp` — expiration timestamp
  - Must be within 24h of `iat`
  - Renewal extends by another 24h

### Rate Limits

| Tier     | Requests/min | Burst |
| -------- | ------------ | ----- |
| Free     | 60           | 10    |
| Pro      | 600          | 100   |
| Business | 6000         | 1000  |

Exceeding the limit returns `429 Too Many Requests`.

---

## Endpoints

### `GET /users`

Returns a list of users. Example response:

```json
{
  "users": [
    { "id": 1, "name": "Alice" },
    { "id": 2, "name": "Bob" }
  ]
}
```

### `POST /users`

Creates a new user. Required fields:

1. `name` — string, 1-100 chars
2. `email` — valid email address
3. `role` — one of:
   1. `admin`
   2. `editor`
   3. `viewer`

Example request:

```typescript
const response = await fetch("/users", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Charlie",
    email: "charlie@example.com",
    role: "editor",
  }),
});
```

### Error Handling

All errors follow this schema:

```yaml
error:
  code: 400
  message: "Validation failed"
  details:
    - field: "email"
      reason: "Invalid format"
```

Errors are **always** returned with the appropriate HTTP status code.

## Data Model

The `User` entity has these properties:

| Property    | Type     | Description              |
| ----------- | -------- | ------------------------ |
| `id`        | integer  | Unique identifier        |
| `name`      | string   | Display name             |
| `email`     | string   | Primary email            |
| `role`      | enum     | Permission level         |
| `createdAt` | datetime | Account creation time    |
| `updatedAt` | datetime | Last modification time   |

### Relationships

Users can belong to multiple *organizations*:

- Each organization has a **name** and **slug**
- Organizations have one or more **teams**
  - Teams contain **members** (users with a team role)
  - Teams can have nested **sub-teams**
    - Maximum nesting depth: 3 levels

## Deprecation Notice

The v1 API will be sunset on ~~2025-12-31~~ 2026-06-30.

![API Architecture](./diagrams/api-arch.png)

Please migrate to v2 before the deadline.

## Migration Notes

> **Step 1**: Update your client SDK to the latest version.
> **Step 2**: Replace all v1 endpoint URLs with their v2 equivalents.
> **Step 3**: Test your integration against the v2 sandbox environment.
> **Step 4**: Switch production traffic to v2 once tests pass.
