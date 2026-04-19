# CosbyCapital Agents

Autonomous Railway cron agents for the CosbyCapital platform.

## Agents

| Agent | Schedule | Description |
|-------|----------|-------------|
| `capital-grant-finder` | Daily 6:00 AM UTC | Scrapes Grants.gov for new small business grants |
| `capital-grant-matcher` | Daily 7:00 AM UTC | Claude AI matches clients to new grants |
| `capital-lender-matcher` | Monday 8:00 AM UTC | Claude AI matches clients to lenders |
| `capital-opportunity-digest` | Monday 9:00 AM UTC | Weekly personalized digest email to each client |
| `capital-transparency-report` | 1st of Month 7:00 AM UTC | Full monthly transparency report to each client |
| `capital-deadline-monitor` | Daily 8:00 AM UTC | Alerts clients about grants expiring within 14 days |

## Structure

```
cosbycapital-agents/
├── shared/
│   ├── supabase.js       # Supabase client + logRun()
│   ├── telegram.js       # sendTelegram() + alertError()
│   └── resend.js         # sendEmail()
├── capital-grant-finder/
│   ├── index.js
│   └── package.json
├── capital-grant-matcher/
│   ├── index.js
│   └── package.json
├── capital-lender-matcher/
│   ├── index.js
│   └── package.json
├── capital-opportunity-digest/
│   ├── index.js
│   └── package.json
├── capital-transparency-report/
│   ├── index.js
│   └── package.json
└── capital-deadline-monitor/
    ├── index.js
    └── package.json
```

## Railway Setup

Each agent folder is its own Railway service. Set these **shared variables** in Railway:

```
SUPABASE_URL=https://mbkstodswexxvdgyunio.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
ANTHROPIC_API_KEY=your_anthropic_key
RESEND_API_KEY=your_resend_key
FROM_EMAIL=CosbyCapital <noreply@cosbycapital.com>
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CHAT_ID=your_chat_id
```

### Cron Schedules (Railway)

| Agent | Cron Expression |
|-------|----------------|
| capital-grant-finder | `0 6 * * *` |
| capital-grant-matcher | `0 7 * * *` |
| capital-lender-matcher | `0 8 * * 1` |
| capital-opportunity-digest | `0 9 * * 1` |
| capital-transparency-report | `0 7 1 * *` |
| capital-deadline-monitor | `0 8 * * *` |

## Running Locally

```bash
cd capital-grant-finder
npm install
node index.js
```

Ensure environment variables are set in your shell or a `.env` file (not committed).
