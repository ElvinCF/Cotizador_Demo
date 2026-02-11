import { readFileSync } from "node:fs";
import Papa from "papaparse";
import { getSupabaseAdminClient, toLoteId } from "../lib/lotesService.mjs";

const CSV_PATH = "public/assets/lotes.csv";
const BATCH_SIZE = 200;

const cleanNumber = (value) => {
  if (value == null || value === "") return null;
  const normalized = String(value).replace(/[^\d.,-]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStatus = (value) => {
  const normalized = String(value || "LIBRE").trim().toUpperCase();
  if (normalized === "SEPARADO" || normalized === "VENDIDO") return normalized;
  return "LIBRE";
};

const normalizeText = (value) => String(value ?? "").trim();

const csv = readFileSync(CSV_PATH, "utf8");
const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
const rows = Array.isArray(parsed.data) ? parsed.data : [];

const mapped = rows
  .map((row) => {
    const mz = normalizeText(row.MZ).toUpperCase();
    const lote = Number.parseInt(normalizeText(row.LOTE), 10);
    if (!mz || Number.isNaN(lote)) return null;
    return {
      id: toLoteId(mz, lote),
      mz,
      lote,
      area: cleanNumber(row.AREA),
      precio: cleanNumber(row.PRECIO),
      condicion: normalizeStatus(row.CONDICION),
      asesor: normalizeText(row.ASESOR),
      cliente: normalizeText(row.CLIENTE),
      comentario: normalizeText(row.COMENTARIO),
      ultima_modificacion: normalizeText(row.ULTIMA_MODIFICACION),
    };
  })
  .filter(Boolean);

const supabase = getSupabaseAdminClient();

for (let i = 0; i < mapped.length; i += BATCH_SIZE) {
  const chunk = mapped.slice(i, i + BATCH_SIZE);
  const { error } = await supabase
    .from("lotes")
    .upsert(chunk, { onConflict: "id", ignoreDuplicates: false });

  if (error) {
    console.error("Error en upsert:", error);
    process.exit(1);
  }
}

console.log(`Seed completado: ${mapped.length} lotes upsertados en Supabase`);

