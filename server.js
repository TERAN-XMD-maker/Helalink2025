// server.js - Express server with daily countdown notifications to Sept 13th

const express = require("express");
const webpush = require("web-push");
const cron = require("node-cron");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static("public")); // Serve static frontend files

// ---------------- VAPID KEYS ----------------
// ⚠️ Use env vars in production. For demo only.
const vapidKeys = {
  publicKey:
    "BI5TVkHSN3q_UT9mAiIuwEKFApbXPJb0mnntScebCmF0tmavDwupOBC00OItkQCob26rL9TJacEzP9iuZ6by0CA",
  privateKey: "Qc6JrmqfrcqrfUMtMLTES_TWx47aOFF3FnA2SQfzHEM",
};

webpush.setVapidDetails(
  "mailto:teranxd11@gmail.com",
  vapidKeys.publicKey,
  vapidKeys.privateKey
);

// ---------------- STORAGE ----------------
let subscriptions = []; // in-memory (use DB in production)

// ---------------- HELPERS ----------------
function getDaysUntilSeptember13() {
  const today = new Date();
  const currentYear = today.getFullYear();
  let targetDate = new Date(currentYear, 8, 13); // September = month 8

  if (today > targetDate) {
    targetDate = new Date(currentYear + 1, 8, 13);
  }

  const timeDiff = targetDate - today;
  const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

  return {
    days: daysDiff,
    targetDate: targetDate.toDateString(),
    isToday: daysDiff === 0,
  };
}

function generateCountdownMessage(countdown) {
  if (countdown.isToday) {
    return {
      title: "🎉 It's September 13th!",
      body: "The day has finally arrived! Happy September 13th!",
      icon: "/celebration-icon.png",
      requireInteraction: true,
    };
  } else if (countdown.days === 1) {
    return {
      title: "⏰ Tomorrow is September 13th!",
      body: "Just 1 more day until September 13th. Get ready!",
      icon: "/countdown-icon.png",
    };
  } else {
    return {
      title: `📅 ${countdown.days} Days Until September 13th`,
      body: `Only ${countdown.days} days left (${countdown.targetDate})`,
      icon: "/countdown-icon.png",
    };
  }
}

async function sendCountdownNotification() {
  const countdown = getDaysUntilSeptember13();
  const notificationData = generateCountdownMessage(countdown);

  console.log(`Sending notification: ${countdown.days} days left`);

  const promises = subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        sub,
        JSON.stringify({
          ...notificationData,
          tag: "september-13-countdown",
          url: "/",
          customData: {
            daysRemaining: countdown.days,
            targetDate: countdown.targetDate,
          },
        })
      );
    } catch (err) {
      console.error("Push error:", err.statusCode || err);

      if (err.statusCode === 410 || err.statusCode === 404) {
        subscriptions = subscriptions.filter((s) => s.endpoint !== sub.endpoint);
        console.log("Removed expired subscription");
      }
    }
  });

  await Promise.all(promises);
}

// ---------------- ROUTES ----------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.post("/api/subscribe", (req, res) => {
  const sub = req.body;
  if (!subscriptions.find((s) => s.endpoint === sub.endpoint)) {
    subscriptions.push(sub);
    console.log("New subscription:", sub.endpoint);
  }
  res.json({ success: true });
});

app.post("/api/unsubscribe", (req, res) => {
  const { endpoint } = req.body;
  subscriptions = subscriptions.filter((s) => s.endpoint !== endpoint);
  console.log("Unsubscribed:", endpoint);
  res.json({ success: true });
});

app.get("/api/countdown", (req, res) => {
  res.json(getDaysUntilSeptember13());
});

app.post("/api/test-notification", async (req, res) => {
  try {
    await sendCountdownNotification();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/vapid-public-key", (req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

// ---------------- CRON ----------------
cron.schedule(
  "0 9 * * *",
  () => {
    console.log("⏰ Sending daily countdown notification (9 AM)");
    sendCountdownNotification();
  },
  { scheduled: true, timezone: "America/New_York" }
);

// ---------------- START ----------------
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
  const countdown = getDaysUntilSeptember13();
  console.log(`📅 ${countdown.days} days until September 13th`);
});
