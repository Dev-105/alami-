import { allocateTicket, getData, saveData, publicState, resetDailyQueues } from "../lib/store.js";

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json");
  res.status(status).json(body);
}

function barberOf(data, id) {
  return data.barbers.find((barber) => barber.id === id);
}

function findClient(data, clientId) {
  for (const barber of data.barbers) {
    const client = barber.queue.find((item) => item.id === clientId);
    if (client) return { barber, client };
  }
  return null;
}

function setStatus(barber, status) {
  const affectedClients = status === "CLOSED_FOR_DAY" ? [...barber.queue] : [];
  barber.status = status;
  barber.isOpen = status !== "CLOSED_FOR_DAY";
  if (status === "CLOSED_FOR_DAY") barber.queue = [];
  return affectedClients;
}

function bodyOf(req) {
  return req.body && typeof req.body === "object" ? req.body : {};
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const method = req.method;

    if (method === "OPTIONS") return send(res, 204, {});
    if (parts[0] === "cron" && parts[1] === "reset") {
      if (process.env.CRON_SECRET && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
        return send(res, 401, { error: "غير مسموح" });
      }
      const data = await getData();
      await resetDailyQueues(data);
      return send(res, 200, { ok: true });
    }

    const data = await getData();
    if (method === "GET" && parts[0] === "state") return send(res, 200, publicState(data));

    if (method === "POST" && parts[0] === "login") {
      const { barberId, password, isOwner } = bodyOf(req);
      const barber = barberOf(data, barberId);
      if (!barber) return send(res, 400, { error: "اختار الحلاق" });
      if (isOwner && password === (process.env.SUPER_ADMIN_PASSWORD || data.superAdminPassword)) {
        return send(res, 200, { role: "owner", barberId, barberName: barber.name });
      }
      if (!isOwner && password === barber.password) {
        return send(res, 200, { role: "barber", barberId, barberName: barber.name });
      }
      return send(res, 401, { error: "الباسوورد ماشي صحيح" });
    }

    if (parts[0] === "barbers" && parts[1] && parts[2] === "next" && method === "POST") {
      const barber = barberOf(data, parts[1]);
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      if (barber.status !== "OPEN") return send(res, 409, { error: "الحلاق ماشي محلول" });
      const next = barber.queue.shift();
      if (next) barber.currentlyServing = next.ticket;
      await saveData(data);
      return send(res, 200, publicState(data));
    }

    if (parts[0] === "barbers" && parts[1] && parts[2] === "status" && method === "PATCH") {
      const barber = barberOf(data, parts[1]);
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      const requested = bodyOf(req);
      const status = ["OPEN", "PAUSED", "CLOSED_FOR_DAY"].includes(requested.status)
        ? requested.status
        : (requested.isOpen === false ? "PAUSED" : "OPEN");
      const affectedClients = setStatus(barber, status);
      await saveData(data);
      return send(res, 200, { state: publicState(data), affectedClients, barber: { id: barber.id, name: barber.name } });
    }

    if (parts[0] === "queue" && parts[1] === "join" && method === "POST") {
      const { barberId, name, clientId } = bodyOf(req);
      const barber = barberOf(data, barberId);
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      if (barber.status === "CLOSED_FOR_DAY") return send(res, 409, { error: "هاد الحلاق سالى خدمتو لليوم" });
      if (findClient(data, clientId)) return send(res, 409, { error: "عندك نوبة مسجلة دابا" });
      const clientName = String(name || "").trim();
      if (!clientName) return send(res, 400, { error: "دخل سميتك" });
      const client = { id: clientId, name: clientName, ticket: allocateTicket(barber) };
      barber.queue.push(client);
      await saveData(data);
      return send(res, 200, { client, state: publicState(data) });
    }

    if (parts[0] === "queue" && parts[1] === "leave" && method === "POST") {
      const { barberId, clientId } = bodyOf(req);
      const barber = barberOf(data, barberId);
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      barber.queue = barber.queue.filter((client) => client.id !== clientId);
      await saveData(data);
      return send(res, 200, publicState(data));
    }

    if (parts[0] === "queue" && parts[1] === "switch" && method === "POST") {
      const { fromBarberId, toBarberId, clientId, name } = bodyOf(req);
      const from = barberOf(data, fromBarberId);
      const to = barberOf(data, toBarberId);
      if (!from || !to) return send(res, 404, { error: "الحلاق ما كاينش" });
      if (fromBarberId === toBarberId) return send(res, 409, { error: "راه نتا عند هاد الحلاق" });
      if (to.status === "CLOSED_FOR_DAY") return send(res, 409, { error: "هاد الحلاق سالى خدمتو لليوم" });
      const existing = findClient(data, clientId);
      if (!existing || existing.barber.id !== fromBarberId) return send(res, 409, { error: "ما لقيناش النوبة ديالك" });
      from.queue = from.queue.filter((client) => client.id !== clientId);
      const client = { ...existing.client, name: String(name || existing.client.name).trim(), ticket: allocateTicket(to) };
      to.queue.push(client);
      await saveData(data);
      return send(res, 200, { client, state: publicState(data) });
    }

    if (parts[0] === "queue" && parts[1] === "skip" && method === "POST") {
      const { barberId, clientId } = bodyOf(req);
      const barber = barberOf(data, barberId);
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      barber.queue = barber.queue.filter((client) => client.id !== clientId);
      await saveData(data);
      return send(res, 200, publicState(data));
    }

    if (parts[0] === "barbers" && !parts[1] && method === "POST") {
      const { name, password } = bodyOf(req);
      const barberName = String(name || "").trim();
      const barberPassword = String(password || "").trim();
      if (!barberName || !barberPassword) return send(res, 400, { error: "دخل الاسم والباسوورد" });
      data.barbers.push({ id: `b${Date.now()}`, name: barberName, password: barberPassword, status: "OPEN", isOpen: true, currentlyServing: 0, queue: [], nextTicket: 1 });
      await saveData(data);
      return send(res, 201, publicState(data));
    }

    if (parts[0] === "barbers" && parts[1] && method === "PATCH") {
      const barber = barberOf(data, parts[1]);
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      const requested = bodyOf(req);
      if (requested.name !== undefined) barber.name = String(requested.name).trim();
      if (requested.password !== undefined && String(requested.password).trim()) barber.password = String(requested.password).trim();
      await saveData(data);
      return send(res, 200, publicState(data));
    }

    if (parts[0] === "barbers" && parts[1] && method === "DELETE") {
      if (data.barbers.length === 1) return send(res, 409, { error: "خاص يبقى حلاق واحد على الأقل" });
      data.barbers = data.barbers.filter((barber) => barber.id !== parts[1]);
      await saveData(data);
      return send(res, 200, publicState(data));
    }

    if (parts[0] === "ads" && method === "PUT") {
      const { ads } = bodyOf(req);
      if (!Array.isArray(ads) || ads.length > 3) return send(res, 400, { error: "الحد الأقصى هو 3 إعلانات" });
      data.ads = ads.map((ad, index) => ({ id: ad.id || `ad${Date.now()}${index}`, imageUrl: String(ad.imageUrl || ""), description: String(ad.description || "") }));
      await saveData(data);
      return send(res, 200, publicState(data));
    }

    return send(res, 404, { error: "المسار ما كاينش" });
  } catch (error) {
    console.error("API error:", error);
    const message = error instanceof Error ? error.message : "وقع مشكل فالسيرفر";
    return send(res, 500, { error: message });
  }
};
