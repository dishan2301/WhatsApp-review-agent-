import { setTimeout as delay } from 'node:timers/promises';

import { loadAppConfig } from './config/app.js';
import { GoogleSheetsService } from './google/sheets.js';
import { MessageLedger } from './queue/messageLedger.js';
import { runBilingualCycle } from './services/bilingualWorker.js';
import { runFollowupCycle } from './services/followupWorker.js';
import { logEvent } from './utils/logger.js';
import { OpenWAClient } from './whatsapp/openwa.js';

async function main(): Promise<void> {
  const config = loadAppConfig();
  if (!config.workerSendEnabled) {
    throw new Error('Worker refused to start because WORKER_SEND_ENABLED=false. Review worker:dry-run first.');
  }
  const ledger = new MessageLedger(config.queueDatabaseFile);
  const sheets = GoogleSheetsService.create(config.google);
  const openwa = new OpenWAClient(config.openwa.baseUrl, config.openwa.apiKey);
  let stopping = false;
  const stop = (): void => {
    stopping = true;
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  logEvent('worker_started', { pollIntervalSeconds: config.pollIntervalSeconds });
  try {
    while (!stopping) {
      try {
        const summary = await runBilingualCycle(
          { sheets, openwa, ledger },
          {
            sessionId: config.openwa.sessionId,
            sessionName: config.openwa.sessionName,
            reviewUrl: config.reviewUrl,
            send: true,
            sendEnabledByConfig: config.workerSendEnabled,
            mobileOnlyMode: config.mobileOnlyMode,
            maxCustomers: config.maxMessagesPerRun,
          },
        );
        logEvent('poll_completed', summary as unknown as Record<string, unknown>);
        if (config.followupSendEnabled) {
          const followupSummary = await runFollowupCycle(
            { sheets, openwa, ledger },
            {
              sessionId: config.openwa.sessionId,
              reviewUrl: config.reviewUrl,
              delayHours: config.followupDelayHours,
              send: true,
              enabled: true,
              maxCustomers: config.maxMessagesPerRun,
            },
          );
          logEvent('followup_poll_completed', followupSummary as unknown as Record<string, unknown>);
        }
      } catch (error) {
        logEvent('poll_failed', { error: error instanceof Error ? error.message : 'Unknown poll failure' });
      }
      if (!stopping) await delay(config.pollIntervalSeconds * 1000);
    }
  } finally {
    ledger.close();
    logEvent('worker_stopped');
  }
}

main().catch(error => {
  logEvent('worker_fatal', { error: error instanceof Error ? error.message : 'Unknown worker error' });
  process.exitCode = 1;
});
