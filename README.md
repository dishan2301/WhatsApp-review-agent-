# Swastik Review Automation

This is the separate automation application described by `SWASTIK_WHATSAPP_REVIEW_AUTOMATION.md`. Phase 2 implements only the Google Sheets connector. It does not send WhatsApp messages or perform a customer backfill.

## Phase 2 capabilities

- Authenticates to Google Sheets with a service-account JSON file.
- Reads the configured worksheet without logging customer data.
- Detects relevant columns by normalized header names rather than column order.
- Normalizes rows into typed records with their real Google Sheet row numbers.
- Updates one explicitly selected field/cell with `RAW` input semantics.
- Verifies write access using a dedicated test cell, reads the marker back, and restores its original value.
- Rejects missing, malformed, or non-service-account credentials before making an API call.

The test suite mocks Google Sheets; automated tests never contact the live Sheet or modify customer data.

## Google Cloud setup

These actions require the owner of the Google account/Sheet:

1. Open Google Cloud Console and create or select a project for Swastik automation.
2. Enable **Google Sheets API** for that project.
3. Go to **IAM & Admin → Service Accounts** and create a dedicated service account, for example `swastik-review-worker`.
4. Create a JSON key for that service account and download it.
5. Save it as `/home/dishan/Downloads/swastik-review-automation/credentials.json`.
6. Read `client_email` from that JSON without sharing the private key:

   ```bash
   cd /home/dishan/Downloads/swastik-review-automation
   node -e "const c=require('./credentials.json'); console.log(c.client_email)"
   ```

7. Open the target Google Sheet, click **Share**, and grant that service-account email **Editor** access to this Sheet only. Do not grant project-wide roles that are unnecessary.
8. Confirm the actual worksheet/tab name. The current `.env` expects `Customers`; change `GOOGLE_SHEET_NAME` if the real tab uses another name.

`credentials.json` and `.env` are ignored by Git. Never send the JSON file through chat or commit it.

## Install and test

```bash
cd /home/dishan/Downloads/swastik-review-automation
npm install
npm run typecheck
npm test
```

## Verify live read access

After completing Google Cloud setup:

```bash
npm run verify:read
```

Successful output contains only the tab name, row count, and detected logical column names. It intentionally does not print customer names or phone numbers.

Common failures:

- `service-account file not found`: put the downloaded JSON at the configured path.
- `The caller does not have permission`: share the Sheet with the JSON file's `client_email`.
- `Unable to parse range`: correct `GOOGLE_SHEET_NAME` to the exact tab name.
- API disabled: enable Google Sheets API in the service account's Google Cloud project.

## Verify live write access safely

Create a separate tab named `Phase2 Test` and leave cell `A1` available for verification. Then set:

```env
GOOGLE_TEST_CELL=Phase2 Test!A1
```

Run:

```bash
npm run verify:write
```

The verifier saves the old value, writes a timestamped test marker, reads it back, and restores the old value in a `finally` block. Use a dedicated test cell because a network failure during restoration could otherwise leave the marker behind. Do not point this setting at a customer-data cell.

## Phase boundary

Phase 2 is complete only after both live verification commands succeed. WhatsApp integration, eligibility, queues, retry handling, and message sending belong to later phases.

## Phase 2 verification record

Verified against the live Sheet on 2026-08-08:

- Service-account authentication succeeded.
- The service account has read/write access to the supplied spreadsheet.
- The customer worksheet is configured as `Sheet1`.
- Live read found one data row without logging its customer values.
- Header detection found `name`, `mobile`, and `product`.
- A hidden `Phase2 Test` worksheet was created for non-customer verification.
- `Phase2 Test!A1` passed the temporary write, read-back, and restore test.
- TypeScript typecheck passed and all 7 mocked tests passed.

Before Phase 3 can enforce the main specification, add columns for a unique `Customer ID`, `WhatsApp Consent`, `Review Message Sent`, `Message Status`, transaction/service completion, `Sent At`, and `Error`. The connector intentionally does not infer consent or completion from the three existing columns.

## OpenWA integration

The automation uses the existing authenticated OpenWA `swastik-shop` session. It does not use Meta's official WhatsApp Cloud API.

The restricted test flow is deliberately guarded:

- `npm run phase3:dry-run` reads and validates rows but never sends or writes.
- `npm run phase3:send-test` requires the independent `PHASE3_SEND_ENABLED=true` gate.
- `TEST_PHONE_NUMBERS=self` permits only the phone linked to the OpenWA session.
- `MAX_MESSAGES_PER_RUN=1` limits the phase to one test message.
- Eligibility requires a valid Indian phone, unique customer ID, explicit WhatsApp consent, completed transaction/service, and an unsent/safe status.
- Before sending, the row is marked `Pending`; after provider acceptance it is marked sent with a timestamp.
- If OpenWA accepts a message but a later Sheet update fails, the row remains blocked from automatic resend and requires manual reconciliation.

Keep the send gates false until the allowlisted dry-run output has been reviewed.

## One-minute bilingual worker

The active worker checks `Sheet1` every 60 seconds. A new row is processed only when all safety conditions pass:

- valid Indian mobile number;
- unique `Customer ID`;
- `WhatsApp Consent = Yes`;
- `Completed = Yes` or `Completed`;
- `Review Message Sent` is not `Yes`;
- `Message Status` has no prior/ambiguous send state.

For each eligible customer it sends two messages back-to-back:

1. English review request;
2. Gujarati version with the same review link.

WhatsApp calls cannot be literally simultaneous; the Gujarati message is submitted immediately after OpenWA accepts the English message. The worker handles at most `MAX_MESSAGES_PER_RUN` customers per poll.

Durable progress is stored in `data/message-queue.sqlite` with owner-only permissions. The ledger stores a phone hash rather than the raw phone and tracks English and Gujarati provider IDs separately. After a restart:

- a completed pair is never resent;
- an English-confirmed pair resumes with Gujarati only;
- an uncertain delivery is stopped for manual review rather than blindly retried;
- the Google Sheet remains a second duplicate guard.

### Background services

OpenWA and the worker run under PM2 using `ecosystem.config.cjs`:

```bash
cd /home/dishan/Downloads/swastik-review-automation
npx pm2 status
npx pm2 logs swastik-review-worker --lines 50
npx pm2 restart swastik-review-worker
npx pm2 stop swastik-review-worker
npx pm2 start ecosystem.config.cjs
npx pm2 save
```

The worker is enabled with `WORKER_SEND_ENABLED=true`. Set it to `false` and restart the worker to stop customer sends while keeping the code and queue intact.

## Two-day follow-up agent

The same one-minute worker now checks for a one-time follow-up. A customer becomes eligible only when the durable ledger proves the initial English and Gujarati pair completed, `Sent At` is at least 48 hours old, and `Review Completed` is not `Yes`. It then sends one English reminder followed immediately by the Gujarati version and records `Follow-up Status` and `Follow-up Sent At`.

The live Sheet has these separate columns:

- `Review Completed`: enter `Yes` when the customer's Google review has been confirmed;
- `Follow-up Status`: maintained by the agent;
- `Follow-up Sent At`: maintained by the agent.

`Completed` still means the sale/service transaction is complete. It is not review confirmation.

The shared Dhanda redirect cannot identify which customer submitted a Google review. Google review data also does not expose the customer's Sheet phone number. Therefore follow-up sending remains disabled with `FOLLOWUP_SEND_ENABLED=false` until a trustworthy completion signal is available or existing customer rows are manually classified. This prevents reminders being sent to customers who already reviewed. `FOLLOWUP_DELAY_HOURS=48` controls the delay.
