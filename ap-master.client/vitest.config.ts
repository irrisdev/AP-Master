import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Test config is separate from vite.config.ts on purpose: that file exports a
 * dev HTTPS certificate for the ASP.NET SPA proxy, which the test run has no
 * business doing.
 */
export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        setupFiles: ['./src/test/setup.ts'],
        include: ['src/**/*.test.{ts,tsx}'],
        css: false,
        restoreMocks: true,
    },
});
