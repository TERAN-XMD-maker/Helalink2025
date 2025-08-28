// public/index.js

const serverPublicKeyUrl = "/api/vapid-public-key";
let swRegistration = null;
let isSubscribed = false;

// Convert base64 VAPID key to Uint8Array
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

// Register Service Worker
async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      swRegistration = await navigator.serviceWorker.register("/service-worker.js");
      console.log("✅ Service Worker registered", swRegistration);
      initializeUI();
    } catch (err) {
      console.error("❌ SW registration failed:", err);
    }
  }
}

// Subscribe to push
async function subscribeUser() {
  try {
    const res = await fetch(serverPublicKeyUrl);
    const data = await res.json();
    const applicationServerKey = urlBase64ToUint8Array(data.publicKey);

    const subscription = await swRegistration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });

    await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription),
    });

    console.log("📩 User subscribed:", subscription);
    isSubscribed = true;
    updateUI();
  } catch (err) {
    console.error("❌ Failed to subscribe:", err);
  }
}

// Unsubscribe
async function unsubscribeUser() {
  try {
    const subscription = await swRegistration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();

      await fetch("/api/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });

      console.log("🗑️ User unsubscribed");
    }

    isSubscribed = false;
    updateUI();
  } catch (err) {
    console.error("❌ Failed to unsubscribe:", err);
  }
}

// Initialize UI
function initializeUI() {
  const subscribeBtn = document.getElementById("subscribeBtn");
  const unsubscribeBtn = document.getElementById("unsubscribeBtn");
  const testBtn = document.getElementById("testBtn");

  subscribeBtn.addEventListener("click", subscribeUser);
  unsubscribeBtn.addEventListener("click", unsubscribeUser);
  testBtn.addEventListener("click", async () => {
    await fetch("/api/test-notification", { method: "POST" });
  });

  // Check current subscription
  swRegistration.pushManager.getSubscription().then((subscription) => {
    isSubscribed = !!subscription;
    updateUI();
  });

  // Show countdown info
  updateCountdown();
  setInterval(updateCountdown, 60 * 1000); // refresh every minute
}

function updateUI() {
  const subscribeBtn = document.getElementById("subscribeBtn");
  const unsubscribeBtn = document.getElementById("unsubscribeBtn");
  const status = document.getElementById("status");

  if (isSubscribed) {
    subscribeBtn.disabled = true;
    unsubscribeBtn.disabled = false;
    status.textContent = "✅ Subscribed to notifications";
  } else {
    subscribeBtn.disabled = false;
    unsubscribeBtn.disabled = true;
    status.textContent = "❌ Not subscribed";
  }
}

async function updateCountdown() {
  try {
    const res = await fetch("/api/countdown");
    const countdown = await res.json();
    document.getElementById("countdown").textContent =
      countdown.isToday
        ? "🎉 Today is September 13th!"
        : `${countdown.days} days left (Target: ${countdown.targetDate})`;
  } catch (err) {
    console.error("Error fetching countdown:", err);
  }
}

// Start
registerServiceWorker();
