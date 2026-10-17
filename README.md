# Meta Lead Ads → React Native: Live Leads PoC

A proof of concept where a lead submitted through a **Meta Lead Ad form** appears **live** in an **already-open React Native screen**, with no refresh and no interaction on the device. Leads are simulated with **Meta's Lead Ads Testing Tool**.

## What it does

1. A lead is submitted (here via Meta's Lead Ads Testing Tool).
2. Meta sends a signed webhook notification to the backend.
3. The backend verifies the signature, then calls the Graph API to fetch the lead's actual field data (name, email, phone).
4. The backend pushes the lead to every connected app over a WebSocket (Socket.IO).
5. The React Native app adds the lead to the top of its list instantly.

## Architecture
...
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

Meta's webhook payload does not contain the lead's personal data. It only carries identifiers:

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




