import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // Checks the built pages: run after npm run build:test.
        test: {
          name: 'content',
          include: ['tests/content/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // Talks to the real Claude API: needs ANTHROPIC_API_KEY. Costs a little each run.
        test: {
          name: 'assistant',
          include: ['tests/assistant-live/**/*.test.ts'],
          environment: 'node',
          testTimeout: 120_000,
          fileParallelism: false,
        },
      },
      {
        // Needs a Postgres database: DATABASE_URL, see scripts/db-local.sh
        test: {
          name: 'db',
          include: ['tests/db/**/*.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
