# Move Swastik Review Automation to Another PC

The ZIP contains two sibling projects:

- `OpenWA-main`: local WhatsApp Web gateway
- `swastik-review-automation`: Google Sheet polling and review-message worker

Secrets and machine-specific state are deliberately excluded. The new PC must link WhatsApp again.

## Requirements

- Linux PC
- Node.js 22.13 or newer
- npm
- Google service-account JSON with Editor access to the target Sheet
- WhatsApp installed on the sending phone

## Install

Extract the ZIP, open a terminal in the extracted folder, and run:

```bash
cd OpenWA-main
npm ci
npm run build

cd ../swastik-review-automation
npm ci
npm run build
```

## Configure OpenWA

Start OpenWA once:

```bash
cd ../OpenWA-main
npm run start:prod
```

Keep that terminal open. OpenWA prints its local URL and creates its API key in `data/.api-key`.
Create the `swastik-shop` session through OpenWA, start it, and scan the QR from the sending phone under **WhatsApp → Linked devices**.

## Configure the review worker

In a second terminal:

```bash
cd swastik-review-automation
cp .env.example .env
```

Edit `.env`:

```env
GOOGLE_SHEET_ID=your_new_sheet_id
GOOGLE_SHEET_NAME=Sheet1
GOOGLE_SERVICE_ACCOUNT_FILE=./credentials.json
GOOGLE_REVIEW_URL=your_google_review_link

OPENWA_BASE_URL=http://localhost:2785/api
OPENWA_API_KEY_FILE=../OpenWA-main/data/.api-key
OPENWA_SESSION_ID=the_session_uuid_created_by_openwa
OPENWA_SESSION_NAME=swastik-shop

POLL_INTERVAL_SECONDS=60
MAX_MESSAGES_PER_RUN=1
WORKER_SEND_ENABLED=false
FOLLOWUP_SEND_ENABLED=false
```

Place the Google service-account JSON at `swastik-review-automation/credentials.json`. Share the target Google Sheet with the service account's `client_email` as Editor.

## Verify before enabling sends

```bash
npm run typecheck
npm test
npm run verify:read
npm run worker:dry-run
```

Only after the dry-run is correct, change:

```env
WORKER_SEND_ENABLED=true
```

Start both services from the review-automation directory:

```bash
npx pm2 start ecosystem.config.cjs
npx pm2 save
npx pm2 status
```

## Required Sheet columns

- Customer ID
- Customer Name
- Mobile
- Product
- WhatsApp Consent
- Review Message Sent
- Message Status
- Completed
- Sent At
- Error
- Review Completed
- Follow-up Status
- Follow-up Sent At

For a new message, use a unique Customer ID, set `WhatsApp Consent` and `Completed` to `Yes`, and leave the message status fields blank.

## What is not included

- `.env`
- Google `credentials.json`
- OpenWA API key
- Linked-device/session credentials
- SQLite message ledger and customer state
- `node_modules`, build output, logs, or Git history

Do not copy the old SQLite ledger if the new Sheet contains previously contacted customers. Mark those rows as already sent in the Sheet before enabling the worker so they are not contacted again.
