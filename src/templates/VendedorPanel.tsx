import { useEffect, useMemo, useState } from "react";

type Lote = {
  id: string;
  mz: string;
  lote: number;
  areaM2: number | null;
  price: number | null;
  condicion: string;
  asesor?: string;
  cliente?: string;
  comentario?: string;
  ultimaModificacion?: string;
};

type EditableFields = {
  price: string;
  asesor: string;
  estado: string;
  cliente: string;
  comentario: string;
};

const formatArea = (value: number | null) => (value == null ? "-" : value.toFixed(2));

const statusToClass = (value: string | undefined) => {
  switch ((value || "").toUpperCase()) {
    case "SEPARADO":
      return "separado";
    case "VENDIDO":
      return "vendido";
    default:
      return "libre";
  }
};

const normalizeStatus = (value: string | undefined) => {
  const normalized = String(value || "LIBRE").toUpperCase();
  if (normalized === "SEPARADO" || normalized === "VENDIDO") return normalized;
  return "LIBRE";
};

const toPriceInput = (value: number | null | undefined) =>
  value == null || Number.isNaN(value) ? "" : String(value);

const numberFromInput = (value: string) => {
  if (!value.trim()) return null;
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};

const emptyDraft: EditableFields = {
  price: "",
  asesor: "",
  estado: "LIBRE",
  cliente: "",
  comentario: "",
};

function VendedorPanel() {
  const [rows, setRows] = useState<Lote[]>([]);
  const [drafts, setDrafts] = useState<Record<string, EditableFields>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>("");

  const loadRows = async (keepNotice = true) => {
    try {
      if (!keepNotice) setNotice("");
      const response = await fetch("/api/lotes", { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { items?: Lote[] };
      setRows(Array.isArray(payload.items) ? payload.items : []);
      setError(null);
    } catch (loadError) {
      setError("No se pudo cargar la data del vendedor. Verifica la API.");
      console.error(loadError);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows();
  }, []);

  const filteredRows = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const raw = [
        row.id,
        row.mz,
        String(row.lote),
        String(row.price ?? ""),
        row.asesor || "",
        row.condicion,
        row.cliente || "",
        row.comentario || "",
      ]
        .join(" ")
        .toLowerCase();
      return raw.includes(term);
    });
  }, [query, rows]);

  const readValue = (row: Lote, field: keyof EditableFields) => {
    const draft = drafts[row.id];
    if (draft) return draft[field];
    if (field === "price") return toPriceInput(row.price);
    if (field === "estado") return normalizeStatus(row.condicion);
    if (field === "asesor") return row.asesor ?? "";
    if (field === "cliente") return row.cliente ?? "";
    return row.comentario ?? "";
  };

  const writeDraft = (row: Lote, field: keyof EditableFields, value: string) => {
    setDrafts((current) => {
      const base = current[row.id] ?? {
        ...emptyDraft,
        price: toPriceInput(row.price),
        asesor: row.asesor ?? "",
        estado: normalizeStatus(row.condicion),
        cliente: row.cliente ?? "",
        comentario: row.comentario ?? "",
      };
      return {
        ...current,
        [row.id]: {
          ...base,
          [field]: value,
        },
      };
    });
  };

  const isDirty = (row: Lote) => {
    const draft = drafts[row.id];
    if (!draft) return false;
    return (
      numberFromInput(draft.price) !== (row.price ?? null) ||
      draft.asesor !== (row.asesor ?? "") ||
      draft.estado !== normalizeStatus(row.condicion) ||
      draft.cliente !== (row.cliente ?? "") ||
      draft.comentario !== (row.comentario ?? "")
    );
  };

  const hasPendingChanges = rows.some((row) => isDirty(row));

  const saveRow = async (row: Lote) => {
    const draft = drafts[row.id];
    if (!draft) return;
    setSavingId(row.id);
    setNotice("");
    try {
      const response = await fetch(`/api/lotes/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          price: numberFromInput(draft.price),
          asesor: draft.asesor,
          estado: normalizeStatus(draft.estado),
          cliente: draft.cliente,
          comentario: draft.comentario,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as { item?: Lote };
      if (payload.item) {
        setRows((current) => current.map((item) => (item.id === row.id ? payload.item! : item)));
      }
      setDrafts((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setNotice(`Lote ${row.id} guardado`);
      setError(null);
    } catch (saveError) {
      setError(`No se pudo guardar ${row.id}`);
      console.error(saveError);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <section className="seller-page">
      <div className="seller-page__head">
        <div>
          <div className="seller-page__title-row">
            <h2>Pagina de vendedores</h2>
            <div className="seller-page__actions">
              <button className="btn ghost" onClick={() => loadRows(false)}>
                Refrescar
              </button>
            </div>
          </div>
          <p className={hasPendingChanges ? "seller-pending warn" : "seller-pending"}>
            {hasPendingChanges ? "Hay cambios sin guardar en la tabla." : "No hay cambios pendientes."}
          </p>
          <div className="seller-search-block">
            <label htmlFor="seller-search">Buscar en la tabla</label>
            <input
              id="seller-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por lote, asesor, cliente o comentario"
            />
          </div>
        </div>
      </div>

      {loading ? <p className="muted">Cargando lotes...</p> : null}
      {error ? <p className="seller-error">{error}</p> : null}
      {notice ? (
        <p className="seller-notice">
          <span>{notice}</span>
          <button
            type="button"
            className="seller-notice__close"
            onClick={() => setNotice("")}
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </p>
      ) : null}

      <div className="seller-table-wrap">
        <table className="seller-edit-table">
          <thead>
            <tr>
              <th>MZ</th>
              <th>LOTE</th>
              <th>AREA (m²)</th>
              <th>PRECIO</th>
              <th>CONDICION</th>
              <th>ASESOR</th>
              <th>CLIENTE</th>
              <th>COMENTARIO</th>
              <th>ULTIMA_MODIFICACION</th>
              <th>ACCION</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row) => {
              const currentStatus = readValue(row, "estado");
              const dirty = isDirty(row);
              const disabled = savingId === row.id;
              return (
                <tr key={row.id}>
                  <td>{row.mz}</td>
                  <td>{row.lote}</td>
                  <td>{formatArea(row.areaM2)}</td>
                  <td>
                    <div className="seller-price-input">
                      <span>S/</span>
                      <input
                        type="number"
                        step="0.01"
                        value={readValue(row, "price")}
                        onChange={(event) => writeDraft(row, "price", event.target.value)}
                      />
                    </div>
                  </td>
                  <td>
                    <select
                      className={`seller-status ${statusToClass(currentStatus)}`}
                      value={currentStatus}
                      onChange={(event) => writeDraft(row, "estado", event.target.value)}
                    >
                      <option value="LIBRE">LIBRE</option>
                      <option value="SEPARADO">SEPARADO</option>
                      <option value="VENDIDO">VENDIDO</option>
                    </select>
                  </td>
                  <td>
                    <input
                      value={readValue(row, "asesor")}
                      onChange={(event) => writeDraft(row, "asesor", event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={readValue(row, "cliente")}
                      onChange={(event) => writeDraft(row, "cliente", event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      value={readValue(row, "comentario")}
                      onChange={(event) => writeDraft(row, "comentario", event.target.value)}
                    />
                  </td>
                  <td>{row.ultimaModificacion ?? "-"}</td>
                  <td>
                    <button
                      className="btn"
                      disabled={!dirty || disabled}
                      onClick={() => saveRow(row)}
                    >
                      {disabled ? "Guardando..." : "Guardar"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default VendedorPanel;
