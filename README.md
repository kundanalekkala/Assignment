# Meta Lead Ads → React Native: Live Leads PoC

A proof of concept where a lead submitted through a **Meta Lead Ad form** appears **live** in an **already-open React Native screen**, with no refresh and no interaction on the device. Leads are simulated with **Meta's Lead Ads Testing Tool**, so no real ad is needed.

## Demo

Loom walkthrough: `<add your Loom link here>`

## What it does

1. A lead is submitted (here via Meta's Lead Ads Testing Tool).
2. Meta sends a signed webhook notification to the backend.
3. The backend verifies the signature, then calls the Graph API to fetch the lead's actual field data (name, email, phone).
4. The backend pushes the lead to every connected app over a WebSocket (Socket.IO).
5. The React Native app adds the lead to the top of its list instantly.

## Architecture

```
┌────────────────────────┐
│ Meta Lead Ads Testing  │   (you click "Create lead")
│ Tool                   │
└───────────┬────────────┘
            │ 1. leadgen event
            ▼
┌────────────────────────┐
│ Meta Webhooks          │   POST {leadgen_id, form_id, page_id, created_time}
│ (signed with App Secret)│  header: x-hub-signature-256
└───────────┬────────────┘
            │ 2. HTTPS POST /webhook
            ▼
┌────────────────────────┐
│ ngrok tunnel           │   public HTTPS URL → localhost:3000
└───────────┬────────────┘
            ▼
┌──────────────────────────────────────────────┐
│ Node.js + Express backend                    │
│  a. Verify HMAC-SHA256 signature             │
│  b. Reply 200 immediately                    │
│  c. GET graph.facebook.com/{leadgen_id}      │◄── 3. Graph API
│     using the Page Access Token              │    returns field_data
│  d. Flatten field_data, de-duplicate by ID   │
│  e. Store lead in memory                     │
│  f. io.emit("lead:new", lead)                │
└───────────┬──────────────────────────────────┘
            │ 4. WebSocket (Socket.IO)
            ▼
┌────────────────────────┐
│ React Native app (Expo)│   5. prepends lead to FlatList
│ leads screen, already  │
│ open on the device     │
└────────────────────────┘
```

### Why the Graph API call is needed

Meta's webhook payload does **not** contain the lead's personal data. It only carries identifiers:

```json
{
  "object": "page",
  "entry": [{
    "id": "<page_id>",
    "time": 1792031459,
    "changes": [{
      "field": "leadgen",
      "value": {
        "leadgen_id": "<lead id>",
        "form_id": "<form id>",
        "page_id": "<page id>",
        "created_time": 1792031455
      }
    }]
  }]
}
```

The backend therefore calls `GET /{leadgen_id}` on the Graph API with a Page Access Token to retrieve `field_data`:

```json
{
  "created_time": "2026-10-15T02:30:55+0000",
  "id": "<lead id>",
  "field_data": [
    { "name": "email", "values": ["..."] },
    { "name": "full_name", "values": ["..."] },
    { "name": "phone_number", "values": ["..."] }
  ]
}
```

## Tech stack

| Layer | Technology |
|---|---|
| Backend | Node.js, Express |
| Real-time transport | Socket.IO |
| Config | dotenv |
| Tunnel | ngrok |
| Mobile app | React Native with Expo (Expo Go), `socket.io-client` |
| Source of leads | Meta Webhooks + Graph API + Lead Ads Testing Tool |

## Repository structure

```
.
├── backend/
│   ├── server.js          # webhook, signature check, Graph API fetch, Socket.IO
│   ├── .env.example       # required environment variables (no secrets)
│   └── package.json
├── app/
│   ├── App.js             # leads screen: socket client + FlatList
│   └── package.json
└── README.md
```

## Backend details

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/webhook` | Meta's verification handshake. Checks `hub.mode` and `hub.verify_token`, and echoes `hub.challenge` |
| POST | `/webhook` | Receives lead notifications. Verifies the signature, responds 200, then processes |
| GET | `/leads` | Returns all leads currently held in memory (used by the app on connect) |
| GET | `/health` | Simple liveness check, returns `ok` |

### Request handling

1. **Verification (GET).** If `hub.verify_token` equals `VERIFY_TOKEN`, the server returns the challenge with 200. Otherwise 403.
2. **Raw body capture.** `express.json()` is configured with a `verify` hook that stores the raw bytes in `req.rawBody`. The signature must be computed over the exact bytes Meta signed, not a re-serialised object.
3. **Signature check.** The server computes `sha256=` + HMAC-SHA256(`rawBody`, `APP_SECRET`) and compares it with the `x-hub-signature-256` header using `crypto.timingSafeEqual`. A mismatch returns 401.
4. **Fast acknowledgement.** The server responds `200` before doing any slow work, so Meta does not time out and retry.
5. **Lead processing.** For each `leadgen` change, the server fetches the lead from the Graph API, flattens `field_data` into a simple `{ name: value }` object, and ignores any lead ID it has already stored (de-duplication).
6. **Broadcast.** The lead is added to the front of the in-memory list and emitted to all clients as the `lead:new` event.

### Lead shape sent to the app

```json
{
  "id": "<leadgen_id>",
  "formId": "<form_id>",
  "pageId": "<page_id>",
  "createdTime": "2026-10-15T02:30:55+0000",
  "fields": {
    "full_name": "...",
    "email": "...",
    "phone_number": "..."
  }
}
```

## App details

- Connects to the backend with `socket.io-client` (WebSocket transport).
- On connect, fetches `/leads` once so a reload does not lose existing leads.
- Listens for `lead:new` and prepends the lead to state, skipping duplicates by ID.
- Shows a **Live / Offline** indicator from the socket's connection state.
- Renders leads in a `FlatList` showing name, email, phone and time.
- Sends the `ngrok-skip-browser-warning` header so ngrok's free-plan interstitial does not break requests.

## Setup

### Prerequisites

- Node.js 20 or later, npm
- An ngrok account (free) and its CLI
- Expo Go on a phone, or an emulator
- A Facebook account that administers a Facebook Page
- A Meta for Developers account

### 1. Meta configuration

1. Create a **Facebook Page** you administer.
2. Create a **Meta app** (type **Business**) with a lead-ads use case. Keep it in Development mode while setting up.
3. In **App settings → Basic**, copy the **App secret** (this is generated by Meta, you do not invent it).
4. Add the **Webhooks** product, choose the **Page** object, and set:
   - Callback URL: `https://<your-ngrok-domain>/webhook`
   - Verify token: any string of your choice, identical to `VERIFY_TOKEN` in `.env`
5. Subscribe to the **`leadgen`** field.
6. Create and **publish an Instant Form** on the Page (Meta Business Suite → Instant forms) with name, email and phone number.
7. In the **Graph API Explorer**, with the permissions `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata` and `leads_retrieval`, generate a user token, call `GET me/accounts`, and copy the **Page** access token. Exchange the user token for a long-lived one first so the Page token does not expire.
8. Subscribe the Page to the app: `POST /{page_id}/subscribed_apps?subscribed_fields=leadgen` using the Page token.
9. In **App settings → Basic**, add a reachable **Privacy policy URL** and an app category, then switch the app to **Live**. Meta delivered real test leads only after this.

### 2. Backend

```bash
cd backend
npm install
cp .env.example .env     # then fill in real values
node server.js
```

`.env`:

```
PORT=3000
VERIFY_TOKEN=<string you chose>
APP_SECRET=<from Meta App settings → Basic>
PAGE_ACCESS_TOKEN=<long-lived Page token>
```

### 3. Tunnel

```bash
ngrok config add-authtoken <your token>
ngrok http 3000
```

Use the `https://...` forwarding URL as the webhook callback and as `SERVER` in the app.

### 4. App

```bash
cd app
npm install
# set SERVER in App.js to your ngrok URL (no trailing slash)
npx expo start
```

Scan the QR code with Expo Go. The screen should show a green **Live** indicator.

### 5. Send a test lead

1. Open the Lead Ads Testing Tool (`developers.facebook.com/tools/lead-ads-testing`).
2. Select the Page and form, click **Preview form**, edit the values if you like, then click **Create lead**.
3. Watch three places: the ngrok inspector (`http://127.0.0.1:4040`) for `POST /webhook`, the backend log for `New lead:`, and the phone for the new card.

## Observed behaviour and limits

- **Delivery latency.** Meta took roughly a minute to deliver the first test lead. Plan for a short wait.
- **Placeholder data.** The testing tool fills fields with placeholders such as `<test lead: dummy data for full_name>` unless the values are edited in the form preview.
- **One test lead at a time.** The testing tool restricted creating additional test leads.
- **Live mode.** While the app was in Development mode, the dashboard warned that only test webhooks sent from the dashboard are delivered. Real test leads arrived after the app was switched to Live.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Webhook won't save in Meta | Backend or ngrok not running, token mismatch | Start both, match `VERIFY_TOKEN` exactly |
| `POST /webhook` returns **401** | Wrong `APP_SECRET`, or `.env` edited without restart | Copy the secret from Meta, restart the backend |
| `POST /webhook` returns **502** | Backend not running | Start `node server.js` |
| Delivery status "rejected" in the testing tool | Backend rejected or was unreachable | Check the ngrok inspector status code |
| Graph error `(#210) A page access token is required` | A user token was used | Use the Page token from `me/accounts` |
| `handleLead failed` in the log | Page token expired or missing `leads_retrieval` | Regenerate, make long-lived, restart |
| App shows Offline / JSON parse error | Wrong `SERVER` URL or backend down | Fix the URL, restart, reload the app |
| Fields blank on the card | Form field names differ | Inspect `fields` in the backend log and map the real names |
| ngrok URL changed | Free ngrok URLs change on restart | Update the Meta callback URL and `SERVER` |

## Security notes

- Request authenticity is enforced with HMAC-SHA256 over the raw body, compared in constant time.
- Secrets live in `.env`, which is git-ignored. Only `.env.example` is committed.
- Never commit or screenshot the App secret or any access token. Rotate them if they leak.
- The Socket.IO server currently allows any origin and has no authentication (acceptable for a local PoC).

## Known limitations and production considerations

- **In-memory storage.** Leads are lost on restart. Use a database (for example PostgreSQL or MongoDB).
- **No retries or queue.** A failed Graph API fetch is only logged. Use a job queue with retry and backoff.
- **No reconciliation.** If the server is down, missed leads are not recovered. Periodically pull leads from the form's `/leads` edge.
- **Single Page token.** A multi-Page setup needs a token per Page, ideally from a system user.
- **Socket auth.** Require an auth token on the socket connection.
- **Hosting.** Replace ngrok with a stable HTTPS domain.
- **Observability.** Add structured logging and alerting on webhook failures.
- **Privacy.** A real deployment needs a proper privacy policy and a data-deletion process.

## Development notes

`<Add a short, honest note here about how you built this, including any tools or AI assistance you used, so the README matches the rules of the submission.>`
