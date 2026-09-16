import { render } from '@testing-library/react';
import type { RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ApiContext, MockApiClient } from '../api/index.ts';
import type { ApiClient } from '../api/index.ts';

export interface RenderWithApiResult extends RenderResult {
    api: ApiClient;
}

/** A mock with no simulated latency, so tests wait on behaviour rather than a timer. */
export function instantMock(): MockApiClient {
    return new MockApiClient({ latencyMs: 0, slowLatencyMs: 0 });
}

/**
 * Renders a component against an injected API client.
 *
 * The default is a fresh MockApiClient, so tests exercise the same seeded data
 * and the same triage rules the app runs against in mock mode. Reusing the
 * existing test double rather than writing a second one keeps them from
 * drifting apart.
 */
export function renderWithApi(ui: ReactElement, api: ApiClient = instantMock()): RenderWithApiResult {
    return { ...render(<ApiContext value={api}>{ui}</ApiContext>), api };
}
