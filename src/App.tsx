import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import Papa from "papaparse";
import ArenasSvg from "./components/arenas";
import { projectInfo } from "./data/projectInfo";
import VendedorPanel from "./templates/VendedorPanel";
import "./App.css";

const MemoArenasSvg = memo(ArenasSvg);

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

type CsvRow = {
  MZ?: string;
  LOTE?: string;
  AREA?: string;
  PRECIO?: string;
  CONDICION?: string;
  ASESOR?: string;
  CLIENTE?: string;
  COMENTARIO?: string;
  ULTIMA_MODIFICACION?: string;
};

type QuoteState = {
  precio: number;
  inicialMonto: number;
  cuotas: number;
  interesAnual: number;
};

type OverlayTransform = {
  x: number;
  y: number;
  scale: number;
};

type ProformaState = {
  cliente: {
    nombre: string;
    dni: string;
    celular: string;
    direccion: string;
    correo: string;
  };
  lote: {
    proyecto: string;
    mz: string;
    lote: string;
    area: string;
    ubicacion: string;
  };
  precioRegular: number;
  precioPromocional: number;
  descuentoSoles: number;
  descuentoPct: number;
  diasVigencia: number;
  fechaCaducidad: string;
  separacion: number;
  inicial: number;
  meses: number;
  vendedor: {
    nombre: string;
    celular: string;
  };
  creadoEn: string;
};

const PROFORMA_VENDOR_KEY = "arenas.proforma.vendor.v1";
const PROYECTO_FIJO = "Arenas Malabrigo";
const EMPRESA_DIRECCION =
  "CALLE BALTAZAR GAVILAN mz: F Lote: 7 URB. SANTO DOMINGUITO TRUJILLO LA LIBERTAD";

const defaultQuote: QuoteState = {
  precio: 0,
  inicialMonto: 6000,
  cuotas: 24,
  interesAnual: 0,
};

const MAP_WIDTH = 1122;
const MAP_HEIGHT = 1588;
const mapVars = {
  "--map-width": `${MAP_WIDTH}px`,
  "--map-height": `${MAP_HEIGHT}px`,
} as React.CSSProperties;

const defaultOverlay: OverlayTransform = {
  x: 131,
  y: 137,
  scale: 0.715,
};

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

const normalizeStatusLabel = (value: string | undefined) => {
  switch ((value || "").toUpperCase()) {
    case "VENDIDO":
      return "VENDIDO";
    case "SEPARADO":
      return "SEPARADO";
    default:
      return "DISPONIBLE";
  }
};

const cleanNumber = (value: string | undefined) => {
  if (!value) return null;
  const normalized = value.replace(/[^\d.,-]/g, "").replace(",", "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const toLoteId = (mz: string, lote: number) => `${mz}-${String(lote).padStart(2, "0")}`;

const formatMoney = (value: number | null) => {
  if (value == null) return "-";
  return new Intl.NumberFormat("es-PE", {
    style: "currency",
    currency: "PEN",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatArea = (value: number | null) => {
  if (value == null) return "-";
  return `${value.toFixed(2)} m2`;
};

const formatNumber = (value: number | null) => {
  if (value == null || Number.isNaN(value)) return "";
  return value.toFixed(2);
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const toDateValue = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (base: Date, days: number) => {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return next;
};

const quoteMonthly = (monto: number, cuotas: number, interesAnual: number) => {
  if (cuotas <= 0) return 0;
  const i = interesAnual / 12 / 100;
  if (i <= 0) return monto / cuotas;
  const factor = (i * Math.pow(1 + i, cuotas)) / (Math.pow(1 + i, cuotas) - 1);
  return monto * factor;
};

const buildIdSet = (items: Lote[]) => new Set(items.map((item) => item.id));

const overlayStyle = (transform: OverlayTransform) => ({
  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
  transformOrigin: "top left",
});

const loadLotesFromApi = async (): Promise<Lote[]> => {
  const response = await fetch("/api/lotes", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`No se pudo cargar lotes: ${response.status}`);
  }
  const payload = (await response.json()) as { items?: Lote[] };
  return Array.isArray(payload.items) ? payload.items : [];
};

const loadLotesFromCsvFallback = async (): Promise<Lote[]> => {
  const response = await fetch("/assets/lotes.csv", { cache: "no-store" });
  const text = await response.text();
  const parsed = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: true,
  });
  return (parsed.data || []).flatMap((row: CsvRow): Lote[] => {
    const mz = (row.MZ || "").trim().toUpperCase();
    const lote = Number.parseInt((row.LOTE || "").trim(), 10);
    if (!mz || Number.isNaN(lote)) return [];
    const areaM2 = cleanNumber(row.AREA);
    const price = cleanNumber(row.PRECIO);
    const condicion = (row.CONDICION || "LIBRE").trim().toUpperCase();
    const asesor = (row.ASESOR || "").trim();
    const cliente = (row.CLIENTE || "").trim();
    const comentario = (row.COMENTARIO || "").trim();
    const ultimaModificacion = (row.ULTIMA_MODIFICACION || "").trim();
    return [
      {
        id: toLoteId(mz, lote),
        mz,
        lote,
        areaM2,
        price,
        condicion: condicion || "LIBRE",
        asesor: asesor || undefined,
        cliente: cliente || undefined,
        comentario: comentario || undefined,
        ultimaModificacion: ultimaModificacion || undefined,
      },
    ];
  });
};

function App() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [rawLotes, setRawLotes] = useState<Lote[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredPos, setHoveredPos] = useState({ x: 0, y: 0 });
  const [rightOpen, setRightOpen] = useState(false);
  const [quote, setQuote] = useState<QuoteState>(defaultQuote);
  const [filters, setFilters] = useState({
    mz: "",
    status: "TODOS",
    priceMin: "",
    priceMax: "",
    areaMin: "",
    areaMax: "",
  });
  const [tableFiltersOpen, setTableFiltersOpen] = useState(true);
  const [view, setView] = useState<"mapa" | "tabla">("mapa");
  const [overlay] = useState<OverlayTransform>(defaultOverlay);
  const [drawerTab, setDrawerTab] = useState<"cotizar" | "separar" | "proforma">("cotizar");
  const [proformaOpen, setProformaOpen] = useState(false);
  const [proformaDirty, setProformaDirty] = useState(false);
  const [proformaConfirmClose, setProformaConfirmClose] = useState(false);
  const [proformaAlert, setProformaAlert] = useState<string | null>(null);
  const [proforma, setProforma] = useState<ProformaState>({
    cliente: { nombre: "", dni: "", celular: "", direccion: "", correo: "" },
    lote: { proyecto: PROYECTO_FIJO, mz: "", lote: "", area: "", ubicacion: "" },
    precioRegular: 0,
    precioPromocional: 0,
    descuentoSoles: 0,
    descuentoPct: 0,
    diasVigencia: 3,
    fechaCaducidad: toDateValue(addDays(new Date(), 3)),
    separacion: 0,
    inicial: 6000,
    meses: 24,
    vendedor: { nombre: "", celular: "" },
    creadoEn: new Date().toISOString(),
  });
  const [mapTransform, setMapTransform] = useState({
    scale: 1,
    positionX: 0,
    positionY: 0,
  });
  const [isPanning, setIsPanning] = useState(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number } | null>(null);
  const draggedRef = useRef(false);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const transformRef = useRef<ReactZoomPanPinchRef>(null);
  const mapTransformRef = useRef(mapTransform);
  const transformRafRef = useRef<number | null>(null);
  const containerSizeRef = useRef({ width: 0, height: 0 });
  const hasFitRef = useRef(false);
  const lastHoveredRef = useRef<string | null>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const highlightedRef = useRef<Set<string>>(new Set());
  const hoverPosRef = useRef({ x: 0, y: 0 });
  const hoverRafRef = useRef<number | null>(null);
  const lastPriceEditedRef = useRef<"soles" | "pct" | "promo" | null>(null);

  useEffect(() => {
    let active = true;
    const syncLotes = async () => {
      try {
        const items = await loadLotesFromApi();
        if (active) {
          setRawLotes(items);
        }
      } catch (error) {
        console.error(error);
        try {
          const fallbackItems = await loadLotesFromCsvFallback();
          if (active) {
            setRawLotes(fallbackItems);
          }
        } catch (fallbackError) {
          console.error(fallbackError);
        }
      }
    };

    syncLotes();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(PROFORMA_VENDOR_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { nombre?: string; celular?: string };
      setProforma((current) => ({
        ...current,
        vendedor: {
          nombre: saved.nombre ?? current.vendedor.nombre,
          celular: saved.celular ?? current.vendedor.celular,
        },
      }));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (!proformaOpen) return;
    const raw = localStorage.getItem(PROFORMA_VENDOR_KEY);
    if (!raw) return;
    try {
      const saved = JSON.parse(raw) as { nombre?: string; celular?: string };
      setProforma((current) => ({
        ...current,
        vendedor: {
          nombre: saved.nombre ?? current.vendedor.nombre,
          celular: saved.celular ?? current.vendedor.celular,
        },
      }));
    } catch {
      // ignore
    }
  }, [proformaOpen]);

  useEffect(() => {
    localStorage.setItem(PROFORMA_VENDOR_KEY, JSON.stringify(proforma.vendedor));
  }, [proforma.vendedor]);

  const lotes = rawLotes;

  const filteredLotes = useMemo(() => {
    const mz = filters.mz.trim().toUpperCase();
    const status = filters.status.toUpperCase();
    const priceMin = filters.priceMin ? Number(filters.priceMin) : null;
    const priceMax = filters.priceMax ? Number(filters.priceMax) : null;
    const areaMin = filters.areaMin ? Number(filters.areaMin) : null;
    const areaMax = filters.areaMax ? Number(filters.areaMax) : null;

    return lotes.filter((lote) => {
      if (mz && lote.mz !== mz) return false;
      if (status !== "TODOS" && lote.condicion !== status) return false;
      if (priceMin != null && (lote.price ?? 0) < priceMin) return false;
      if (priceMax != null && (lote.price ?? 0) > priceMax) return false;
      if (areaMin != null && (lote.areaM2 ?? 0) < areaMin) return false;
      if (areaMax != null && (lote.areaM2 ?? 0) > areaMax) return false;
      return true;
    });
  }, [filters, lotes]);

  const highlightedIds = useMemo(() => buildIdSet(filteredLotes), [filteredLotes]);

  const selectedLote = useMemo(
    () => lotes.find((item) => item.id === selectedId) ?? null,
    [lotes, selectedId]
  );

  useEffect(() => {
    if (selectedLote?.price != null) {
      setQuote((current) => ({
        ...current,
        precio: selectedLote.price || 0,
      }));
    }
    if (selectedLote) {
      setDrawerTab("cotizar");
    }
  }, [selectedLote?.price]);

  useEffect(() => {
    const root = svgRef.current;
    if (!root || view !== "mapa") return;
    const prev = lastHoveredRef.current;
    if (prev && prev !== hoveredId) {
      const prevEl = root.querySelector(`#${CSS.escape(prev)}`);
      prevEl?.classList.remove("is-hovered");
    }
    if (hoveredId) {
      const nextEl = root.querySelector(`#${CSS.escape(hoveredId)}`);
      nextEl?.classList.add("is-hovered");
    }
    lastHoveredRef.current = hoveredId;
  }, [hoveredId, view]);

  useEffect(() => {
    const root = svgRef.current;
    if (!root || view !== "mapa") return;
    const prev = lastSelectedRef.current;
    if (prev && prev !== selectedId) {
      const prevEl = root.querySelector(`#${CSS.escape(prev)}`);
      prevEl?.classList.remove("is-selected");
    }
    if (selectedId) {
      const nextEl = root.querySelector(`#${CSS.escape(selectedId)}`);
      nextEl?.classList.add("is-selected");
    }
    lastSelectedRef.current = selectedId;
  }, [selectedId, view]);

  useEffect(() => {
    const root = svgRef.current;
    if (!root || view !== "mapa") return;
    const prev = highlightedRef.current;
    highlightedIds.forEach((id) => {
      if (!prev.has(id)) {
        const target = root.querySelector(`#${CSS.escape(id)}`);
        target?.classList.add("is-highlighted");
      }
    });
    prev.forEach((id) => {
      if (!highlightedIds.has(id)) {
        const target = root.querySelector(`#${CSS.escape(id)}`);
        target?.classList.remove("is-highlighted");
      }
    });
    highlightedRef.current = new Set(highlightedIds);
  }, [highlightedIds, view]);

  useEffect(() => {
    const root = svgRef.current;
    if (!root || view !== "mapa") return;
    lotes.forEach((lote) => {
      const target = root.querySelector(`#${CSS.escape(lote.id)}`);
      if (target) {
        target.setAttribute("data-status", lote.condicion);
      }
    });
  }, [lotes, view]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (proformaOpen) {
          if (proformaDirty) {
            setProformaConfirmClose(true);
          } else {
            setProformaOpen(false);
          }
          return;
        }
        setRightOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      if (hoverRafRef.current != null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
      if (transformRafRef.current != null) {
        cancelAnimationFrame(transformRafRef.current);
        transformRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const element = mapContainerRef.current;
    if (!element || !transformRef.current) return;

    const fitToContainer = () => {
      const { width, height } = element.getBoundingClientRect();
      if (!width || !height) return;

      const nextScale = Math.min(width / MAP_WIDTH, height / MAP_HEIGHT);
      const nextX = (width - MAP_WIDTH * nextScale) / 2;
      const nextY = (height - MAP_HEIGHT * nextScale) / 2;

      containerSizeRef.current = { width, height };
      transformRef.current?.setTransform(nextX, nextY, nextScale, 0, "easeOut");
    };

    const observer = new ResizeObserver(() => {
      if (!hasFitRef.current) {
        fitToContainer();
        hasFitRef.current = true;
      }
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);



  // moved below drawerCount to avoid temporal dead zone



  const handleSvgPointer = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    const target = event.target as SVGElement | null;
    const id = target?.getAttribute("id");
    if (!id || !/^[A-Z]-\d+/.test(id)) {
      if (event.type !== "click") {
        setHoveredId(null);
      }
      return;
    }
    if (event.type === "click") {
      if (draggedRef.current) {
        draggedRef.current = false;
        return;
      }
      setSelectedId(id);
      setRightOpen(true);
      return;
    }
    if (hoveredId !== id) {
      setHoveredId(id);
    }
    hoverPosRef.current = { x: event.clientX, y: event.clientY };
    if (hoverRafRef.current == null) {
      hoverRafRef.current = requestAnimationFrame(() => {
        setHoveredPos(hoverPosRef.current);
        hoverRafRef.current = null;
      });
    }
  }, [hoveredId]);

  const handleSvgLeave = useCallback(() => {
    setHoveredId(null);
  }, []);

  const resetFilters = () =>
    setFilters({
      mz: "",
      status: "TODOS",
      priceMin: "",
      priceMax: "",
      areaMin: "",
      areaMax: "",
    });

  const montoInicial = Math.min(quote.inicialMonto, quote.precio);
  const financiado = Math.max(quote.precio - montoInicial, 0);
  const cuota = quoteMonthly(financiado, quote.cuotas, 0);
  const cuotaRapida = (meses: number, inicial: number) =>
    Math.max((quote.precio - inicial) / meses, 0);

  const hoveredLote = useMemo(
    () => lotes.find((item) => item.id === hoveredId) ?? null,
    [hoveredId, lotes]
  );

  const proformaAhorro = Math.max(proforma.precioRegular - proforma.precioPromocional, 0);
  const precioFinanciarRegular = Math.max(
    proforma.precioRegular - proforma.separacion - proforma.inicial,
    0
  );
  const precioFinanciarPromo = Math.max(
    proforma.precioPromocional - proforma.separacion - proforma.inicial,
    0
  );
  const proformaCuotaRegular = proforma.meses ? precioFinanciarRegular / proforma.meses : 0;
  const proformaCuotaPromo = proforma.meses ? precioFinanciarPromo / proforma.meses : 0;
  const cuotasRapidas = (monto: number) => ({
    12: Math.max(monto / 12, 0),
    24: Math.max(monto / 24, 0),
    36: Math.max(monto / 36, 0),
  });

  const refreshProformaFromLote = (lote: Lote) => {
    const regular = lote.price ?? 0;
    const promo = regular;
    const inicial = clamp(6000, 6000, promo || 6000);
    const dias = 3;
    lastPriceEditedRef.current = null;
    setProforma({
      cliente: { nombre: "", dni: "", celular: "", direccion: "", correo: "" },
      lote: {
        proyecto: PROYECTO_FIJO,
        mz: lote.mz,
        lote: String(lote.lote),
        area: formatArea(lote.areaM2),
        ubicacion: projectInfo.locationText,
      },
      precioRegular: regular,
      precioPromocional: promo,
      descuentoSoles: Math.max(regular - promo, 0),
      descuentoPct: regular ? Math.max(((regular - promo) / regular) * 100, 0) : 0,
      diasVigencia: dias,
      fechaCaducidad: toDateValue(addDays(new Date(), dias)),
      separacion: 0,
      inicial,
      meses: 24,
      vendedor: proforma.vendedor,
      creadoEn: new Date().toISOString(),
    });
    setProformaDirty(false);
  };

  const recalcProforma = (draft: ProformaState) => {
    const regular = Math.max(draft.precioRegular, 0);
    let promo = Math.max(draft.precioPromocional, 0);
    let descuentoSoles = Math.max(draft.descuentoSoles, 0);
    let descuentoPct = Math.max(draft.descuentoPct, 0);

    if (lastPriceEditedRef.current === "soles") {
      descuentoSoles = clamp(descuentoSoles, 0, regular);
      descuentoPct = regular ? (descuentoSoles / regular) * 100 : 0;
      promo = Math.max(regular - descuentoSoles, 0);
    } else if (lastPriceEditedRef.current === "pct") {
      descuentoPct = clamp(descuentoPct, 0, 100);
      descuentoSoles = (descuentoPct / 100) * regular;
      promo = Math.max(regular - descuentoSoles, 0);
    } else if (lastPriceEditedRef.current === "promo") {
      promo = clamp(promo, 0, regular);
      descuentoSoles = Math.max(regular - promo, 0);
      descuentoPct = regular ? (descuentoSoles / regular) * 100 : 0;
    } else {
      promo = clamp(promo, 0, regular);
      descuentoSoles = Math.max(regular - promo, 0);
      descuentoPct = regular ? (descuentoSoles / regular) * 100 : 0;
    }

    const dias = clamp(Math.round(draft.diasVigencia || 0), 1, 30);
    const fechaCaducidad = toDateValue(addDays(new Date(), dias));
    const separacion = Math.max(draft.separacion, 0);
    const inicial = Math.max(draft.inicial || 0, 6000);
    const meses = clamp(Math.round(draft.meses || 1), 1, 36);

    return {
      ...draft,
      precioRegular: regular,
      precioPromocional: promo,
      descuentoSoles,
      descuentoPct,
      diasVigencia: dias,
      fechaCaducidad,
      separacion,
      inicial,
      meses,
    };
  };

  const updateProforma = (updater: (current: ProformaState) => ProformaState) => {
    setProforma((current) => recalcProforma(updater(current)));
    setProformaDirty(true);
  };


  const exportTableCsv = () => {
    const headers = ["MZ", "LT", "AREA_M2", "ASESOR", "PRECIO", "CONDICION"];
    const rows = filteredLotes.map((lote) => [
      lote.mz,
      String(lote.lote),
      formatNumber(lote.areaM2),
      lote.asesor ?? "",
      formatNumber(lote.price),
      lote.condicion,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lotes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const overlayStyleMemo = useMemo(() => overlayStyle(overlay), [overlay]);

  const exportPrintable = async () => {
    const standardQuoteHtml = `
      <section class="card">
        <h3>Cotizacion estandar</h3>
        <div class="grid">
          <div><span>Precio</span><strong>${formatMoney(quote.precio)}</strong></div>
          <div><span>Inicial</span><strong>${formatMoney(montoInicial)}</strong></div>
          <div><span>Meses</span><strong>${quote.cuotas}</strong></div>
          <div><span>Cuota mensual</span><strong>${formatMoney(cuota)}</strong></div>
        </div>
      </section>
    `;

    const manualQuoteHtml = `
      <section class="card">
        <h3>Cotizacion manual</h3>
        <div class="grid">
          <div><span>Precio</span><strong>${formatMoney(quote.precio)}</strong></div>
          <div><span>Inicial</span><strong>${formatMoney(montoInicial)}</strong></div>
          <div><span>Meses</span><strong>${quote.cuotas}</strong></div>
          <div><span>Cuota mensual</span><strong>${formatMoney(cuota)}</strong></div>
        </div>
        <p class="muted">Formula: (Precio - Inicial) / Meses</p>
      </section>
    `;

    const loteHtml = selectedLote
      ? `
      <section class="card">
        <h3>Detalle del lote</h3>
        <div class="grid">
          <div><span>Lote</span><strong>${selectedLote.id}</strong></div>
          <div><span>Area</span><strong>${formatArea(selectedLote.areaM2)}</strong></div>
          <div><span>Precio</span><strong>${formatMoney(selectedLote.price)}</strong></div>
          <div><span>Estado</span><strong>${selectedLote.condicion}</strong></div>
          <div><span>Asesor</span><strong>${selectedLote.asesor ?? "—"}</strong></div>
        </div>
      </section>
    `
      : "";

    const tableHtml =
      view === "tabla"
        ? `
      <section class="card">
        <h3>Resumen de lotes (${filteredLotes.length})</h3>
        <table>
          <thead>
            <tr>
              <th>MZ</th>
              <th>LT</th>
              <th>AREA (M2)</th>
              <th>ASESOR</th>
              <th>PRECIO</th>
              <th>CONDICION</th>
            </tr>
          </thead>
          <tbody>
            ${filteredLotes
              .map(
                (lote) => `
              <tr>
                <td>${lote.mz}</td>
                <td>${lote.lote}</td>
                <td>${formatArea(lote.areaM2)}</td>
                <td>${lote.asesor ?? "—"}</td>
                <td>${formatMoney(lote.price)}</td>
                <td>${lote.condicion}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </section>
    `
        : "";

    let mapCaptureHtml = "";
    if (view === "mapa" && mapContainerRef.current) {
      const { default: html2canvas } = await import("html2canvas");
      const target = mapContainerRef.current;
      const canvas = await html2canvas(target, {
        backgroundColor: "#f7f0e4",
        useCORS: true,
        scale: 2,
        scrollX: 0,
        scrollY: 0,
        windowWidth: target.clientWidth,
        windowHeight: target.clientHeight,
        onclone: (doc) => {
          doc.querySelectorAll(".map-controls, .hover-tooltip").forEach((el) => {
            (el as HTMLElement).style.display = "none";
          });
          doc.querySelectorAll(".map-container").forEach((el) => {
            const node = el as HTMLElement;
            node.style.position = "relative";
            node.style.top = "0";
            node.style.left = "0";
          });
        },
      });
      const dataUrl = canvas.toDataURL("image/png");
      mapCaptureHtml = `
        <section class="card">
          <h3>Vista actual del mapa</h3>
          <div class="map-box">
            <img src="${dataUrl}" alt="Mapa capturado" />
          </div>
        </section>
      `;
    }

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Reporte Arenas Malabrigo</title>
          <style>
            @page { size: A4; margin: 14mm; }
            body { font-family: "Space Grotesk", Arial, sans-serif; color: #1b1b1b; }
            h1 { margin: 0 0 6px; color: #c24a18; }
            .sub { margin: 0 0 16px; color: #6a5c4c; }
            .card { border: 1px solid #efd4c1; border-radius: 12px; padding: 12px; margin-bottom: 12px; }
            .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; }
            .grid span { display: block; font-size: 12px; color: #6a5c4c; }
            .grid strong { font-size: 14px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { padding: 6px 8px; border-bottom: 1px solid #f0dccd; text-align: left; }
            th { background: #fff3e7; color: #8f3a18; }
            .map-box img { width: 100%; border-radius: 8px; border: 1px solid #f0dccd; }
            .muted { color: #6a5c4c; font-size: 12px; margin-top: 6px; }
          </style>
        </head>
        <body>
          <h1>Mapa interactivo – Arenas Malabrigo</h1>
          <p class="sub">Reporte generado el ${new Date().toLocaleString("es-PE")}</p>
          ${loteHtml}
          ${standardQuoteHtml}
          ${manualQuoteHtml}
          ${mapCaptureHtml}
          ${tableHtml}
        </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=1024,height=768");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const exportProforma = async () => {
    const requiredName = proforma.cliente.nombre.trim();
    const requiredDni = proforma.cliente.dni.trim();
    const requiredCel = proforma.cliente.celular.trim();
    if (!requiredName || !requiredDni || !requiredCel) {
      setProformaAlert("Completa nombre, DNI y celular del cliente para imprimir la proforma.");
      return;
    }

    const created = new Date(proforma.creadoEn);
    const line = (value: string) => (value.trim() ? value : "__________________________");
    const vendorName = line(proforma.vendedor.nombre);
    const vendorPhone = line(proforma.vendedor.celular);
    const clientName = line(proforma.cliente.nombre);
    const clientDni = line(proforma.cliente.dni);
    const clientCel = line(proforma.cliente.celular);
    const clientAddress = line(proforma.cliente.direccion);
    const clientMail = line(proforma.cliente.correo);

    const html = `
      <html>
        <head>
          <meta charset="UTF-8" />
          <title>Proforma Arenas Malabrigo</title>
          <style>
            @page { size: A4; margin: 12mm; }
            body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #1b1b1b; }
            .page { border: 2px solid #d7b08a; border-radius: 16px; padding: 0; position: relative; overflow: hidden; }
            .page::before,
            .page::after {
              content: "";
              position: absolute;
              left: 0;
              right: 0;
              height: 14mm;
              background: linear-gradient(135deg, #1f8a4c 0 45%, #f4b24d 45% 60%, #1f8a4c 60% 100%);
            }
            .page::before { top: 0; }
            .page::after {
              bottom: 0;
              transform: rotate(180deg);
            }
            .page-content { padding: 18mm 14px 18mm; position: relative; z-index: 1; }
            .header { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
            .header h1 { margin: 0; font-size: 20px; color: #b14518; }
            .meta { font-size: 11px; color: #6a5c4c; }
            .meta-line { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
            .meta-line .expiry { font-weight: 700; font-size: 1.05rem; color: #b14518; }
            .seller-name { font-size: 1.1rem; font-weight: 700; color: #1b1b1b; }
            .logo { height: 34px; object-fit: contain; }
            .section { border: 1px solid #efd4c1; border-radius: 12px; padding: 10px 12px; margin-top: 10px; }
            .section h2 { margin: 0 0 8px; font-size: 12px; color: #8f3a18; text-transform: uppercase; letter-spacing: 0.02em; }
            .grid-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px 10px; }
            .grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }
            .label { font-size: 11px; color: #6a5c4c; display: block; }
            .value { font-weight: 600; font-size: 12px; }
            .price-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 10px; }
            .price-card { border: 2px solid #7a4a00; border-radius: 14px; padding: 12px; background: #fffdf9; font-size: 1.08rem; }
            .price-card h3 { margin: 0 0 8px; font-size: 1.35rem; }
            .price-card .price { font-size: 1.85rem; font-weight: 700; color: #b14518; }
            .price-card .sub { font-size: 1.05rem; color: #6a5c4c; }
            .price-list { margin-top: 6px; display: grid; gap: 4px; font-size: 1.2rem; }
            .price-list > div { display: flex; justify-content: space-between; gap: 8px; }
            .price-list strong { text-align: right; font-weight: 700; }
            .quick { border: 1px solid #2c2c2c; border-radius: 12px; padding: 8px 10px; margin-top: 8px; font-size: 1.15rem; border-color: #c47a00; }
            .quick-row { display: flex; justify-content: space-between; }
            .savings { margin-top: 10px; font-weight: 800; font-size: 1.45rem; text-align: center; color: #1f8a4c; }
            .expiry { margin-top: 4px; font-weight: 700; font-size: 1.1rem; color: #b14518; }
            .monthly { font-size: 1.2rem; font-weight: 700; }
            .footer { margin-top: 12px; display: flex; justify-content: space-between; align-items: center; }
            .footer .meta { font-size: 12px; }
            .project-logo { height: 40px; object-fit: contain; border: 1px solid #efd4c1; border-radius: 10px; padding: 6px; background: #fffaf1; }
          </style>
        </head>
        <body>
          <div class="page">
            <div class="page-content">
            <div class="header">
              <div>
                <h1>Proforma Arenas Malabrigo</h1>
                <div class="meta-line">
                  <div class="meta">Fecha y hora: ${created.toLocaleString("es-PE")}</div>
                  <div class="expiry">Vence: ${proforma.fechaCaducidad}</div>
                </div>
                <div class="meta">Agente de ventas: <span class="seller-name">${vendorName}</span> · ${vendorPhone}</div>
              </div>
              <img src="/assets/Logo_Arenas_Malabrigo.svg" class="logo" alt="Arenas Malabrigo" />
            </div>

            <section class="section">
              <h2>Datos del cliente</h2>
              <div class="grid-4">
                <div><span class="label">Nombre completo</span><span class="value">${clientName}</span></div>
                <div><span class="label">DNI</span><span class="value">${clientDni}</span></div>
                <div><span class="label">Celular</span><span class="value">${clientCel}</span></div>
                <div><span class="label">Direccion</span><span class="value">${clientAddress}</span></div>
                <div><span class="label">Correo</span><span class="value">${clientMail}</span></div>
              </div>
            </section>

            <section class="section">
              <h2>Informacion del lote</h2>
              <div class="grid-4">
                <div><span class="label">Proyecto</span><span class="value">${proforma.lote.proyecto}</span></div>
                <div><span class="label">Ubicacion referencial</span><span class="value">${proforma.lote.ubicacion}</span></div>
                <div><span class="label">Manzana</span><span class="value">${proforma.lote.mz}</span></div>
                <div><span class="label">Lote</span><span class="value">${proforma.lote.lote}</span></div>
                <div><span class="label">Area total</span><span class="value">${proforma.lote.area}</span></div>
              </div>
            </section>

            <div class="price-grid">
              <div class="price-card">
                <h3>Precio regular</h3>
                <div class="price">${formatMoney(proforma.precioRegular)}</div>
                <div class="price-list">
                  <div>Separacion: ${formatMoney(proforma.separacion)}</div>
                  <div>Inicial: ${formatMoney(proforma.inicial)}</div>
                  <div>Precio a financiar: ${formatMoney(precioFinanciarRegular)}</div>
                </div>
                <div class="quick">
                  <div class="sub">Cotizado rapido de pago mensual</div>
                  <div class="quick-row"><span>12 meses</span><strong>${formatMoney(cuotasRapidas(precioFinanciarRegular)[12])}</strong></div>
                  <div class="quick-row"><span>24 meses</span><strong>${formatMoney(cuotasRapidas(precioFinanciarRegular)[24])}</strong></div>
                  <div class="quick-row"><span>36 meses</span><strong>${formatMoney(cuotasRapidas(precioFinanciarRegular)[36])}</strong></div>
                </div>
                <div class="sub monthly">Pago mensual en ${proforma.meses} meses: ${formatMoney(proformaCuotaRegular)}</div>
              </div>
              <div class="price-card">
                <h3>Precio promocional</h3>
                <div class="price" style="color:#1f8a4c;">${formatMoney(proforma.precioPromocional)}</div>
                <div class="price-list">
                  <div>Separacion: ${formatMoney(proforma.separacion)}</div>
                  <div>Inicial: ${formatMoney(proforma.inicial)}</div>
                  <div>Precio a financiar: ${formatMoney(precioFinanciarPromo)}</div>
                </div>
                <div class="quick">
                  <div class="sub">Cotizado rapido de pago mensual</div>
                  <div class="quick-row"><span>12 meses</span><strong>${formatMoney(cuotasRapidas(precioFinanciarPromo)[12])}</strong></div>
                  <div class="quick-row"><span>24 meses</span><strong>${formatMoney(cuotasRapidas(precioFinanciarPromo)[24])}</strong></div>
                  <div class="quick-row"><span>36 meses</span><strong>${formatMoney(cuotasRapidas(precioFinanciarPromo)[36])}</strong></div>
                </div>
                <div class="sub monthly">Pago mensual en ${proforma.meses} meses: ${formatMoney(proformaCuotaPromo)}</div>
              </div>
            </div>

            <div class="savings">Ahorro en: ${formatMoney(proformaAhorro)}</div>

            <div class="footer">
              <div class="meta">
                <div><strong>Datos de la empresa</strong></div>
                <div>${projectInfo.owner} · RUC ${projectInfo.ownerRuc}</div>
                <div>${EMPRESA_DIRECCION}</div>
              </div>
              <img src="/assets/HOLA-TRUJILLO_LOGOTIPO.webp" class="project-logo" alt="Hola Trujillo" />
            </div>
            </div>
          </div>
        </body>
      </html>
    `;
    const win = window.open("", "_blank", "width=1024,height=768");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    win.print();
  };

  const openProforma = () => {
    if (!selectedLote) {
      setProformaAlert("Selecciona un lote para crear la proforma.");
      return;
    }
    if (selectedLote.condicion === "VENDIDO") {
      setProformaAlert("Este lote esta vendido. No se puede crear proforma.");
      return;
    }
    refreshProformaFromLote(selectedLote);
    setProformaOpen(true);
  };

  const drawerCount = rightOpen ? 1 : 0;
  const MapView = (
    <section className="map-page">
      <section className="map-intro">
        <div className="map-intro__title">
          <div>
            <span className="intro-kicker">Proyecto inmobiliario</span>
            <div className="project-title">
              <a
                href="https://holatrujillo.com/condominio-ecologico-arenas-malabrigo/"
                target="_blank"
                rel="noreferrer"
                className="project-logo-link"
              >
                <img
                  src="/assets/Logo_Arenas_Malabrigo.svg"
                  alt={projectInfo.name}
                  className="project-logo"
                />
              </a>
              <div>
                <h3>
                  {projectInfo.stage}
                </h3>
                <p className="intro-sub">
                  Lotes listos para invertir o vivir. Servicios instalados y seguridad permanente.
                </p>
              </div >
            </div>
          </div >
          <div className="intro-owner">
            <span>Propietario</span>
            <a href="https://www.holatrujillo.com/" target="_blank" rel="noreferrer">
              <img
                src="/assets/HOLA-TRUJILLO_LOGOTIPO.webp"
                alt={projectInfo.owner}
              />
            </a>
            <a
              className="btn ghost instagram"
              href="https://www.instagram.com/arenasmalabrigo/"
              target="_blank"
              rel="noreferrer"
            >
              📸 Instagram
            </a>
          </div>
        </div>

        <div className="map-intro__split">
          <div className="map-intro__summary">
            <div className="intro-location">
              <h4>Ubicacion</h4>
              <ul>
                <li>Predio: {projectInfo.location.predio}</li>
                <li>Distrito: {projectInfo.location.distrito}</li>
                <li>Provincia: {projectInfo.location.provincia}</li>
                <li>Departamento: {projectInfo.location.departamento}</li>
              </ul>
            </div>
            <div className="intro-amenities">
              <h4>Beneficios del proyecto</h4>
              <ul>
                {projectInfo.amenities.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="map-intro__cards">
            <div className="map-intro__panel-title">Razones para elegir tu lote</div>
            <div className="map-intro__grid">
              {projectInfo.salesHighlights.map((card) => (
                <article key={card.title}>
                  <h4>{card.title}</h4>
                  <p>{card.description}</p>
                </article>
              ))}
            </div>
          </div>
        </div>

      </section>

      <section className={`map-shell drawer-open-${drawerCount}`}>
        <section className="map-card viewer">
          <div className="map-header">
          <div className="view-toggle">
            <button
              className={view === "mapa" ? "btn active" : "btn ghost"}
              onClick={() => setView("mapa")}
            >
              Mapa
            </button>
            <button
              className={view === "tabla" ? "btn active" : "btn ghost"}
              onClick={() => setView("tabla")}
            >
              Tabla
            </button>
          </div>
            <div className="map-header__info">
              <strong>{filteredLotes.length} de {lotes.length}</strong> lotes
          </div>
          <div className="legend">
            <span className="legend__item libre">DISPONIBLE</span>
            <span className="legend__item separado">SEPARADO</span>
            <span className="legend__item vendido">VENDIDO</span>
          </div>
          <div className="export-actions">
            {selectedLote && selectedLote.condicion !== "VENDIDO" && (
              <button className="btn ghost" onClick={openProforma}>
                Crear proforma
              </button>
            )}
            <button className="btn ghost" onClick={exportPrintable}>
              Imprimir
            </button>
            {view === "tabla" && (
              <button className="btn ghost" onClick={exportTableCsv}>
                Exportar Excel
              </button>
            )}
          </div>
        </div>
          <div
            ref={mapContainerRef}
            className={`map-container ${isPanning ? "is-panning" : ""}`}
            style={mapVars}
          >
          {view === "mapa" ? (
            <TransformWrapper
              ref={transformRef}
              minScale={0.4}
              maxScale={6}
              initialScale={1}
              limitToBounds={false}
              centerZoomedOut={false}
              centerOnInit={false}
              initialPositionX={0}
              initialPositionY={0}
              alignmentAnimation={{ disabled: true }}
              panning={{ velocityDisabled: true }}
              wheel={{ step: 0.04, smoothStep: 0.003 }}
              onTransformed={(_, state) => {
                mapTransformRef.current = state;
                if (transformRafRef.current == null) {
                  transformRafRef.current = requestAnimationFrame(() => {
                    setMapTransform(mapTransformRef.current);
                    transformRafRef.current = null;
                  });
                }
                if (isPanningRef.current && panStartRef.current) {
                  const dx = state.positionX - panStartRef.current.x;
                  const dy = state.positionY - panStartRef.current.y;
                  if (Math.hypot(dx, dy) > 2) {
                    draggedRef.current = true;
                  }
                }
              }}
              onPanningStart={() => {
                setIsPanning(true);
                isPanningRef.current = true;
                draggedRef.current = false;
                panStartRef.current = {
                  x: mapTransformRef.current.positionX,
                  y: mapTransformRef.current.positionY,
                };
              }}
              onPanningStop={() => {
                setIsPanning(false);
                isPanningRef.current = false;
                panStartRef.current = null;
              }}
            >
              {({ zoomIn, zoomOut, resetTransform, setTransform }) => (
                <>
                  <div className="map-controls">
                    <button className="btn ghost" onClick={() => zoomIn()}>
                      +
                    </button>
                    <button className="btn ghost" onClick={() => zoomOut()}>
                      -
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        if (mapContainerRef.current) {
                          const { width, height } = mapContainerRef.current.getBoundingClientRect();
                          const nextScale = Math.min(width / MAP_WIDTH, height / MAP_HEIGHT);
                          const nextX = (width - MAP_WIDTH * nextScale) / 2;
                          const nextY = (height - MAP_HEIGHT * nextScale) / 2;
                          setTransform(nextX, nextY, nextScale);
                          return;
                        }
                        resetTransform();
                      }}
                    >
                      Reset
                    </button>
                    <div className="zoom-indicator">{Math.round(mapTransform.scale * 100)}%</div>
                    <input
                      className="zoom-slider"
                      type="range"
                      min={0.6}
                      max={6}
                      step={0.05}
                      value={mapTransform.scale}
                      onChange={(event) =>
                        setTransform(
                          mapTransform.positionX,
                          mapTransform.positionY,
                          Number(event.target.value)
                        )
                      }
                    />
                  </div>
                  <TransformComponent wrapperClass="transform-wrapper">
                    <div className="map-layer">
                      <img
                        src="/assets/plano-fondo-demo.webp"
                        alt="Plano de fondo"
                        className="map-background"
                        draggable={false}
                      />
                      <MemoArenasSvg
                        svgRef={svgRef}
                        className="lotes-svg"
                        style={overlayStyleMemo}
                        onMouseMove={handleSvgPointer}
                        onClick={handleSvgPointer}
                        onMouseLeave={handleSvgLeave}
                      />
                    </div>
                  </TransformComponent>
                </>
              )}
            </TransformWrapper>
          ) : (
            <div className="table-view">
              <div className="table-filters__header">
                <h4>Filtros</h4>
                <button
                  className="btn ghost"
                  onClick={() => setTableFiltersOpen((prev) => !prev)}
                >
                  {tableFiltersOpen ? "Ocultar" : "Mostrar"}
                </button>
              </div>
              <div className={`table-filters ${tableFiltersOpen ? "open" : "closed"}`}>
                <label>
                  MZ
                  <input
                    value={filters.mz}
                    onChange={(event) => setFilters({ ...filters, mz: event.target.value })}
                    placeholder="A o B"
                  />
                </label>
                <label>
                  Estado
                  <select
                    value={filters.status}
                    onChange={(event) => setFilters({ ...filters, status: event.target.value })}
                  >
                    <option value="TODOS">Todos</option>
                    <option value="LIBRE">Libre</option>
                    <option value="SEPARADO">Separado</option>
                    <option value="VENDIDO">Vendido</option>
                  </select>
                </label>
                <label>
                  Precio min
                  <input
                    type="number"
                    value={filters.priceMin}
                    onChange={(event) => setFilters({ ...filters, priceMin: event.target.value })}
                    placeholder="Desde S/ ..."
                  />
                </label>
                <label>
                  Precio max
                  <input
                    type="number"
                    value={filters.priceMax}
                    onChange={(event) => setFilters({ ...filters, priceMax: event.target.value })}
                    placeholder="Hasta S/ ..."
                  />
                </label>
                <label>
                  Area min
                  <input
                    type="number"
                    value={filters.areaMin}
                    onChange={(event) => setFilters({ ...filters, areaMin: event.target.value })}
                    placeholder="Min m2"
                  />
                </label>
                <label>
                  Area max
                  <input
                    type="number"
                    value={filters.areaMax}
                    onChange={(event) => setFilters({ ...filters, areaMax: event.target.value })}
                    placeholder="Max m2"
                  />
                </label>
                <button className="btn ghost" onClick={resetFilters}>
                  Limpiar
                </button>
              </div>
              <div className="table-scroll">
                <div className="table-header">
                  <span>MZ</span>
                  <span>LT</span>
                  <span>AREA (M2)</span>
                  <span>ASESOR</span>
                  <span>PRECIO</span>
                  <span>CONDICION</span>
                  <span></span>
                </div>
                {filteredLotes.map((lote) => (
                  <button
                    className={`table-row ${selectedId === lote.id ? "selected" : ""}`}
                    key={lote.id}
                    onClick={() => {
                      setSelectedId(lote.id);
                      setRightOpen(true);
                    }}
                  >
                    <span className="table-cell strong">{lote.mz}</span>
                    <span className="table-cell strong">{lote.lote}</span>
                    <span className="table-cell">{formatArea(lote.areaM2)}</span>
                    <span className="table-cell">{lote.asesor ?? "—"}</span>
                    <span className="table-cell">{formatMoney(lote.price)}</span>
                  <span className={`table-cell status-pill ${statusToClass(lote.condicion)}`}>
                      {normalizeStatusLabel(lote.condicion)}
                    </span>
                    <span className="table-cell table-action" aria-hidden="true">
                      🔎
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {hoveredLote && view === "mapa" && (
            <div
              className="hover-tooltip"
              style={{ left: hoveredPos.x + 12, top: hoveredPos.y + 12 }}
            >
              <strong>{hoveredLote.id}</strong>
              <span>{formatArea(hoveredLote.areaM2)}</span>
              <span>{formatMoney(hoveredLote.price)}</span>
              <span>{hoveredLote.condicion}</span>
            </div>
          )}
          </div>
          
        </section>

      <aside className={`drawer-panel right ${rightOpen ? "open" : ""}`}>
        <div className="drawer__header">
          <h3>Acciones</h3>
          <div className="drawer__header-actions">
            <button className="btn ghost" onClick={() => setRightOpen(false)}>
              Cerrar
            </button>
          </div>
        </div>
        <div className="drawer__body">
          {selectedLote ? (
            <>
              <div className="drawer-tabs">
                <button
                  className={`btn tab ${drawerTab === "cotizar" ? "active" : ""}`}
                  onClick={() => setDrawerTab("cotizar")}
                >
                  Cotizador
                </button>
                <button
                  className={`btn tab ${drawerTab === "separar" ? "active" : ""}`}
                  onClick={() => setDrawerTab("separar")}
                >
                  Separar Lote
                </button>
                {selectedLote.condicion !== "VENDIDO" && (
                  <button
                    className={`btn tab ${drawerTab === "proforma" ? "active" : ""}`}
                    onClick={() => setDrawerTab("proforma")}
                  >
                    Proforma
                  </button>
                )}
              </div>

              <div className="drawer-chips">
                <span className="chip">MZ {selectedLote.mz}</span>
                <span className="chip">Lote {selectedLote.lote}</span>
                <span className={`chip status-pill ${statusToClass(selectedLote.condicion)}`}>
                  {normalizeStatusLabel(selectedLote.condicion)}
                </span>
              </div>

              {drawerTab === "cotizar" ? (
                <>
                  <div className="drawer-cards">
                    <div className="drawer-card">
                      <span>Area</span>
                      <strong>{formatArea(selectedLote.areaM2)}</strong>
                    </div>
                    <div className="drawer-card">
                      <span>Precio</span>
                      <strong>{formatMoney(selectedLote.price)}</strong>
                    </div>
                    <div className="drawer-card">
                      <span>Asesor</span>
                      <strong>{selectedLote.asesor ?? "—"}</strong>
                    </div>
                    <div className="drawer-card">
                      <span>Inicial (referencia)</span>
                      <strong>{formatMoney(quote.inicialMonto)}</strong>
                    </div>
                  </div>

                  <div className="quick-quotes">
                    <h4>Cuotas rapidas (inicial fija {formatMoney(quote.inicialMonto)})</h4>
                    <div className="quick-grid">
                      {[12, 24, 36].map((meses) => (
                        <div className="quick-card" key={meses}>
                          <span>{meses} meses</span>
                          <strong>{formatMoney(cuotaRapida(meses, quote.inicialMonto))}</strong>
                        </div>
                      ))}
                      <div className="quick-card formula">
                        <span>Formula</span>
                        <strong>(Precio - Inicial) / Meses</strong>
                        <em>Referencia informativa.</em>
                      </div>
                    </div>
                  </div>

                  <div className="quote-box compact">
                    <h4>Cotizacion manual</h4>
                    <div className="quote-grid">
                      <label>
                        Inicial (S/)
                        <input
                          type="number"
                          min={6000}
                          value={quote.inicialMonto}
                          onChange={(event) =>
                            setQuote({
                              ...quote,
                              inicialMonto: Math.max(Number(event.target.value || 0), 6000),
                            })
                          }
                        />
                      </label>
                      <label>
                        Meses (1 a 36)
                        <input
                          type="number"
                          min={1}
                          max={36}
                          value={quote.cuotas}
                          onChange={(event) =>
                            setQuote({
                              ...quote,
                              cuotas: clamp(Number(event.target.value || 0), 1, 36),
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="quote-highlight">
                      <span>Cuota mensual estimada</span>
                      <strong>{formatMoney(cuota)}</strong>
                      <small>Formula: (Precio - Inicial) / Meses</small>
                    </div>
                  </div>
                </>
              ) : drawerTab === "separar" ? (
                <div className="client-form">
                  <h4>Separar lote</h4>
                  <label>
                    Nombre completo
                    <input placeholder="Cliente" />
                  </label>
                  <label>
                    DNI
                    <input placeholder="Documento" />
                  </label>
                  <label>
                    Telefono
                    <input placeholder="+51 ..." />
                  </label>
                  <label>
                    Email
                    <input placeholder="correo@ejemplo.com" />
                  </label>
                  <label>
                    Comentarios
                    <textarea placeholder="Detalle adicional" rows={3} />
                  </label>
                  <div className="drawer-actions">
                    <button className="btn primary">Registrar interes</button>
                    <button className="btn ghost">Contactar asesor</button>
                  </div>
                </div>
              ) : (
                <div className="drawer-proforma">
                  <h4>Crear proforma</h4>
                  {selectedLote.condicion === "VENDIDO" ? (
                    <p className="muted">Este lote esta vendido.</p>
                  ) : (
                    <>
                      <p className="muted">
                        Prepara una proforma con precio regular y promocional para este lote.
                      </p>
                      <button className="btn primary" onClick={openProforma}>
                        Abrir proforma
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="muted">Selecciona un lote para ver detalles.</p>
          )}
        </div>
      </aside>
    </section>
    </section>
  );

  return (
    <BrowserRouter>
      <div className="app-shell">
        <header className="topbar">
          <div className="brand">
            <div className="brand__headline">
              <span className="brand__icon" aria-hidden="true">
                🏖️
              </span>
              <div className="brand__text">
                <span className="brand__title">Mapa interactivo – Arenas Malabrigo</span>
                
              </div>
            </div>
          </div>
          <div className="topbar__actions">
            
          </div>
        </header>

        <main className="main">
          <Routes>
            <Route path="/" element={MapView} />
            <Route path="/vendedor" element={<VendedorPanel />} />
          </Routes>
        </main>

        {proformaOpen && (
          <div
            className="modal-backdrop"
            onClick={() => {
              if (proformaDirty) {
                setProformaConfirmClose(true);
              } else {
                setProformaOpen(false);
              }
            }}
          >
            <div
              className="proforma-modal"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="proforma-header">
                <div>
                  <h3>Proforma Arenas Malabrigo</h3>
                  <p className="muted">
                    {new Date(proforma.creadoEn).toLocaleString("es-PE")} · Vendedor:{" "}
                    {proforma.vendedor.nombre || "-"}
                  </p>
                </div>
                <div className="proforma-actions">
                  <button className="btn ghost" onClick={exportProforma}>
                    Imprimir
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => {
                      if (proformaDirty) {
                        setProformaConfirmClose(true);
                      } else {
                        setProformaOpen(false);
                      }
                    }}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
              <div className="proforma-body">
                <section className="proforma-section">
                  <h4>Agente de ventas</h4>
                  <div className="proforma-fields two-cols">
                    <label>
                      Nombre
                      <input
                        type="text"
                        value={proforma.vendedor.nombre}
                        onChange={(event) =>
                          updateProforma((current) => ({
                            ...current,
                            vendedor: { ...current.vendedor, nombre: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Numero
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\\d{9}"
                        value={proforma.vendedor.celular}
                        onChange={(event) =>
                          updateProforma((current) => ({
                            ...current,
                            vendedor: { ...current.vendedor, celular: event.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                </section>
                <section className="proforma-section">
                  <h3>Datos del cliente</h3>
                  <div className="proforma-fields two-cols">
                    <label>
                      Nombre completo
                      <input
                        type="text"
                        required
                        value={proforma.cliente.nombre}
                        onChange={(event) =>
                          updateProforma((current) => ({
                            ...current,
                            cliente: { ...current.cliente, nombre: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label>
                      DNI
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\\d{8}"
                        required
                        value={proforma.cliente.dni}
                        onChange={(event) =>
                          updateProforma((current) => ({
                            ...current,
                            cliente: { ...current.cliente, dni: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Celular
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="\\d{9}"
                        required
                        value={proforma.cliente.celular}
                        onChange={(event) =>
                          updateProforma((current) => ({
                            ...current,
                            cliente: { ...current.cliente, celular: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Direccion
                      <input
                        type="text"
                        value={proforma.cliente.direccion}
                        onChange={(event) =>
                          updateProforma((current) => ({
                            ...current,
                            cliente: { ...current.cliente, direccion: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label>
                      Correo
                      <input
                        type="email"
                        value={proforma.cliente.correo}
                        onChange={(event) =>
                          updateProforma((current) => ({
                            ...current,
                            cliente: { ...current.cliente, correo: event.target.value },
                          }))
                        }
                      />
                    </label>
                  </div>
                </section>

                <section className="proforma-section">
                  <h4>Informacion del lote</h4>
                  <div className="proforma-fields two-cols">
                    <label>
                      Proyecto / Urbanizacion
                      <span className="proforma-value">{proforma.lote.proyecto}</span>
                    </label>
                    <label>
                      Manzana
                      <span className="proforma-value">{proforma.lote.mz}</span>
                    </label>
                    <label>
                      Lote
                      <span className="proforma-value">{proforma.lote.lote}</span>
                    </label>
                    <label>
                      Area total (m2)
                      <span className="proforma-value">{proforma.lote.area}</span>
                    </label>
                    <label>
                      Ubicacion referencial
                      <span className="proforma-value">{proforma.lote.ubicacion}</span>
                    </label>
                  </div>
                </section>

                <section className="proforma-section">
                  <div className="proforma-section__head">
                    <h4>Cotizacion manual</h4>
                    <span className="muted">Solo para el vendedor</span>
                  </div>
                  <div className="proforma-manual">
                    <div className="proforma-manual__block">
                      <h5>Preguntar a cliente</h5>
                      <div className="proforma-fields manual-cols">
                        <label>
                          Inicial (S/)
                          <input
                            type="number"
                            min={6000}
                            value={proforma.inicial}
                            onChange={(event) => {
                              lastPriceEditedRef.current = null;
                              updateProforma((current) => ({
                                ...current,
                                inicial: Math.max(Number(event.target.value || 0), 6000),
                              }));
                            }}
                          />
                        </label>
                        <label>
                          Separacion (S/)
                          <input
                            type="number"
                            min={0}
                            value={proforma.separacion}
                            onChange={(event) => {
                              lastPriceEditedRef.current = null;
                              updateProforma((current) => ({
                                ...current,
                                separacion: Number(event.target.value || 0),
                              }));
                            }}
                          />
                        </label>
                        <label>
                          Meses (1 a 36)
                          <input
                            type="number"
                            min={1}
                            max={36}
                            value={proforma.meses}
                            onChange={(event) => {
                              lastPriceEditedRef.current = null;
                              updateProforma((current) => ({
                                ...current,
                                meses: clamp(Number(event.target.value || 0), 1, 36),
                              }));
                            }}
                          />
                        </label>
                      </div>
                      <small>Inicial minimo S/ 6,000</small>
                    </div>
                    <div className="proforma-manual__block">
                      <h5>Solo vendedor</h5>
                      <div className="proforma-fields manual-cols">
                        <label>
                          Descuento (S/)
                          <input
                            type="number"
                            min={0}
                            value={proforma.descuentoSoles}
                            onChange={(event) => {
                              lastPriceEditedRef.current = "soles";
                              updateProforma((current) => ({
                                ...current,
                                descuentoSoles: Number(event.target.value || 0),
                              }));
                            }}
                          />
                        </label>
                        <label>
                          Descuento (%)
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={proforma.descuentoPct}
                            onChange={(event) => {
                              lastPriceEditedRef.current = "pct";
                              updateProforma((current) => ({
                                ...current,
                                descuentoPct: Number(event.target.value || 0),
                              }));
                            }}
                          />
                        </label>
                        <label>
                          Precio promocional
                          <input
                            type="number"
                            min={0}
                            value={proforma.precioPromocional}
                            onChange={(event) => {
                              lastPriceEditedRef.current = "promo";
                              updateProforma((current) => ({
                                ...current,
                                precioPromocional: Number(event.target.value || 0),
                              }));
                            }}
                          />
                        </label>
                      </div>
                      <label className="manual-inline">
                        Duracion de la promocion (dias)
                        <input
                          type="number"
                          min={1}
                          max={30}
                          value={proforma.diasVigencia}
                          onChange={(event) =>
                            updateProforma((current) => ({
                              ...current,
                              diasVigencia: Number(event.target.value || 0),
                            }))
                          }
                        />
                      </label>
                      <small>Valido hasta {proforma.fechaCaducidad}</small>
                    </div>
                  </div>
                </section>

                <section className="proforma-section">
                  <h4>Resumen de precios</h4>
                  <div className="proforma-price-grid">
                    <article className="proforma-price-card">
                      <h5>Precio regular</h5>
                      <div className="price">{formatMoney(proforma.precioRegular)}</div>
                      <div className="price-list">
                        <div>
                          <span>Separacion</span>
                          <strong>{formatMoney(proforma.separacion)}</strong>
                        </div>
                        <div>
                          <span>Inicial</span>
                          <strong>{formatMoney(proforma.inicial)}</strong>
                        </div>
                        <div>
                          <span>Precio a financiar</span>
                          <strong>{formatMoney(precioFinanciarRegular)}</strong>
                        </div>
                      </div>
                      <div className="proforma-quick">
                        <span>Cotizado rapido de pago mensual</span>
                        <div>
                          <span>12 meses</span>
                          <strong>{formatMoney(cuotasRapidas(precioFinanciarRegular)[12])}</strong>
                        </div>
                        <div>
                          <span>24 meses</span>
                          <strong>{formatMoney(cuotasRapidas(precioFinanciarRegular)[24])}</strong>
                        </div>
                        <div>
                          <span>36 meses</span>
                          <strong>{formatMoney(cuotasRapidas(precioFinanciarRegular)[36])}</strong>
                        </div>
                      </div>
                      <div className="proforma-monthly">
                        Pago mensual en {proforma.meses} meses:{" "}
                        <strong>{formatMoney(proformaCuotaRegular)}</strong>
                      </div>
                    </article>
                    <article className="proforma-price-card promo">
                      <h5>Precio promocional</h5>
                      <div className="price">{formatMoney(proforma.precioPromocional)}</div>
                      <div className="price-list">
                        <div>
                          <span>Separacion</span>
                          <strong>{formatMoney(proforma.separacion)}</strong>
                        </div>
                        <div>
                          <span>Inicial</span>
                          <strong>{formatMoney(proforma.inicial)}</strong>
                        </div>
                        <div>
                          <span>Precio a financiar</span>
                          <strong>{formatMoney(precioFinanciarPromo)}</strong>
                        </div>
                      </div>
                      <div className="proforma-quick">
                        <span>Cotizado rapido de pago mensual</span>
                        <div>
                          <span>12 meses</span>
                          <strong>{formatMoney(cuotasRapidas(precioFinanciarPromo)[12])}</strong>
                        </div>
                        <div>
                          <span>24 meses</span>
                          <strong>{formatMoney(cuotasRapidas(precioFinanciarPromo)[24])}</strong>
                        </div>
                        <div>
                          <span>36 meses</span>
                          <strong>{formatMoney(cuotasRapidas(precioFinanciarPromo)[36])}</strong>
                        </div>
                      </div>
                      <div className="proforma-monthly">
                        Pago mensual en {proforma.meses} meses:{" "}
                        <strong>{formatMoney(proformaCuotaPromo)}</strong>
                      </div>
                    </article>
                  </div>
                  <div className="proforma-summary">
                    Ahorro en: <strong>{formatMoney(proformaAhorro)}</strong>
                  </div>
                </section>

                
              </div>
            </div>
          </div>
        )}

        {proformaConfirmClose && (
          <div className="modal-backdrop" onClick={() => setProformaConfirmClose(false)}>
            <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
              <h4>Descartar cambios?</h4>
              <p className="muted">Tienes cambios sin guardar. Deseas cerrar la proforma?</p>
              <div className="confirm-actions">
                <button className="btn ghost" onClick={() => setProformaConfirmClose(false)}>
                  Cancelar
                </button>
                <button
                  className="btn"
                  onClick={() => {
                    setProformaConfirmClose(false);
                    setProformaOpen(false);
                    setProformaDirty(false);
                  }}
                >
                  Descartar
                </button>
              </div>
            </div>
          </div>
        )}

        {proformaAlert && (
          <div className="modal-backdrop" onClick={() => setProformaAlert(null)}>
            <div className="confirm-modal" onClick={(event) => event.stopPropagation()}>
              <h4>Proforma</h4>
              <p className="muted">{proformaAlert}</p>
              <div className="confirm-actions">
                <button className="btn" onClick={() => setProformaAlert(null)}>
                  Entendido
                </button>
              </div>
            </div>
          </div>
        )}
        

        
      </div>
    </BrowserRouter>
  );
}

export default App;
