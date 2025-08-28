// server.js - safer, improved Express server for daily countdown push notifications

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const express = require('express');
const webpush = require('web-push');
const cron = require('node-cron');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { DateTime } = require('luxon');

const app = express();
const port = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, process.env.SUBSCRIPTIONS_FILE || 'subscriptions.json');

// Basic middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- VAPID (from env) ----------
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error('FATAL: VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be set in environment.');
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

// ---------- Persistence helpers (simple file) ----------
function loadSubscriptions() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Could not load subscriptions file:', err.message);
  }
  return [];
}

function saveSubscriptions(list) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.warn('Could not write subscriptions file:', err.message);
  }
}

// In-memory cache, backed by file
let subscriptions = loadSubscriptions();

// ---------- Helpers ----------
const TARGET_TZ = process.env.CRON_TZ || 'Africa/Nairobi';

function getDaysUntilSeptember13(tz = TARGET_TZ) {
  const now = DateTime.now().setZone(tz).startOf('day');
  let target = DateTime.fromObject({ year: now.year, month: 9, day: 13 }, { zone: tz }).startOf('day');
  if (now > target) target = target.plus({ years: 1 });
  const daysRemaining = Math.max(0, Math.ceil(target.diff(now, 'days').days));
  return {
    days: daysRemaining,
    targetDateISO: target.toISO(),
    targetDateString: target.toLocaleString(DateTime.DATE_FULL),
    isToday: daysRemaining === 0,
    timezone: tz,
  };
}

function generateCountdownMessage(countdown) {
  if (countdown.isToday) {
    return {
      title: "🎉 It's September 13th!",
      body: 'The day has finally arrived! Happy September 13th!',
      icon: '/celebration-icon.png',
      requireInteraction: true,
    };
  } else if (countdown.days === 1) {
    return {
      title: '⏰ Tomorrow is September 13th!',
      body: 'Just 1 more day until September 13th. Get ready!',
      icon: '/countdown-icon.png',
    };
  } else {
    return {
      title: `📅 ${countdown.days} Days Until September 13th`,
      body: `Only ${countdown.days} days left (${countdown.targetDateString})`,
      icon: '/countdown-icon.png',
    };
  }
}

async function sendCountdownNotification() {
  const countdown = getDaysUntilSeptember13();
  const notificationData = generateCountdownMessage(countdown);

  if (!subscriptions.length) {
    console.log('No subscriptions to send to.');
    return;
  }

  console.log(`Sending notification to ${subscriptions.length} subscribers: ${countdown.days} days left`);

  const results = await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          sub,
          JSON.stringify({
            ...notificationData,
            tag: 'september-13-countdown',
            url: '/',
            customData: {
              daysRemaining: countdown.days,
              targetDate: countdown.targetDateISO,
            },
          })
        );
        return { endpoint: sub.endpoint, ok: true };
      } catch (err) {
        const code = err && err.statusCode;
        console.warn(`Push error for ${sub.endpoint}:`, code || err.message || err);
        if (code === 410 || code === 404) {
          return { endpoint: sub.endpoint, ok: false, remove: true };
        }
        return { endpoint: sub.endpoint, ok: false };
      }
    })
  );

  // prune expired
  const toRemove = new Set(results.filter((r) => r.remove).map((r) => r.endpoint));
  if (toRemove.size) {
    subscriptions = subscriptions.filter((s) => !toRemove.has(s.endpoint));
    saveSubscriptions(subscriptions);
    console.log(`Pruned ${toRemove.size} expired subscriptions.`);
  }
}

// ---------- Routes ----------
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// front-end expects GET /api/vapidPublicKey returning JSON { publicKey }
app.get('/api/vapidPublicKey', (req, res) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// /api/countdown returns timezone-aware info used by the client
app.get('/api/countdown', (req, res) => {
  res.json(getDaysUntilSeptember13());
});

// Validate basic shape of a PushSubscription
function isValidSubscription(obj) {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.endpoint === 'string' &&
    obj.keys &&
    typeof obj.keys.p256dh === 'string' &&
    typeof obj.keys.auth === 'string'
  );
}

// Accept both raw subscription or wrapped payload { subscription, ...meta }
app.post('/api/subscribe', (req, res) => {
  const payload = req.body;
  const sub = (payload && payload.subscription) ? payload.subscription : payload;

  if (!isValidSubscription(sub)) {
    return res.status(400).json({ success: false, error: 'Invalid subscription object' });
  }

  const exists = subscriptions.some((s) => s.endpoint === sub.endpoint);
  if (!exists) {
    subscriptions.push(sub);
    saveSubscriptions(subscriptions);
    console.log('New subscription stored:', sub.endpoint);
  } else {
    console.log('Subscription already exists:', sub.endpoint);
  }

  // return an id (endpoint) for client convenience
  return res.status(201).json({ success: true, id: sub.endpoint });
});

app.post('/api/unsubscribe', (req, res) => {
  const payload = req.body;
  // allow either { endpoint } or { subscription: { endpoint } }
  const endpoint = payload && (payload.endpoint || (payload.subscription && payload.subscription.endpoint));
  if (!endpoint) return res.status(400).json({ success: false, error: 'Missing endpoint' });

  const before = subscriptions.length;
  subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
  if (subscriptions.length !== before) saveSubscriptions(subscriptions);

  console.log('Unsubscribed:', endpoint);
  return res.json({ success: true });
});

app.post('/api/test-notification', async (req, res) => {
  try {
    await sendCountdownNotification();
    res.json({ success: true });
  } catch (err) {
    console.error('Error sending notifications:', err);
    res.status(500).json({ error: err.message || String(err) });
  }
});

// ---------- Cron (time-zone configurable) ----------
const cronTz = process.env.CRON_TZ || 'Africa/Nairobi';
const cronSchedule = process.env.CRON_SCHEDULE || '0 9 * * *'; // daily at 09:00

cron.schedule(
  cronSchedule,
  () => {
    console.log(`⏰ (${new Date().toISOString()}) Triggering scheduled send (tz=${cronTz})`);
    sendCountdownNotification().catch((e) => console.error('Scheduled send failed:', e));
  },
  { scheduled: true, timezone: cronTz }
);

// ---------- Start ----------
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  console.log('VAPID public key available at GET /api/vapidPublicKey');
  const countdown = getDaysUntilSeptember13();
  console.log(`📅 ${countdown.days} day(s) until September 13th (${countdown.targetDateString} ${countdown.timezone})`);
});
