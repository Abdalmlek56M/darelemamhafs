import createClient from "openapi-fetch";
import type { paths } from "./schema";

/**
 * Same-origin client for the Next.js BFF.
 * Server-side callers can pass an absolute internal API origin.
 */
export function createApiClient(baseUrl = "") {
  return createClient<paths>({ baseUrl });
}

export const api = createApiClient();
export type { paths };
