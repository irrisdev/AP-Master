import { createContext, useContext } from 'react';
import { api } from './client.ts';
import type { ApiClient } from './contract.ts';

/**
 * Dependency injection for the API seam, mirroring how the server registers its
 * services against interfaces: a component asks for an `ApiClient` and does not
 * know or care which implementation it receives.
 *
 * The default value is the app-wide client chosen by VITE_API_MODE, so nothing
 * has to be wrapped in a provider to run normally. Tests override it:
 *
 *     render(<ApiContext value={new MockApiClient()}><ChatView /></ApiContext>);
 */
export const ApiContext = createContext<ApiClient>(api);

/** The API client for the current tree. Never call `fetch` in a component. */
export function useApi(): ApiClient {
    return useContext(ApiContext);
}
