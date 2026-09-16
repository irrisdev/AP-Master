import type { ApiClient } from './contract.ts';
import { HttpApiClient } from './http.ts';
import { MockApiClient } from './mock.ts';

export type ApiMode = 'mock' | 'live';

/**
 * Which implementation the app talks to.
 *
 * Set VITE_API_MODE in .env.development (or .env.local, which is gitignored and
 * overrides it, so you can switch without touching a tracked file).
 *
 * Defaults to 'mock' so a fresh clone runs with no backend at all.
 */
export const apiMode: ApiMode =
    import.meta.env.VITE_API_MODE === 'live' ? 'live' : 'mock';

/**
 * The application-wide client. Components reach it through `useApi()` rather
 * than importing it, so a test can supply its own implementation.
 */
export const api: ApiClient = apiMode === 'live' ? new HttpApiClient() : new MockApiClient();
