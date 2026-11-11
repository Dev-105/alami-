import { Redis } from "@upstash/redis";

const STATE_KEY = "salon-alami:state";
let redis;

function getRedis() {
  if (!redis) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) throw new Error("Redis environment variables are not configured");
    redis = new Redis({ url, token });
  }
  return redis;
}

const defaultData = {
  superAdminPassword: process.env.SUPER_ADMIN_PASSWORD || "change-me",
  barbers: [
    { id: "b1794244767761", name: "Oussama", password: process.env.DEFAULT_BARBER_PASSWORD || "change-me", status: "OPEN", isOpen: true, currentlyServing: 0, queue: [], nextTicket: 1 },
  ],
  ads: [{ id: "ad1", imageUrl: "", description: "مرحبا بكم عند Line & Blade" }],
  lastResetDate: "",
};

function normalize(data) {
  const next = data || structuredClone(defaultData);
  next.barbers = Array.isArray(next.barbers) ? next.barbers : [];
  next.ads = (Array.isArray(next.ads) ? next.ads : []).slice(0, 3).map((ad, index) => ({
    id: String(ad?.id || `ad${index + 1}`),
    imageUrl: String(ad?.imageUrl ?? ad?.image ?? ""),
    description: String(ad?.description ?? ad?.text ?? ad?.title ?? ""),
  }));
  for (const barber of next.barbers) {
    const storedStatus = String(barber.status || "").toUpperCase();
    barber.status = ["OPEN", "PAUSED", "CLOSED_FOR_DAY"].includes(storedStatus)
      ? storedStatus
      : (barber.isOpen === false ? "CLOSED_FOR_DAY" : "OPEN");
    barber.isOpen = barber.status !== "CLOSED_FOR_DAY";
    barber.queue = Array.isArray(barber.queue) ? barber.queue : [];
    barber.nextTicket = Number(barber.nextTicket) || 1;
    barber.currentlyServing = Number(barber.currentlyServing) || 0;
  }
  return next;
}

async function getData() {
  const client = getRedis();
  const data = normalize(await client.get(STATE_KEY));
  if (!await client.exists(STATE_KEY)) await client.set(STATE_KEY, data);
  return data;
}

async function saveData(data) {
  const next = normalize(data);
  await getRedis().set(STATE_KEY, next);
  return next;
}

function publicState(data) {
  return {
    barbers: data.barbers.map(({ password, ...barber }) => barber),
    ads: data.ads,
  };
}

function allocateTicket(barber) {
  const serving = Math.max(0, Number(barber.currentlyServing) || 0);
  const assigned = new Set(
    barber.queue
      .map((client) => Number(client.ticket))
      .filter((ticket) => Number.isInteger(ticket) && ticket > serving),
  );
  let ticket = serving + 1;
  while (assigned.has(ticket)) ticket += 1;
  barber.nextTicket = ticket + 1;
  return ticket;
}

async function resetDailyQueues(data) {
  for (const barber of data.barbers) {
    barber.currentlyServing = 0;
    barber.queue = [];
    barber.nextTicket = 1;
  }
  data.lastResetDate = new Date().toISOString().slice(0, 10);
  return saveData(data);
}

export { allocateTicket, getData, saveData, publicState, resetDailyQueues };
