import { execFileSync } from 'node:child_process';

// A fresh booking database for every end-to-end run.
export default function globalSetup() {
  const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_e2e';
  execFileSync('bash', ['scripts/db-local.sh'], { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });
}
