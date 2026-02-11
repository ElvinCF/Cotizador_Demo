import { createClient } from "@supabase/supabase-js";

const ALLOWED_STATUS = new Set(["LIBRE", "SEPARADO", "VENDIDO"]);
const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

const cleanNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).replace(/[^\d.,-]/g, "").replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeStatus = (value) => {
  const normalized = String(value || "LIBRE").trim().toUpperCase();
  return ALLOWED_STATUS.has(normalized) ? normalized : "LIBRE";
};

const normalizeText = (value) => String(value ?? "").trim();

const toCurrentTimestamp = () => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mmm = MONTHS[now.getMonth()];
  const aa = String(now.getFullYear()).slice(-2);
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${dd}-${mmm}-${aa} ${hh}:${mi}:${ss}`;
};

export const toLoteId = (mz, lote) => `${String(mz).trim().toUpperCase()}-${String(lote).padStart(2, "0")}`;

export const getSupabaseAdminClient = () => {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRole) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, serviceRole, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

const mapDbRowToLote = (row) => ({
  id: row.id,
  mz: row.mz,
  lote: row.lote,
  areaM2: row.area,
  price: row.precio,
  condicion: normalizeStatus(row.condicion),
  asesor: row.asesor || undefined,
  cliente: row.cliente || undefined,
  comentario: row.comentario || undefined,
  ultimaModificacion: row.ultima_modificacion || undefined,
});

export const listLotes = async (supabase) => {
  const { data, error } = await supabase
    .from("lotes")
    .select("id,mz,lote,area,precio,condicion,asesor,cliente,comentario,ultima_modificacion")
    .order("mz", { ascending: true })
    .order("lote", { ascending: true });

  if (error) throw error;
  return (data || []).map(mapDbRowToLote);
};

export const updateLoteById = async (supabase, loteId, payload) => {
  const patch = {
    condicion: normalizeStatus(payload.estado),
    asesor: normalizeText(payload.asesor),
    cliente: normalizeText(payload.cliente),
    comentario: normalizeText(payload.comentario),
    ultima_modificacion: toCurrentTimestamp(),
  };

  if (payload.price !== undefined) {
    patch.precio = cleanNumber(payload.price);
  }

  const { data, error } = await supabase
    .from("lotes")
    .update(patch)
    .eq("id", String(loteId || "").trim().toUpperCase())
    .select("id,mz,lote,area,precio,condicion,asesor,cliente,comentario,ultima_modificacion")
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return mapDbRowToLote(data);
};

