// Run the Node test build (npm run build:node) for Playwright and Lighthouse.
process.env.HOST ??= '127.0.0.1';
process.env.PORT ??= '4321';
await import('../dist/server/entry.mjs');
