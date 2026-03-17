function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function registerServiceWorker() {
  return navigator.serviceWorker.register("/sw.js");
}

async function fetchVapidPublicKey() {
  const res = await fetch("/api/push/vapid", { credentials: "include" });
  if (!res.ok) {
    throw new Error("Failed to load push key");
  }
  const body = await res.json();
  return String(body.publicKey || "");
}

async function sendSubscription(subscription: PushSubscription) {
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(subscription),
  });
}

export async function initPushNotifications() {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

  try {
    const registration = await registerServiceWorker();

    if (Notification.permission === "default") {
      await Notification.requestPermission();
    }
    if (Notification.permission !== "granted") return;

    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await sendSubscription(existing);
      return;
    }

    const publicKey = await fetchVapidPublicKey();
    if (!publicKey) return;

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });

    await sendSubscription(subscription);
  } catch {
    // Ignore push setup errors to avoid blocking app load
  }
}
