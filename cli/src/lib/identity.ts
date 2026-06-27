import { v4 as uuidv4 } from "uuid";

export interface ParsedAuthor {
  name: string;
  handle?: string;
}

export function formatAuthor(name: string, handle?: string): string {
  const trimmedName = name.trim();
  const trimmedHandle = handle?.trim();
  return trimmedHandle ? `${trimmedName} (${trimmedHandle})` : trimmedName;
}

export function parseAuthor(author: string): ParsedAuthor {
  const trimmed = author.trim();
  const match = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(trimmed);
  if (!match) return { name: trimmed };

  const name = match[1].trim();
  const handle = match[2].trim();
  return handle ? { name, handle } : { name };
}

/**
 * Create a collision-resistant MRSF comment id.
 * ULID is also permitted by the spec; UUIDv4 is the default for this package.
 */
export function newCommentId(): string {
  return uuidv4();
}
