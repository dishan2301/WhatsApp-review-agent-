import 'dotenv/config';

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';

const envSchema = z.object({
  GOOGLE_SHEET_ID: z.string().trim().min(10),
  GOOGLE_SHEET_NAME: z.string().trim().min(1).default('Customers'),
  GOOGLE_SERVICE_ACCOUNT_FILE: z.string().trim().min(1),
  GOOGLE_TEST_CELL: z.preprocess(
    value => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim().min(1).optional(),
  ),
});

const credentialSchema = z.object({
  type: z.literal('service_account'),
  client_email: z.string().email(),
  private_key: z.string().includes('BEGIN PRIVATE KEY'),
});

export interface GoogleConfig {
  spreadsheetId: string;
  sheetName: string;
  credentialsPath: string;
  credentials: z.infer<typeof credentialSchema>;
  testCell?: string;
}

export function loadGoogleConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): GoogleConfig {
  const parsed = envSchema.safeParse(environment);
  if (!parsed.success) {
    throw new Error(`Invalid Google configuration: ${z.prettifyError(parsed.error)}`);
  }

  const configuredPath = parsed.data.GOOGLE_SERVICE_ACCOUNT_FILE;
  const credentialsPath = isAbsolute(configuredPath)
    ? configuredPath
    : resolve(workingDirectory, configuredPath);

  if (!existsSync(credentialsPath)) {
    throw new Error(
      `Google service-account file not found at ${credentialsPath}. Download it from Google Cloud and keep it outside Git.`,
    );
  }

  let untrustedCredentials: unknown;
  try {
    untrustedCredentials = JSON.parse(readFileSync(credentialsPath, 'utf8'));
  } catch {
    throw new Error(`Google service-account file is not valid JSON: ${credentialsPath}`);
  }

  const credentials = credentialSchema.safeParse(untrustedCredentials);
  if (!credentials.success) {
    throw new Error(`Invalid Google service-account file: ${z.prettifyError(credentials.error)}`);
  }

  return {
    spreadsheetId: parsed.data.GOOGLE_SHEET_ID,
    sheetName: parsed.data.GOOGLE_SHEET_NAME,
    credentialsPath,
    credentials: credentials.data,
    ...(parsed.data.GOOGLE_TEST_CELL ? { testCell: parsed.data.GOOGLE_TEST_CELL } : {}),
  };
}
