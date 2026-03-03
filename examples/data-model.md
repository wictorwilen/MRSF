# Data Model

## Overview

The system uses an event-sourced architecture where all state changes are
captured as immutable events in an append-only log. Read models are projected
from the event stream for query performance.

## Core Entities

### User

| Field       | Type    | Description                    |
| ----------- | ------- | ------------------------------ |
| id          | UUID    | Primary identifier             |
| email       | string  | Unique, case-insensitive       |
| displayName | string  | Shown in UI, max 100 chars     |
| role        | enum    | admin, editor, viewer          |
| createdAt   | ISO8601 | Account creation timestamp     |
| deletedAt   | ISO8601 | Null unless soft-deleted        |

### Document

| Field     | Type    | Description                      |
| --------- | ------- | -------------------------------- |
| id        | UUID    | Primary identifier               |
| title     | string  | Max 200 chars, must be non-empty |
| authorId  | UUID    | FK to User.id                    |
| body      | text    | Markdown content                 |
| version   | integer | Monotonically incrementing       |
| createdAt | ISO8601 | First creation timestamp         |
| updatedAt | ISO8601 | Last modification timestamp      |

### Event

| Field     | Type    | Description                         |
| --------- | ------- | ----------------------------------- |
| id        | UUID    | Event identifier                    |
| type      | string  | e.g., document.created, user.login  |
| payload   | JSON    | Event-specific data                 |
| actorId   | UUID    | FK to User.id (who triggered it)    |
| timestamp | ISO8601 | When the event occurred             |

## Relationships

- A User can author many Documents.
- A Document belongs to exactly one User (author).
- Events reference a User as the actor.
- Documents are versioned; each edit creates a new Event.

## Indexing Strategy

Primary indices:

- `users_email_idx` on `User.email` (unique, case-insensitive)
- `documents_author_idx` on `Document.authorId`
- `events_type_ts_idx` on `Event(type, timestamp)` for time-range queries

Secondary indices are created on demand for custom read models.
