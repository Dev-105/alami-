import { getData, publicState } from "../lib/store.js";

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
    return res.status(200).json(publicState(await getData()));
  } catch (error) {
    const message = error instanceof Error ? error.message : "وقع مشكل فالسيرفر";
    return res.status(500).json({ success: false, message, error: message });
  }
}
