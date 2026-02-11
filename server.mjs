import express from "express";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);
const CSV_PATH = path.join(__dirname, "public", "assets", "lotes.csv");
const ALLOWED_STATUS = new Set(["LIBRE", "SEPARADO", "VENDIDO"]);
const REQUIRED_COLUMNS = [
  "MZ",
  "LOTE",
  "AREA",
  "PRECIO",
  "CONDICION",
  "ASESOR",
  "CLIENTE",
  "COMENTARIO",
  "ULTIMA_MODIFICACION",
];

const app = express();
app.use(express.json());

const cleanNumber = (value) => {
  if (!value) return null;
  const normalized = String(value).replace(/[^\d.,-]/g, "").replace(",", "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStatus = (value) => {
  const normalized = String(value || "LIBRE").trim().toUpperCase();
  return ALLOWED_STATUS.has(normalized) ? normalized : "LIBRE";
};

const toLoteId = (mz, lote) => `${mz}-${String(lote).padStart(2, "0")}`;

const formatReal = (value) => {
  if (value == null || Number.isNaN(value)) return "";
  return Number(value).toFixed(2);
};

const normalizeText = (value) => String(value ?? "").trim();
const toCurrentTimestamp = () => {
  const now = new Date();
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  const dd = String(now.getDate()).padStart(2, "0");
  const mmm = months[now.getMonth()];
  const aa = String(now.getFullYear()).slice(-2);
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${dd}-${mmm}-${aa} ${hh}:${mi}:${ss}`;
};

const parseCsv = (text) => {
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
  });
  const rows = Array.isArray(parsed.data) ? parsed.data : [];
  const fields = Array.isArray(parsed.meta?.fields) ? [...parsed.meta.fields] : [];
  return { rows, fields };
};

const mapRowToLote = (row) => {
  const mz = normalizeText(row.MZ).toUpperCase();
  const lote = Number.parseInt(normalizeText(row.LOTE), 10);
  if (!mz || Number.isNaN(lote)) return null;

  const areaM2 = cleanNumber(row.AREA);
  const price = cleanNumber(row.PRECIO);
  return {
    id: toLoteId(mz, lote),
    mz,
    lote,
    areaM2,
    price,
    condicion: normalizeStatus(row.CONDICION),
    asesor: normalizeText(row.ASESOR) || undefined,
    cliente: normalizeText(row.CLIENTE) || undefined,
    comentario: normalizeText(row.COMENTARIO) || undefined,
    ultimaModificacion: normalizeText(row.ULTIMA_MODIFICACION) || undefined,
  };
};

const ensureColumns = (fields) => {
  const next = [...fields];
  REQUIRED_COLUMNS.forEach((column) => {
    if (!next.includes(column)) next.push(column);
  });
  return next;
};

const readCsvState = async () => {
  const csvText = await fs.readFile(CSV_PATH, "utf8");
  const parsed = parseCsv(csvText);
  return {
    rows: parsed.rows,
    fields: ensureColumns(parsed.fields),
  };
};

const writeCsvState = async ({ rows, fields }) => {
  const csv = Papa.unparse(rows, {
    columns: ensureColumns(fields),
    newline: "\n",
  });
  await fs.writeFile(CSV_PATH, csv, "utf8");
};

app.get("/api/lotes", async (_req, res) => {
  try {
    const { rows } = await readCsvState();
    const lotes = rows.map(mapRowToLote).filter(Boolean);
    res.json({ items: lotes, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Error reading CSV:", error);
    res.status(500).json({ error: "No se pudo leer lotes.csv" });
  }
});

app.put("/api/lotes/:id", async (req, res) => {
  try {
    const loteId = normalizeText(req.params.id).toUpperCase();
    const payload = req.body ?? {};
    const { rows, fields } = await readCsvState();

    const index = rows.findIndex((row) => {
      const mz = normalizeText(row.MZ).toUpperCase();
      const lote = Number.parseInt(normalizeText(row.LOTE), 10);
      if (!mz || Number.isNaN(lote)) return false;
      return toLoteId(mz, lote) === loteId;
    });

    if (index < 0) {
      res.status(404).json({ error: "Lote no encontrado" });
      return;
    }

    const row = rows[index];
    row.CONDICION = normalizeStatus(payload.estado ?? row.CONDICION);
    row.ASESOR = normalizeText(payload.asesor ?? row.ASESOR);
    row.CLIENTE = normalizeText(payload.cliente ?? row.CLIENTE);
    row.COMENTARIO = normalizeText(payload.comentario ?? row.COMENTARIO);
    row.ULTIMA_MODIFICACION = toCurrentTimestamp();

    if (payload.price !== undefined) {
      const price = cleanNumber(payload.price);
      row.PRECIO = price == null ? "" : formatReal(price);
    }

    await writeCsvState({ rows, fields });
    const updated = mapRowToLote(row);
    res.json({ item: updated, savedAt: new Date().toISOString() });
  } catch (error) {
    console.error("Error writing CSV:", error);
    res.status(500).json({ error: "No se pudo actualizar lotes.csv" });
  }
});

app.listen(PORT, () => {
  console.log(`CSV API running on http://localhost:${PORT}`);
});
