import { loadAppConfig } from '../config/app.js';
import { GoogleSheetsService } from '../google/sheets.js';
import { MessageLedger } from '../queue/messageLedger.js';
import { runBilingualCycle } from '../services/bilingualWorker.js';
import { OpenWAClient } from '../whatsapp/openwa.js';

async function main(): Promise<void> {
  const config = loadAppConfig();
  const ledger = new MessageLedger(config.queueDatabaseFile);
  try {
    const summary = await runBilingualCycle(
      {
        sheets: GoogleSheetsService.create(config.google),
        openwa: new OpenWAClient(config.openwa.baseUrl, config.openwa.apiKey),
        ledger,
      },
      {
        sessionId: config.openwa.sessionId,
        sessionName: config.openwa.sessionName,
        reviewUrl: config.reviewUrl,
        send: process.argv.includes('--send'),
        sendEnabledByConfig: config.workerSendEnabled,
        mobileOnlyMode: config.mobileOnlyMode,
        maxCustomers: config.maxMessagesPerRun,
      },
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    ledger.close();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Unknown bilingual worker error');
  process.exitCode = 1;
});
