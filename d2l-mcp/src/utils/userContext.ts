/**
 * User context for multi-tenant scoping.
 * Uses AsyncLocalStorage so each MCP request has its own userId.
 */
import { AsyncLocalStorage } from "async_hooks";

const storage = new AsyncLocalStorage<string>();

/** Run a callback in the context of a specific user. */
export function runWithUserId<T>(userId: string, fn: () => T): T {
  return storage.run(userId, fn);
}

/** Get the current userId from async context, env var fallback, or 'legacy'. */
export function getUserId(): string {
  return storage.getStore() ?? process.env.MCP_USER_ID ?? "legacy";
}
