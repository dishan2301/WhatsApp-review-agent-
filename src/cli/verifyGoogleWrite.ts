import { loadGoogleConfig } from '../config/env.js';
import { GoogleSheetsService } from '../google/sheets.js';

async function main(): Promise<void> {
  const config = loadGoogleConfig();
  if (!config.testCell) {
    throw new Error('GOOGLE_TEST_CELL is required. Use a dedicated test cell that is safe to modify temporarily.');
  }
  await GoogleSheetsService.create(config).verifyWriteAndRestore(config.testCell);
  console.log(JSON.stringify({ ok: true, testCell: config.testCell, restored: true }));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Unknown Google Sheets write verification error');
  process.exitCode = 1;
});
