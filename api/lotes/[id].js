import { getSupabaseAdminClient, updateLoteById } from "../../lib/lotesService.mjs";

export default async function handler(req, res) {
  if (req.method !== "PUT") {
    res.setHeader("Allow", "PUT");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const supabase = getSupabaseAdminClient();
    const item = await updateLoteById(supabase, req.query.id, req.body ?? {});

    if (!item) {
      res.status(404).json({ error: "Lote no encontrado" });
      return;
    }

    res.status(200).json({ item, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Vercel API PUT /api/lotes/:id error:", error);
    res.status(500).json({ error: "No se pudo actualizar lote en Supabase" });
  }
}

