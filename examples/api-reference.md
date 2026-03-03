# API Reference

## Authentication

All API requests require a Bearer token in the `Authorization` header.
Tokens are obtained via the `/auth/token` endpoint using client credentials.

```http
POST /auth/token
Content-Type: application/json

{
  "client_id": "your-client-id",
  "client_secret": "your-client-secret"
}
```

Tokens expire after 3600 seconds by default.
Refresh tokens are issued alongside access tokens and can be exchanged before expiry.

## Rate Limiting

Clients are limited to 1000 requests per minute per API key.
When the limit is exceeded, the API returns HTTP 429 with a `Retry-After` header.

Batch endpoints have a separate limit of 100 requests per minute.

## Endpoints

### GET /users

Returns a paginated list of users. Default page size is 50.

```json
{
  "data": [],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total": 0
  }
}
```

### POST /users

Creates a new user. Requires `name` and `email` fields.
The `role` field defaults to `viewer` if omitted.

### GET /users/:id

Returns a single user by ID. Returns 404 if the user does not exist.

### DELETE /users/:id

Soft-deletes a user. The record is retained for 90 days before permanent removal.
Administrators can restore soft-deleted users via `POST /users/:id/restore`.

## Error Handling

All errors follow the Problem Details format (RFC 9457):

```json
{
  "type": "https://api.example.com/errors/rate-limited",
  "title": "Rate Limit Exceeded",
  "status": 429,
  "detail": "You have exceeded 1000 requests per minute."
}
```

Clients SHOULD implement exponential backoff when receiving 429 or 503 responses.
