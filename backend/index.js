const express = require("express");
const cors = require("cors");
require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const { Server } = require("socket.io");

const port = process.env.PORT || 3000;
const corsOrigin = process.env.CORS_ORIGIN || "*";
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: corsOrigin } });
const dataPath = path.join(__dirname, "data.json");

const initialData = {
  superAdminPassword: "1234",
  barbers: [
    { id: "b1", name: "الحلاق 1", password: "1111", status: "OPEN", isOpen: true, currentlyServing: 3, queue: [
      { id: "c1", name: "يوسف", ticket: 4 }, { id: "c2", name: "سارة", ticket: 5 },
      { id: "c3", name: "حمزة", ticket: 6 }, { id: "c4", name: "مريم", ticket: 7 },
    ], nextTicket: 8 },
    { id: "b2", name: "الحلاق 2", password: "2222", status: "OPEN", isOpen: true, currentlyServing: 1, queue: [], nextTicket: 2 },
  ],
  ads: [{ id: "ad1", imageUrl: "", description: "مرحبا بكم عند Line & Blade" }],
};

function readData() {
  try {
    const raw = fs.readFileSync(dataPath, "utf8").trim();
    return raw ? JSON.parse(raw) : structuredClone(initialData);
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Could not read data.json:", error);
    return structuredClone(initialData);
  }
}

let data = readData();
for (const barber of data.barbers) {
  barber.status = barber.status || (barber.isOpen === false ? "CLOSED_FOR_DAY" : "OPEN");
  barber.isOpen = barber.status !== "CLOSED_FOR_DAY";
}
function writeData() {
  const tempPath = `${dataPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(data, null, 2));
  try {
    fs.renameSync(tempPath, dataPath);
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EEXIST") throw error;
    fs.copyFileSync(tempPath, dataPath);
    fs.unlinkSync(tempPath);
  }
}
function publicState() {
  return {
    barbers: data.barbers.map(({ password, ...barber }) => barber),
    ads: data.ads,
  };
}
function broadcast() {
  writeData();
  io.emit("state", publicState());
}
function setBarberStatus(barber, status) {
  const previousQueue = status === "CLOSED_FOR_DAY" ? [...barber.queue] : [];
  barber.status = status;
  barber.isOpen = status !== "CLOSED_FOR_DAY";
  if (status === "CLOSED_FOR_DAY") barber.queue = [];
  writeData();
  if (previousQueue.length) {
    io.emit("barberClosedForDay", {
      barber: { id: barber.id, name: barber.name },
      affectedClients: previousQueue,
    });
  }
  io.emit("state", publicState());
}
function resetDailyQueues() {
  for (const barber of data.barbers) {
    barber.currentlyServing = 0;
    barber.queue = [];
    barber.nextTicket = 1;
  }
  writeData();
  io.emit("dailyQueueReset", { state: publicState(), resetAt: new Date().toISOString() });
  io.emit("state", publicState());
}
function getBarber(id) {
  return data.barbers.find((barber) => barber.id === id);
}
function findQueuedClient(clientId) {
  for (const barber of data.barbers) {
    const client = barber.queue.find((item) => item.id === clientId);
    if (client) return { barber, client };
  }
  return null;
}
function switchBarberQueue({ clientId, currentChairId, targetChairId, clientName }) {
  const current = getBarber(currentChairId);
  const target = getBarber(targetChairId);
  if (!current || !target) return { error: "الحلاق ما كاينش" };
  if (currentChairId === targetChairId) return { error: "راه نتا عند هاد الحلاق" };
  if (target.status === "CLOSED_FOR_DAY") return { error: "هاد الحلاق سالى خدمتو لليوم" };
  const existing = findQueuedClient(clientId);
  if (!existing || existing.barber.id !== currentChairId) return { error: "ما لقيناش النوبة ديالك" };
  current.queue = current.queue.filter((client) => client.id !== clientId);
  const name = String(clientName || existing.client.name).trim() || existing.client.name;
  const client = { ...existing.client, name, ticket: target.nextTicket++ };
  target.queue.push(client);
  return { client };
}
function requireBarber(id, res) {
  const barber = getBarber(id);
  if (!barber) res.status(404).json({ error: "الحلاق ما كاينش" });
  return barber;
}

app.use(cors({ origin: corsOrigin }));
app.use(express.json());
app.get("/api/state", (_req, res) => res.json(publicState()));
app.post("/api/login", (req, res) => {
  const { barberId, password, isOwner } = req.body;
  const barber = getBarber(barberId);
  if (!barber) return res.status(400).json({ error: "اختار الحلاق" });
  if (isOwner && password === (process.env.SUPER_ADMIN_PASSWORD || data.superAdminPassword)) {
    return res.json({ role: "owner", barberId, barberName: barber.name });
  }
  if (!isOwner && password === barber.password) {
    return res.json({ role: "barber", barberId, barberName: barber.name });
  }
  return res.status(401).json({ error: "الباسوورد ماشي صحيح" });
});

app.post("/api/barbers/:id/next", (req, res) => {
  const barber = requireBarber(req.params.id, res);
  if (!barber) return;
  const next = barber.queue.shift();
  if (next) barber.currentlyServing = next.ticket;
  broadcast();
  res.json(publicState());
});
app.patch("/api/barbers/:id/status", (req, res) => {
  const barber = requireBarber(req.params.id, res);
  if (!barber) return;
  const status = ["OPEN", "PAUSED", "CLOSED_FOR_DAY"].includes(req.body.status)
    ? req.body.status
    : (req.body.isOpen === false ? "PAUSED" : "OPEN");
  setBarberStatus(barber, status);
  res.json(publicState());
});
app.post("/api/queue/join", (req, res) => {
  const barber = requireBarber(req.body.barberId, res);
  if (!barber) return;
  if (barber.status === "CLOSED_FOR_DAY") return res.status(409).json({ error: "هاد الحلاق سالى خدمتو لليوم" });
  if (findQueuedClient(req.body.clientId)) return res.status(409).json({ error: "عندك نوبة مسجلة دابا" });
  const client = { id: req.body.clientId, name: String(req.body.name || "").trim(), ticket: barber.nextTicket++ };
  if (!client.name) return res.status(400).json({ error: "دخل سميتك" });
  barber.queue.push(client);
  broadcast();
  res.json({ client, state: publicState() });
});
app.post("/api/queue/leave", (req, res) => {
  const barber = requireBarber(req.body.barberId, res);
  if (!barber) return;
  barber.queue = barber.queue.filter((client) => client.id !== req.body.clientId);
  broadcast();
  res.json(publicState());
});
app.post("/api/queue/switch", (req, res) => {
  const from = requireBarber(req.body.fromBarberId, res);
  const to = requireBarber(req.body.toBarberId, res);
  if (!from || !to) return;
  const result = switchBarberQueue({ clientId: req.body.clientId, currentChairId: req.body.fromBarberId, targetChairId: req.body.toBarberId, clientName: req.body.name });
  if (result.error) return res.status(409).json({ error: result.error });
  broadcast();
  res.json({ client: result.client, state: publicState() });
});
app.post("/api/barbers", (req, res) => {
  const name = String(req.body.name || "").trim();
  const password = String(req.body.password || "").trim();
  if (!name || !password) return res.status(400).json({ error: "دخل الاسم والباسوورد" });
  const barber = { id: `b${Date.now()}`, name, password, status: "OPEN", isOpen: true, currentlyServing: 0, queue: [], nextTicket: 1 };
  data.barbers.push(barber);
  broadcast();
  res.status(201).json(publicState());
});
app.patch("/api/barbers/:id", (req, res) => {
  const barber = requireBarber(req.params.id, res);
  if (!barber) return;
  if (req.body.name !== undefined) barber.name = String(req.body.name).trim();
  if (req.body.password !== undefined && String(req.body.password).trim()) barber.password = String(req.body.password).trim();
  broadcast();
  res.json(publicState());
});
app.delete("/api/barbers/:id", (req, res) => {
  if (data.barbers.length === 1) return res.status(409).json({ error: "خاص يبقى حلاق واحد على الأقل" });
  data.barbers = data.barbers.filter((barber) => barber.id !== req.params.id);
  broadcast();
  res.json(publicState());
});
app.put("/api/ads", (req, res) => {
  if (!Array.isArray(req.body.ads) || req.body.ads.length > 3) return res.status(400).json({ error: "الحد الأقصى هو 3 إعلانات" });
  data.ads = req.body.ads.map((ad, index) => ({ id: ad.id || `ad${Date.now()}${index}`, imageUrl: String(ad.imageUrl || ""), description: String(ad.description || "") }));
  broadcast();
  res.json(publicState());
});

cron.schedule("0 6 * * *", resetDailyQueues);

io.on("connection", (socket) => {
  socket.emit("state", publicState());
  socket.on("nextClient", ({ barberId }) => {
    const barber = getBarber(barberId);
    if (barber?.status === "OPEN" && barber.queue.length) { barber.currentlyServing = barber.queue.shift().ticket; broadcast(); }
  });
  socket.on("toggleStatus", ({ barberId, isOpen, status }) => {
    const barber = getBarber(barberId);
    if (barber) {
      const nextStatus = ["OPEN", "PAUSED", "CLOSED_FOR_DAY"].includes(status)
        ? status
        : (isOpen === false ? "PAUSED" : "OPEN");
      setBarberStatus(barber, nextStatus);
    }
  });
  socket.on("joinQueue", ({ barberId, client }) => {
    const barber = getBarber(barberId);
    if (barber && barber.status !== "CLOSED_FOR_DAY" && client?.id && client?.name && !findQueuedClient(client.id)) {
      barber.queue.push({ id: client.id, name: String(client.name).trim(), ticket: barber.nextTicket++ });
      broadcast();
    }
  });
  socket.on("leaveQueue", ({ barberId, clientId }) => {
    const barber = getBarber(barberId);
    if (barber) { barber.queue = barber.queue.filter((client) => client.id !== clientId); broadcast(); }
  });
  socket.on("switchBarberQueue", (payload, acknowledge) => {
    const result = switchBarberQueue(payload);
    if (result.error) return acknowledge?.({ ok: false, error: result.error });
    broadcast();
    acknowledge?.({ ok: true, client: result.client });
  });
  socket.on("updateAds", ({ ads }) => {
    if (Array.isArray(ads) && ads.length <= 3) { data.ads = ads; broadcast(); }
  });
  socket.on("updateBarbers", () => broadcast());
  socket.on("skipClient", ({ barberId, clientId }) => {
    const barber = getBarber(barberId);
    if (barber) { barber.queue = barber.queue.filter((client) => client.id !== clientId); broadcast(); }
  });
});

writeData();
server.listen(port, () => console.log(`Queue server running on port ${port}`));
