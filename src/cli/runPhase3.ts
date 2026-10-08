import { loadAppConfig } from '../config/app.js';
import { GoogleSheetsService } from '../google/sheets.js';
import { runPhase3Once } from '../services/phase3Worker.js';
import { OpenWAClient } from '../whatsapp/openwa.js';

async function main(): Promise<void> {
  const config = loadAppConfig();
  const send = process.argv.includes('--send');
  const summary = await runPhase3Once(
    {
      sheets: GoogleSheetsService.create(config.google),
      openwa: new OpenWAClient(config.openwa.baseUrl, config.openwa.apiKey),
    },
    {
      sessionId: config.openwa.sessionId,
      sessionName: config.openwa.sessionName,
      reviewUrl: config.reviewUrl,
      send,
      sendEnabledByConfig: config.phase3SendEnabled,
      testPhoneNumbers: config.testPhoneNumbers,
      maxMessages: config.maxMessagesPerRun,
    },
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Unknown Phase 3 error');
  process.exitCode = 1;
});
