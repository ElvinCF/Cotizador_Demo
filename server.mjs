import express from "express";
import { getSupabaseAdminClient, listLotes, updateLoteById } from "./lib/lotesService.mjs";

const PORT = Number(process.env.PORT || 8787);

const app = express();
app.use(express.json());

app.get("/api/lotes", async (_req, res) => {
  try {
    const supabase = getSupabaseAdminClient();
    const items = await listLotes(supabase);
    res.json({ items, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Error reading lotes from Supabase:", error);
    res.status(500).json({ error: "No se pudo leer lotes desde Supabase" });
  }
});

app.put("/api/lotes/:id", async (req, res) => {
  try {
    const supabase = getSupabaseAdminClient();
    const item = await updateLoteById(supabase, req.params.id, req.body ?? {});

    if (!item) {
      res.status(404).json({ error: "Lote no encontrado" });
      return;
    }

    res.json({ item, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Error updating lote in Supabase:", error);
    res.status(500).json({ error: "No se pudo actualizar lote en Supabase" });
  }
});

app.listen(PORT, () => {
  console.log(`Supabase API running on http://127.0.0.1:${PORT}`);
});

