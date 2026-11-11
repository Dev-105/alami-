const { Redis } = require("@upstash/redis");

const STATE_KEY = "salon-alami:state";
const redis = Redis.fromEnv();

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
  next.ads = Array.isArray(next.ads) ? next.ads : [];
  for (const barber of next.barbers) {
    barber.status = barber.status || (barber.isOpen === false ? "CLOSED_FOR_DAY" : "OPEN");
    barber.isOpen = barber.status !== "CLOSED_FOR_DAY";
    barber.queue = Array.isArray(barber.queue) ? barber.queue : [];
    barber.nextTicket = Number(barber.nextTicket) || 1;
    barber.currentlyServing = Number(barber.currentlyServing) || 0;
  }
  return next;
}

async function getData() {
  const data = normalize(await redis.get(STATE_KEY));
  if (!await redis.exists(STATE_KEY)) await redis.set(STATE_KEY, data);
  return data;
}

async function saveData(data) {
  const next = normalize(data);
  await redis.set(STATE_KEY, next);
  return next;
}

function publicState(data) {
  return {
    barbers: data.barbers.map(({ password, ...barber }) => barber),
    ads: data.ads,
  };
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

module.exports = { getData, saveData, publicState, resetDailyQueues };
