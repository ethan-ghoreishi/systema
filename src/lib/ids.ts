/** Single source of UUIDs, in its own module to avoid circular imports. */
export function newId(): string {
  return crypto.randomUUID();
}
