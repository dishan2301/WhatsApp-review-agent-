import { loadGoogleConfig } from '../config/env.js';
import { GoogleSheetsService } from '../google/sheets.js';

async function main(): Promise<void> {
  const config = loadGoogleConfig();
  const snapshot = await GoogleSheetsService.create(config).readSnapshot();
  console.log(
    JSON.stringify({
      ok: true,
      sheetName: config.sheetName,
      rowCount: snapshot.rows.length,
      detectedColumns: Object.keys(snapshot.columns),
    }),
  );
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Unknown Google Sheets verification error');
  process.exitCode = 1;
});
