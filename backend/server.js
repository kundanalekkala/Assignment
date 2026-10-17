require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const http = require('http');
const { Server } = require('socket.io');

const { VERIFY_TOKEN, APP_SECRET, PAGE_ACCESS_TOKEN, PORT = 3000 } = process.env;
const GRAPH = 'https://graph.facebook.com/v21.0';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

const leads = [];

app.get('/webhook', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
      req.query['hub.verify_token'] === VERIFY_TOKEN) {
    return res.status(200).send(req.query['hub.challenge']);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  const sig = req.get('x-hub-signature-256') || '';
  const expected = 'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody).digest('hex');
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  for (const entry of req.body.entry || []) {
    for (const change of entry.changes || []) {
      if (change.field === 'leadgen') {
        try { await handleLead(change.value); }
        catch (e) { console.error('handleLead failed', e.message); }
      }
    }
  }
});

async function handleLead({ leadgen_id, form_id, page_id, created_time }) {
  if (leads.some(l => l.id === leadgen_id)) return;

  const r = await fetch(`${GRAPH}/${leadgen_id}?access_token=${PAGE_ACCESS_TOKEN}`);
  const data = await r.json();
  if (data.error) throw new Error(data.error.message);

  const fields = {};
  (data.field_data || []).forEach(f => { fields[f.name] = (f.values || [])[0]; });

  const lead = {
    id: leadgen_id,
    formId: form_id,
    pageId: page_id,
    createdTime: data.created_time || new Date(created_time * 1000).toISOString(),
    fields,
  };
  leads.unshift(lead);
  console.log('New lead:', lead);
  io.emit('lead:new', lead);
}

app.get('/leads', (_req, res) => res.json(leads));

app.get('/test-lead', (_req, res) => {
  const lead = {
    id: String(Date.now()),
    createdTime: new Date().toISOString(),
    fields: { full_name: 'Test User', email: 'test@example.com', phone_number: '9999999999' },
  };
  leads.unshift(lead);
  io.emit('lead:new', lead);
  res.send('sent');
});
   const policyPage = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
   <meta name="viewport" content="width=device-width, initial-scale=1">
   <title>${title}</title></head>
   <body style="font-family:sans-serif;max-width:700px;margin:40px auto;padding:0 16px">
   <h1>${title}</h1>${body}</body></html>`;

   app.get('/privacy', (_req, res) => res.send(policyPage('Privacy Policy',
     `<p>This is a proof-of-concept app. It receives lead form submissions (name, email, phone number) from Meta Lead Ads solely to display them in a demo app. Data is held in memory only, is not sold or shared with third parties, and is erased when the server restarts.</p>
      <p>To request deletion of your data, contact the app owner at the email listed on the app's Meta developer page.</p>`)));

   app.get('/data-deletion', (_req, res) => res.send(policyPage('Data Deletion',
     `<p>This demo app stores no data permanently. All lead data is erased whenever the server restarts. To request earlier deletion, contact the app owner.</p>`)));

app.get('/health', (_req, res) => res.send('ok'));

io.on('connection', s => console.log('app connected', s.id));

server.listen(PORT, () => console.log(`Listening on ${PORT}`));