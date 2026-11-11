import { getData } from "../lib/store.js";

function bodyOf(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const { barberId, password, isOwner } = bodyOf(req);
    const data = await getData();
    const barber = data.barbers.find((item) => item.id === barberId);
    if (!barber) return res.status(400).json({ error: "اختار الحلاق" });
    if (isOwner && password === (process.env.SUPER_ADMIN_PASSWORD || data.superAdminPassword)) {
      return res.status(200).json({ role: "owner", barberId, barberName: barber.name });
    }
    if (!isOwner && password === barber.password) {
      return res.status(200).json({ role: "barber", barberId, barberName: barber.name });
    }
    return res.status(401).json({ error: "الباسوورد ماشي صحيح" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "وقع مشكل فالسيرفر";
    return res.status(500).json({ success: false, message, error: message });
  }
}
