import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

import { loadGoogleConfig, type GoogleConfig } from './env.js';

const optionalText = z.preprocess(
  value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const appEnvSchema = z.object({
  GOOGLE_REVIEW_URL: z.url(),
  OPENWA_BASE_URL: z.url(),
  OPENWA_API_KEY: optionalText,
  OPENWA_API_KEY_FILE: optionalText,
  OPENWA_SESSION_ID: z.string().uuid(),
  OPENWA_SESSION_NAME: z.string().trim().min(1).default('swastik-shop'),
  PHASE3_SEND_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  TEST_PHONE_NUMBERS: z.string().trim().min(1),
  MAX_MESSAGES_PER_RUN: z.coerce.number().int().min(1).max(5000).default(1),
  POLL_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(3600).default(60),
  WORKER_SEND_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  MOBILE_ONLY_MODE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  QUEUE_DATABASE_FILE: z.string().trim().min(1).default('./data/message-queue.sqlite'),
  FOLLOWUP_SEND_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  FOLLOWUP_DELAY_HOURS: z.coerce.number().int().min(1).max(720).default(48),
});

export interface AppConfig {
  google: GoogleConfig;
  reviewUrl: string;
  openwa: {
    baseUrl: string;
    apiKey: string;
    sessionId: string;
    sessionName: string;
  };
  phase3SendEnabled: boolean;
  testPhoneNumbers: string[];
  maxMessagesPerRun: number;
  pollIntervalSeconds: number;
  workerSendEnabled: boolean;
  mobileOnlyMode: boolean;
  queueDatabaseFile: string;
  followupSendEnabled: boolean;
  followupDelayHours: number;
}

function readApiKey(data: z.infer<typeof appEnvSchema>, workingDirectory: string): string {
  if (data.OPENWA_API_KEY) return data.OPENWA_API_KEY;
  if (!data.OPENWA_API_KEY_FILE) {
    throw new Error('Set OPENWA_API_KEY or OPENWA_API_KEY_FILE. Do not commit either secret.');
  }
  const path = isAbsolute(data.OPENWA_API_KEY_FILE)
    ? data.OPENWA_API_KEY_FILE
    : resolve(workingDirectory, data.OPENWA_API_KEY_FILE);
  if (!existsSync(path)) throw new Error(`OpenWA API key file not found: ${path}`);
  const key = readFileSync(path, 'utf8').trim();
  if (!key.startsWith('owa_k1_')) throw new Error('OpenWA API key file does not contain a valid key.');
  return key;
}

export function loadAppConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): AppConfig {
  const parsed = appEnvSchema.safeParse(environment);
  if (!parsed.success) throw new Error(`Invalid application configuration: ${z.prettifyError(parsed.error)}`);
  return {
    google: loadGoogleConfig(environment, workingDirectory),
    reviewUrl: parsed.data.GOOGLE_REVIEW_URL,
    openwa: {
      baseUrl: parsed.data.OPENWA_BASE_URL.replace(/\/$/, ''),
      apiKey: readApiKey(parsed.data, workingDirectory),
      sessionId: parsed.data.OPENWA_SESSION_ID,
      sessionName: parsed.data.OPENWA_SESSION_NAME,
    },
    phase3SendEnabled: parsed.data.PHASE3_SEND_ENABLED,
    testPhoneNumbers: parsed.data.TEST_PHONE_NUMBERS.split(',').map(value => value.trim()).filter(Boolean),
    maxMessagesPerRun: parsed.data.MAX_MESSAGES_PER_RUN,
    pollIntervalSeconds: parsed.data.POLL_INTERVAL_SECONDS,
    workerSendEnabled: parsed.data.WORKER_SEND_ENABLED,
    mobileOnlyMode: parsed.data.MOBILE_ONLY_MODE,
    queueDatabaseFile: isAbsolute(parsed.data.QUEUE_DATABASE_FILE)
      ? parsed.data.QUEUE_DATABASE_FILE
      : resolve(workingDirectory, parsed.data.QUEUE_DATABASE_FILE),
    followupSendEnabled: parsed.data.FOLLOWUP_SEND_ENABLED,
    followupDelayHours: parsed.data.FOLLOWUP_DELAY_HOURS,
  };
}
