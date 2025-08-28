// server.js
// Single deployment serving both frontend and API with push scheduling.
// Persisting subscriptions to subscriptions.json, VAPID to vapid.json

const express = require('express');
const bodyParser = require('body-parser');
const webpush = require('web-push');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const PORT = process.env.PORT || 3000;
const DATA_DIR = path.resolve(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUB_FILE = path.join(DATA_DIR, 'subscriptions.json');

function readJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// 1) Ensure VAPID keys exist (generate if missing)
let vapid = readJSON(VAPID_FILE, null);
if (!vapid || !vapid.publicKey || !vapid.privateKey) {
  console.log('Generating new VAPID keys...');
  const keys = webpush.generateVAPIDKeys();
  vapid = { publicKey: keys.publicKey, privateKey: keys.privateKey, created: new Date().toISOString() };
  writeJSON(VAPID_FILE, vapid);
  console.log('VAPID keys saved to', VAPID_FILE);
}
webpush.setVapidDetails('mailto:hello@helalink.example', vapid.publicKey, vapid.privateKey);

// 2) Load persisted subscriptions
// subscriptions store: id -> { id, subscription, launchIso, dailyTimes, timezone, createdAt }
// We also keep runtime scheduling references in memory (not persisted)
let subscriptions = readJSON(SUB_FILE, {});
// In-memory scheduling handles
const runtimeJobs = {}; // id -> { launchTimer, launchCron, dailyJobs: [cronJob], lastSentAt }

/**
 * persist subscriptions map to disk
 */
function persistSubscriptions() {
  writeJSON(SUB_FILE, subscriptions);
}

/**
 * send push safely and handle unsubscribed endpoints
 */
async function sendPushSafely(sub, payload) {
  try {
    await webpush.sendNotification(sub, JSON.stringify(payload), {
      TTL: 60 * 60 * 24
    });
    return true;
  } catch (err) {
    console.error('sendPush error:', err && err.statusCode, err && err.body ? err.body : err);
    // Remove subscription if endpoint gone
    if (err && (err.statusCode === 410 || err.statusCode === 404)) {
      return { removed: true };
    }
    return false;
  }
}

/**
 * schedule push jobs for a saved subscriber
 * - launchIso: ISO local time string (e.g. "2025-09-13T00:00:00")
 * - dailyTimes: ["09:00","13:00","19:00"]
 * - timezone: "Africa/Nairobi" (default)
 */
function scheduleFor(id) {
  // clear previous runtime jobs
  if (runtimeJobs[id]) {
    const old = runtimeJobs[id];
    if (old.launchTimer) clearTimeout(old.launchTimer);
    if (old.launchCron) try { old.launchCron.stop(); } catch(e){}
    if (old.dailyJobs) old.dailyJobs.forEach(j => j.stop && j.stop());
  }
  runtimeJobs[id] = { dailyJobs: [] };

  const item = subscriptions[id];
  if (!item || !item.subscription) return;

  const timezone = item.timezone || 'Africa/Nairobi';
  const now = new Date();

  // 1) One-off launch push
  if (item.launchIso) {
    const launchDate = new Date(item.launchIso);
    const delay = launchDate - now;
    // Safe range for setTimeout (~24.8 days)
    if (delay > 0 && delay < 2147483647) {
      runtimeJobs[id].launchTimer = setTimeout(async () => {
        const res = await sendPushSafely(item.subscription, {
          title: 'Helalink is launching today!',
          body: 'Launch is happening — open Helalink for priority onboarding & bonuses.',
          url: '/'
        });
        runtimeJobs[id].lastSentAt = new Date().toISOString();
        if (res && res.removed) {
          delete subscriptions[id];
          persistSubscriptions();
        }
      }, delay);
      console.log(`Scheduled one-off launch push for ${id} in ${Math.round(delay/1000)}s`);
    } else if (delay > 0) {
      // schedule a cron job for that specific date & time (server timezone requires carefulness)
      // We'll use cron expression for that date/time in the server timezone.
      const L = launchDate;
      const expr = `${L.getMinutes()} ${L.getHours()} ${L.getDate()} ${L.getMonth()+1} *`;
      const job = cron.schedule(expr, async () => {
        const res = await sendPushSafely(item.subscription, {
          title: 'Helalink is launching today!',
          body: 'Launch is happening — open Helalink for priority onboarding & bonuses.',
          url: '/'
        });
        if (res && res.removed) {
          delete subscriptions[id];
          persistSubscriptions();
        }
        job.stop();
      }, { timezone });
      runtimeJobs[id].launchCron = job;
      console.log(`Scheduled cron one-off launch for ${id} at ${launchDate.toString()}`);
    }
  }

  // 2) recurring daily pushes
  if (Array.isArray(item.dailyTimes)) {
    item.dailyTimes.forEach(hhmm => {
      const [hh, mm] = hhmm.split(':').map(s => parseInt(s, 10));
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) return;
      const expr = `${mm} ${hh} * * *`;
      const job = cron.schedule(expr, async () => {
        const res = await sendPushSafely(item.subscription, {
          title: 'Helalink — Daily Reminder',
          body: `Quick reminder from Helalink — check onboarding tips & launch updates.`,
          url: '/'
        });
        runtimeJobs[id].lastSentAt = new Date().toISOString();
        if (res && res.removed) {
          delete subscriptions[id];
          persistSubscriptions();
          job.stop();
        }
      }, { timezone });
      runtimeJobs[id].dailyJobs.push(job);
    });
    console.log(`Scheduled ${runtimeJobs[id].dailyJobs.length} daily jobs for ${id}`);
  }
}

/**
 * On server start, reschedule all persisted subscriptions.
 */
function rescheduleAll() {
  Object.keys(subscriptions).forEach(id => {
    try { scheduleFor(id); } catch (e) { console.error('reschedule error', e); }
  });
}

/* Express setup */
const app = express();
app.use(morgan('tiny'));
app.use(bodyParser.json({ limit: '200kb' }));

// Serve static site from /public
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Admin page - professional status overview (simple)
app.get('/admin', (req, res) => {
  const total = Object.keys(subscriptions).length;
  const list = Object.values(subscriptions).map(s => ({
    id: s.id,
    createdAt: s.createdAt,
    endpoint: s.subscription && s.subscription.endpoint ? s.subscription.endpoint.slice(0,80) + (s.subscription.endpoint.length>80?'...':'') : 'n/a',
    timezone: s.timezone,
    launchIso: s.launchIso,
    dailyTimes: s.dailyTimes
  }));
  res.type('html').send(`
    <html>
    <head>
      <meta charset="utf-8" />
      <title>Helalink Push Admin</title>
      <meta name="viewport" content="width=device-width,initial-scale=1" />
      <style>
        body{font-family:Inter,system-ui,Segoe UI,Arial;padding:28px;background:#07102a;color:#eaf6ff}
        .card{background:linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01));padding:18px;border-radius:12px;margin-bottom:12px}
        h1{margin:0 0 14px;font-size:20px}
        table{width:100%;border-collapse:collapse}
        th,td{padding:8px;text-align:left;border-bottom:1px solid rgba(255,255,255,0.04);font-size:13px}
        .btn{padding:8px 12px;border-radius:8px;background:#0b122e;color:#fff;border:0;cursor:pointer}
      </style>
    </head>
    <body>
      <h1>Helalink Push Admin</h1>
      <div class="card">
        <strong>Total subscriptions:</strong> ${total}<br/>
        <small>Data persisted in file: <code>${SUB_FILE}</code></small>
      </div>
      <div class="card">
        <table><thead><tr><th>ID</th><th>Created</th><th>Timezone</th><th>Launch</th><th>Daily</th><th>Actions</th></tr></thead><tbody>
        ${list.map(it => `<tr>
          <td><code>${it.id}</code></td>
          <td>${it.createdAt||''}</td>
          <td>${it.timezone||''}</td>
          <td>${it.launchIso||''}</td>
          <td>${(it.dailyTimes||[]).join(', ')}</td>
          <td>
            <form action="/api/admin/sendTest" method="POST" style="display:inline">
              <input type="hidden" name="id" value="${it.id}" />
              <button class="btn">Send test</button>
            </form>
            <form action="/api/unsubscribe" method="POST" style="display:inline">
              <input type="hidden" name="id" value="${it.id}" />
              <button class="btn" style="background:#6b1f2b">Remove</button>
            </form>
          </td>
        </tr>`).join('')}
        </tbody></table>
      </div>
      <div style="font-size:12px;color:rgba(255,255,255,0.6)">Server time: ${new Date().toString()}</div>
    </body>
    </html>
  `);
});

// Provide public VAPID key
app.get('/api/vapidPublicKey', (req, res) => {
  res.setHeader('Content-Type','text/plain');
  res.send(vapid.publicKey);
});

// Accept subscription and schedule jobs
app.post('/api/subscribe', (req, res) => {
  const { subscription, launchIso, dailyTimes, timezone, meta } = req.body;
  if (!subscription || !subscription.endpoint) return res.status(400).json({ error: 'Invalid subscription' });

  // Create id and save
  const id = uuidv4();
  subscriptions[id] = {
    id,
    subscription,
    launchIso: launchIso || null,
    dailyTimes: Array.isArray(dailyTimes) ? dailyTimes : ['09:00','13:00','19:00'],
    timezone: timezone || 'Africa/Nairobi',
    meta: meta || {},
    createdAt: new Date().toISOString()
  };
  persistSubscriptions();

  try { scheduleFor(id); } catch (e) { console.error('schedule error', e); }

  res.json({ success: true, id });
});

// Unsubscribe (clean up)
app.post('/api/unsubscribe', (req, res) => {
  // Accept JSON or form POST (admin)
  const id = req.body.id || req.query.id;
  if (!id || !subscriptions[id]) return res.json({ success: false });
  // cleanup runtime jobs
  if (runtimeJobs[id]) {
    const r = runtimeJobs[id];
    if (r.launchTimer) clearTimeout(r.launchTimer);
    if (r.launchCron) r.launchCron.stop && r.launchCron.stop();
    if (r.dailyJobs) r.dailyJobs.forEach(j => j.stop && j.stop());
    delete runtimeJobs[id];
  }
  delete subscriptions[id];
  persistSubscriptions();
  res.json({ success: true });
});

// Admin test send endpoint (POST form)
app.post('/api/admin/sendTest', bodyParser.urlencoded({ extended: true }), async (req, res) => {
  const id = req.body.id;
  if (!id || !subscriptions[id]) return res.send('Invalid id');
  await sendPushSafely(subscriptions[id].subscription, { title: 'Helalink Test', body: 'This is a test notification from Helalink', url: '/' });
  res.redirect('/admin');
});

// Health
app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '1.0.0', subscriptions: Object.keys(subscriptions).length });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  // reschedule persisted subscriptions
  rescheduleAll();
});
