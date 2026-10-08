import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadGoogleConfig } from '../src/config/env.js';

function fixtureDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'swastik-google-config-'));
  writeFileSync(
    join(directory, 'credentials.json'),
    JSON.stringify({
      type: 'service_account',
      client_email: 'worker@example.iam.gserviceaccount.com',
      private_key: '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n',
    }),
    { mode: 0o600 },
  );
  return directory;
}

describe('Google configuration', () => {
  it('accepts a blank optional test cell', () => {
    const directory = fixtureDirectory();
    const config = loadGoogleConfig(
      {
        GOOGLE_SHEET_ID: 'test-sheet-id-12345',
        GOOGLE_SHEET_NAME: 'Customers',
        GOOGLE_SERVICE_ACCOUNT_FILE: './credentials.json',
        GOOGLE_TEST_CELL: '',
      },
      directory,
    );
    expect(config.testCell).toBeUndefined();
  });

  it('fails safely when the credential file is absent', () => {
    expect(() =>
      loadGoogleConfig({
        GOOGLE_SHEET_ID: 'test-sheet-id-12345',
        GOOGLE_SHEET_NAME: 'Customers',
        GOOGLE_SERVICE_ACCOUNT_FILE: './missing.json',
      }),
    ).toThrow('service-account file not found');
  });
});
