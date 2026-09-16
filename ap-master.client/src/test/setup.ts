import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Each test gets a fresh DOM; a leaked tree would make the next test's queries lie.
afterEach(cleanup);
