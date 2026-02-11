import { getSupabaseAdminClient, listLotes } from "../lib/lotesService.mjs";

export default async function handler(_req, res) {
  if (_req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const items = await listLotes(supabase);
    res.status(200).json({ items, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Vercel API GET /api/lotes error:", error);
    res.status(500).json({ error: "No se pudo leer lotes desde Supabase" });
  }
}

