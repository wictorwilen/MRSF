# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 3.x     | :white_check_mark: |
| 2.x     | :white_check_mark: |
| 1.x     | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do not open a public issue.** Instead, email security@example.com with:

- A description of the vulnerability
- Steps to reproduce the issue
- Impact assessment (who is affected, what data is at risk)

We will acknowledge receipt within 48 hours and provide an initial assessment
within 5 business days.

## Authentication

All endpoints require authentication. We support two authentication methods:

### API Key Authentication

API keys are issued per-service and rotated every 90 days.
Keys MUST be transmitted via the `X-API-Key` header over HTTPS.
Keys MUST NOT be embedded in URLs or query parameters.

### OAuth 2.0 Authentication

OAuth tokens are issued per-user and expire after 1 hour.
Refresh tokens are valid for 30 days and can be exchanged once.
Tokens MUST be transmitted via the `Authorization: Bearer` header over HTTPS.
Tokens MUST NOT be embedded in URLs or query parameters.

## Data Encryption

All data is encrypted at rest using AES-256-GCM.
All data in transit is protected by TLS 1.3.

Data at rest encryption keys are rotated annually.
Data in transit certificates are rotated every 90 days.

## Access Control

Access is governed by role-based access control (RBAC).
The principle of least privilege MUST be followed.

### Default Roles

- **Admin**: Full access to all resources. Can manage users and roles.
- **Editor**: Can create and modify resources. Cannot manage users.
- **Viewer**: Read-only access to all resources. Cannot modify anything.
- **Auditor**: Read-only access to all resources. Can export audit logs.

### Custom Roles

Organizations can define custom roles with granular permissions.
Custom roles inherit from one of the default roles listed above.
The principle of least privilege MUST be followed when defining custom roles.

## Audit Logging

All API requests are logged with the following fields:

- Timestamp
- User identity
- Action performed
- Resource affected
- Source IP address

Audit logs are retained for 365 days.
Audit logs are immutable and cannot be modified or deleted.

The principle of least privilege MUST be followed for audit log access.
