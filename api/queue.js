import { getData, saveData, publicState } from "../lib/store.js";

function send(res, status, body) {
  res.setHeader("Content-Type", "application/json");
  return res.status(status).json(body);
}

function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return {};
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

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    if (req.method !== "POST") return send(res, 405, { success: false, message: "Method not allowed" });

    const { action, barberId, clientId, name, fromBarberId, toBarberId } = bodyOf(req);
    const data = await getData();

    if (action === "join") {
      const barber = barberOf(data, barberId);
      if (!barber) return send(res, 404, { success: false, message: "الحلاق ما كاينش", error: "الحلاق ما كاينش" });
      if (barber.status === "CLOSED_FOR_DAY") return send(res, 409, { success: false, message: "هاد الحلاق سالى خدمتو لليوم", error: "هاد الحلاق سالى خدمتو لليوم" });
      if (findClient(data, clientId)) return send(res, 409, { success: false, message: "عندك نوبة مسجلة دابا", error: "عندك نوبة مسجلة دابا" });
      const clientName = String(name || "").trim();
      if (!clientName) return send(res, 400, { success: false, message: "دخل سميتك", error: "دخل سميتك" });
      const client = { id: clientId, name: clientName, ticket: barber.nextTicket++ };
      barber.queue.push(client);
      await saveData(data);
      return send(res, 200, { success: true, client, state: publicState(data) });
    }

    if (action === "leave" || action === "skip") {
      const barber = barberOf(data, barberId);
      if (!barber) return send(res, 404, { success: false, message: "الحلاق ما كاينش", error: "الحلاق ما كاينش" });
      barber.queue = barber.queue.filter((client) => client.id !== clientId);
      await saveData(data);
      return send(res, 200, { success: true, state: publicState(data) });
    }

    if (action === "switch") {
      const from = barberOf(data, fromBarberId);
      const to = barberOf(data, toBarberId);
      if (!from || !to) return send(res, 404, { success: false, message: "الحلاق ما كاينش", error: "الحلاق ما كاينش" });
      if (fromBarberId === toBarberId) return send(res, 409, { success: false, message: "راه نتا عند هاد الحلاق", error: "راه نتا عند هاد الحلاق" });
      if (to.status === "CLOSED_FOR_DAY") return send(res, 409, { success: false, message: "هاد الحلاق سالى خدمتو لليوم", error: "هاد الحلاق سالى خدمتو لليوم" });
      const existing = findClient(data, clientId);
      if (!existing || existing.barber.id !== fromBarberId) return send(res, 409, { success: false, message: "ما لقيناش النوبة ديالك", error: "ما لقيناش النوبة ديالك" });
      from.queue = from.queue.filter((client) => client.id !== clientId);
      const client = { ...existing.client, name: String(name || existing.client.name).trim(), ticket: to.nextTicket++ };
      to.queue.push(client);
      await saveData(data);
      return send(res, 200, { success: true, client, state: publicState(data) });
    }

    return send(res, 400, { success: false, message: "عملية queue غير معروفة", error: "عملية queue غير معروفة" });
  } catch (error) {
    console.error("Queue API error:", error);
    const message = error instanceof Error ? error.message : "وقع مشكل فالسيرفر";
    return send(res, 500, { success: false, message, error: message });
  }
}
