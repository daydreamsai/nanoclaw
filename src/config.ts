import path from 'path';

import { readEnvFile } from './env.js';

// Read config values from .env (falls back to process.env).
// Secrets are NOT read here — they stay on disk and are loaded only
// where needed (container-runner.ts) to avoid leaking to child processes.
const envConfig = readEnvFile([
  'ASSISTANT_NAME',
  'ASSISTANT_HAS_OWN_NUMBER',
  'AGENT_PROVIDER',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_API_PATH',
  'OPENAI_USE_X402',
  'X402_ROUTER_URL',
  'X402_NETWORK',
  'X402_PERMIT_CAP',
  'X402_SIGNER_MODE',
  'X402_PAYMENT_HEADER',
]);

export const ASSISTANT_NAME =
  process.env.ASSISTANT_NAME || envConfig.ASSISTANT_NAME || 'Andy';
export const ASSISTANT_HAS_OWN_NUMBER =
  (process.env.ASSISTANT_HAS_OWN_NUMBER || envConfig.ASSISTANT_HAS_OWN_NUMBER) === 'true';
export const AGENT_PROVIDER = (
  process.env.AGENT_PROVIDER ||
  envConfig.AGENT_PROVIDER ||
  'claude'
).toLowerCase();
export const OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL ||
  envConfig.OPENAI_BASE_URL ||
  'https://api.openai.com';
export const OPENAI_API_PATH =
  process.env.OPENAI_API_PATH ||
  envConfig.OPENAI_API_PATH ||
  '/v1/chat/completions';
export const OPENAI_MODEL =
  process.env.OPENAI_MODEL ||
  envConfig.OPENAI_MODEL ||
  'gpt-4o-mini';
export const OPENAI_USE_X402 =
  (process.env.OPENAI_USE_X402 || envConfig.OPENAI_USE_X402) === 'true';
export const X402_ROUTER_URL =
  process.env.X402_ROUTER_URL ||
  envConfig.X402_ROUTER_URL ||
  OPENAI_BASE_URL;
export const X402_NETWORK =
  process.env.X402_NETWORK ||
  envConfig.X402_NETWORK ||
  'eip155:8453';
export const X402_PERMIT_CAP =
  process.env.X402_PERMIT_CAP ||
  envConfig.X402_PERMIT_CAP ||
  '10000000';
export const X402_SIGNER_MODE =
  process.env.X402_SIGNER_MODE ||
  envConfig.X402_SIGNER_MODE ||
  'env_pk';
export const X402_PAYMENT_HEADER =
  process.env.X402_PAYMENT_HEADER ||
  envConfig.X402_PAYMENT_HEADER ||
  'PAYMENT-SIGNATURE';
export const POLL_INTERVAL = 2000;
export const SCHEDULER_POLL_INTERVAL = 60000;

// Absolute paths needed for container mounts
const PROJECT_ROOT = process.cwd();
const HOME_DIR = process.env.HOME || '/Users/user';

// Mount security: allowlist stored OUTSIDE project root, never mounted into containers
export const MOUNT_ALLOWLIST_PATH = path.join(
  HOME_DIR,
  '.config',
  'nanoclaw',
  'mount-allowlist.json',
);
export const STORE_DIR = path.resolve(PROJECT_ROOT, 'store');
export const GROUPS_DIR = path.resolve(PROJECT_ROOT, 'groups');
export const DATA_DIR = path.resolve(PROJECT_ROOT, 'data');
export const MAIN_GROUP_FOLDER = 'main';

export const CONTAINER_IMAGE =
  process.env.CONTAINER_IMAGE || 'nanoclaw-agent:latest';
export const CONTAINER_TIMEOUT = parseInt(
  process.env.CONTAINER_TIMEOUT || '1800000',
  10,
);
export const CONTAINER_MAX_OUTPUT_SIZE = parseInt(
  process.env.CONTAINER_MAX_OUTPUT_SIZE || '10485760',
  10,
); // 10MB default
export const IPC_POLL_INTERVAL = 1000;
export const IDLE_TIMEOUT = parseInt(
  process.env.IDLE_TIMEOUT || '1800000',
  10,
); // 30min default — how long to keep container alive after last result
export const MAX_CONCURRENT_CONTAINERS = Math.max(
  1,
  parseInt(process.env.MAX_CONCURRENT_CONTAINERS || '5', 10) || 5,
);

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const TRIGGER_PATTERN = new RegExp(
  `^@${escapeRegex(ASSISTANT_NAME)}\\b`,
  'i',
);

// Timezone for scheduled tasks (cron expressions, etc.)
// Uses system timezone by default
export const TIMEZONE =
  process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
