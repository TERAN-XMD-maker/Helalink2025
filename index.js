// public/index.js
(function () {
  'use strict';

  /* Helpers */
  function openUrlSafe(url) {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function openWhatsApp(message) {
    const phone = '254717028877';
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    openUrlSafe(url);
  }

  function openSignal() {
    const phone = '+254717028877';
    const url = `https://signal.me/#p/${phone}`;
    openUrlSafe(url);
  }

  function showToast(msg, ms = 4200) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(window._toastTimer);
    window._toastTimer = setTimeout(() => { t.style.display = 'none'; }, ms);
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  /* Countdown using server-provided target */
  function startCountdown(launchIso) {
    const target = new Date(launchIso);
    const dEl = document.getElementById('d'), hEl = document.getElementById('h'),
      mEl = document.getElementById('m'), sEl = document.getElementById('s');

    function tick() {
      const now = new Date();
      let diff = target - now;
      if (diff <= 0) { dEl.textContent = hEl.textContent = mEl.textContent = sEl.textContent = '00'; return; }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24)); diff %= (1000 * 60 * 60 * 24);
      const hours = Math.floor(diff / (1000 * 60 * 60)); diff %= (1000 * 60 * 60);
      const mins = Math.floor(diff / (1000 * 60)); diff %= (1000 * 60);
      const secs = Math.floor(diff / 1000);
      dEl.textContent = String(days).padStart(2, '0');
      hEl.textContent = String(hours).padStart(2, '0');
      mEl.textContent = String(mins).padStart(2, '0');
      sEl.textContent = String(secs).padStart(2, '0');
    }

    tick();
    setInterval(tick, 1000);
  }

  /* Fetch server countdown (timezone-correct) */
  async function initCountdownFromServer() {
    try {
      const r = await fetch('/api/countdown');
      if (!r.ok) throw new Error('Failed to fetch countdown info');
      const j = await r.json();
      if (j && j.targetDateISO) {
        startCountdown(j.targetDateISO);
        return;
      }
    } catch (e) {
      console.warn('Could not fetch /api/countdown, falling back to default:', e);
    }
    // Fallback (explicit Nairobi midnight)
    startCountdown('2025-09-13T00:00:00+03:00');
  }

  /* Service Worker + Push */
  let swReg = null;
  let isSubscribed = false;

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('Service Worker not supported');
      return;
    }
    try {
      // Register at /sw.js
      swReg = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered:', swReg);
      const sub = await swReg.pushManager.getSubscription();
      isSubscribed = !!sub;
      updateSubBadge(isSubscribed);
    } catch (err) {
      console.error('SW registration failed:', err);
    }
  }

  function updateSubBadge(flag) {
    const b = document.getElementById('subBadge');
    if (!b) return;
    b.style.display = flag ? 'inline-block' : 'none';
  }

  async function subscribeForHelalink() {
    if (!('serviceWorker' in navigator)) throw new Error('ServiceWorker not supported');
    if (!('PushManager' in window)) throw new Error('Push not supported');

    if (!swReg) swReg = await navigator.serviceWorker.register('/sw.js');

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission denied');

    // fetch VAPID public key (expects JSON { publicKey })
    const resp = await fetch('/api/vapidPublicKey');
    if (!resp.ok) throw new Error('Failed to fetch VAPID public key');
    const { publicKey: vapidPublicKey } = await resp.json();
    const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

    // subscribe with pushManager
    const subscription = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey
    });

    // send the subscription object directly (server accepts raw subscription or wrapped payload)
    const r = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(subscription)
    });
    if (!r.ok) {
      const txt = await r.text().catch(()=> 'no body');
      throw new Error('Server subscribe failed: ' + txt);
    }
    const json = await r.json().catch(()=>({}));
    localStorage.setItem('helalink_sub_id', json.id || subscription.endpoint || '');
    isSubscribed = true;
    updateSubBadge(true);
    return json;
  }

  async function unsubscribeForHelalink() {
    if (!swReg) return;
    const existing = await swReg.pushManager.getSubscription();
    if (!existing) {
      isSubscribed = false;
      updateSubBadge(false);
      return;
    }
    const endpoint = existing.endpoint;
    try {
      await existing.unsubscribe();
    } catch (e) {
      console.warn('Error unsubscribing locally:', e);
    }

    // notify server (send endpoint and stored id if available)
    const payload = { endpoint, id: localStorage.getItem('helalink_sub_id') || undefined };
    try {
      await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      console.warn('Server unsubscribe failed:', err);
    }

    isSubscribed = false;
    updateSubBadge(false);
    showToast('Unsubscribed from browser reminders.');
  }

  /* UI wiring */
  document.addEventListener('DOMContentLoaded', async () => {
    // register SW & init countdown
    registerServiceWorker().catch(()=>{});
    initCountdownFromServer().catch(()=>{});

    // typing effect
    const typingEl = document.getElementById('typingText');
    if (typingEl) {
      const fullText = 'HELALINK — coming soon';
      let idx = 0; const speed = 85;
      (function type(){
        if (idx <= fullText.length) {
          typingEl.textContent = fullText.slice(0, idx++);
          setTimeout(type, speed);
        }
      })();
    }

    // Join button — subscribe then open WhatsApp
    const joinBtn = document.getElementById('joinBtn');
    if (joinBtn) {
      joinBtn.addEventListener('click', async () => {
        try {
          await subscribeForHelalink();
          showToast('Subscribed. Opening WhatsApp...');
        } catch (err) {
          console.warn('subscribe failed', err);
          showToast('Could not subscribe: ' + (err.message || err));
        } finally {
          openWhatsApp('Hi! I want to join Helalink early. Please send onboarding steps.');
        }
      });
    }

    // Browser reminders button
    const notifyBtn = document.getElementById('notifyBtn');
    if (notifyBtn) {
      notifyBtn.addEventListener('click', async () => {
        try {
          await subscribeForHelalink();
          showToast('Subscribed to browser reminders.');
        } catch (err) {
          console.error(err);
          showToast('Could not subscribe: ' + (err.message || err));
        }
      });
    }

    // Signal button
    const signalBtn = document.getElementById('signalBtn');
    if (signalBtn) {
      signalBtn.addEventListener('click', () => {
        openSignal();
        localStorage.setItem('helalink_signal_sub', 'requested');
        const b = document.getElementById('subBadge'); if (b) b.style.display = 'inline-block';
        showToast("Opened Signal — send the message to subscribe.");
      });
    }

    // Test push (triggers server to send to all subs)
    const testPushBtn = document.getElementById('testPush');
    if (testPushBtn) {
      testPushBtn.addEventListener('click', async () => {
        try {
          const r = await fetch('/api/test-notification', { method: 'POST' });
          const j = await r.json();
          if (j.success) showToast('Test notification triggered.');
          else showToast('Test triggered (server response).');
        } catch (e) {
          console.error(e);
          showToast('Failed to trigger test.');
        }
      });
    }

    // SubBadge quick-unsubscribe by contextmenu
    const subBadge = document.getElementById('subBadge');
    if (subBadge) {
      subBadge.addEventListener('contextmenu', (e) => { e.preventDefault(); unsubscribeForHelalink(); });
    }

    // Bot accordion + actions
    document.querySelectorAll('.bot-q').forEach(btn => {
      btn.addEventListener('click', () => {
        const ans = btn.nextElementSibling;
        const open = ans.style.display === 'block';
        document.querySelectorAll('.bot-a').forEach(a => a.style.display = 'none');
        ans.style.display = open ? 'none' : 'block';
        if (!open) showToast('Tip: Use the WhatsApp buttons inside answers to join quickly');
      });
    });

    document.querySelectorAll('.bot-actions').forEach(group => {
      group.addEventListener('click', (e) => {
        const t = e.target;
        if (t.matches('[data-wa-message]')) {
          openWhatsApp(decodeURIComponent(t.getAttribute('data-wa-message')));
        } else if (t.matches('[data-action]')) {
          const a = t.getAttribute('data-action');
          if (a === 'more') showToast('We match weekly goals with rewards — check updates in WhatsApp.');
          if (a === 'curriculum') showToast('Curriculum: Basics → Tasks → Scaling → Referral growth.');
        }
      });
    });
  });

  window.helalink = { subscribeForHelalink, unsubscribeForHelalink, registerServiceWorker };
})();
