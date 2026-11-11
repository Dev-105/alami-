import { getData, saveData, publicState } from "../lib/store.js";

function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function send(res, status, body) {
  return res.status(status).json(body);
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  try {
    if (req.method === "OPTIONS") return send(res, 204, {});
    const body = bodyOf(req);
    const data = await getData();
    const barberId = body.barberId;
    const barber = data.barbers.find((item) => item.id === barberId);

    if (req.method === "POST" && body.action === "next") {
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      if (barber.status !== "OPEN") return send(res, 409, { error: "الحلاق ماشي محلول" });
      const next = barber.queue.shift();
      if (next) barber.currentlyServing = next.ticket;
      await saveData(data);
      return send(res, 200, publicState(data));
    }

    if (req.method === "PATCH" && body.action === "status") {
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      const status = ["OPEN", "PAUSED", "CLOSED_FOR_DAY"].includes(body.status) ? body.status : "OPEN";
      const affectedClients = status === "CLOSED_FOR_DAY" ? [...barber.queue] : [];
      barber.status = status;
      barber.isOpen = status !== "CLOSED_FOR_DAY";
      if (status === "CLOSED_FOR_DAY") barber.queue = [];
      await saveData(data);
      return send(res, 200, { state: publicState(data), affectedClients, barber: { id: barber.id, name: barber.name } });
    }

    if (req.method === "POST" && !body.action) {
      const name = String(body.name || "").trim();
      const password = String(body.password || "").trim();
      if (!name || !password) return send(res, 400, { error: "دخل الاسم والباسوورد" });
      data.barbers.push({ id: `b${Date.now()}`, name, password, status: "OPEN", isOpen: true, currentlyServing: 0, queue: [], nextTicket: 1 });
      await saveData(data);
      return send(res, 201, publicState(data));
    }

    if (req.method === "PATCH" && body.action === "edit") {
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      if (body.name !== undefined) barber.name = String(body.name).trim();
      if (body.password !== undefined && String(body.password).trim()) barber.password = String(body.password).trim();
      await saveData(data);
      return send(res, 200, publicState(data));
    }

    if (req.method === "DELETE") {
      if (!barber) return send(res, 404, { error: "الحلاق ما كاينش" });
      if (data.barbers.length === 1) return send(res, 409, { error: "خاص يبقى حلاق واحد على الأقل" });
      data.barbers = data.barbers.filter((item) => item.id !== barberId);
      await saveData(data);
      return send(res, 200, publicState(data));
    }

    return send(res, 400, { error: "عملية الحلاق غير معروفة" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "وقع مشكل فالسيرفر";
    return send(res, 500, { success: false, message, error: message });
  }
}
