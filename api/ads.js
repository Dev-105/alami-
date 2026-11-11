import { getData, saveData, publicState } from "../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  try {
    if (req.method !== "PUT") return res.status(405).json({ error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (!Array.isArray(body.ads) || body.ads.length > 3) return res.status(400).json({ error: "الحد الأقصى هو 3 إعلانات" });
    const data = await getData();
    data.ads = body.ads.map((ad, index) => ({ id: ad.id || `ad${Date.now()}${index}`, imageUrl: String(ad.imageUrl || ""), description: String(ad.description || "") }));
    await saveData(data);
    return res.status(200).json(publicState(data));
  } catch (error) {
    const message = error instanceof Error ? error.message : "وقع مشكل فالسيرفر";
    return res.status(500).json({ success: false, message, error: message });
  }
}
