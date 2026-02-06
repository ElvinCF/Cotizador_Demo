import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import {
  TransformComponent,
  TransformWrapper,
  type ReactZoomPanPinchRef,
} from "react-zoom-pan-pinch";
import Papa from "papaparse";
import html2canvas from "html2canvas";
import ArenasSvg from "./components/arenas";
import "./App.css";

type Lote = {
  id: string;
  mz: string;
  lote: number;
  areaM2: number | null;
  price: number | null;
  condicion: string;
  asesor?: string;
  cliente?: string;
};

type CsvRow = {
  MZ?: string;
  LOTE?: string;
  AREA?: string;
  PRECIO?: string;
  CONDICION?: string;
  ASESOR?: string;
};

type LoteOverride = {
  price?: number | null;
  condicion?: string;
  cliente?: string;
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

const OVERRIDES_KEY = "arenas.lotes.overrides.v1";
const HISTORY_KEY = "arenas.lotes.history.v1";

const defaultQuote: QuoteState = {
  precio: 0,
  inicialMonto: 10000,
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

const cleanNumber = (value: string | undefined) => {
  if (!value) return null;
  const normalized = value.replace(/[^\d.,-]/g, "").replace(",", "");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
};

const toLoteId = (mz: string, lote: number) => `${mz}-${String(lote).padStart(2, "0")}`;

const loadOverrides = (): Record<string, LoteOverride> => {
  try {
    const raw = localStorage.getItem(OVERRIDES_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, LoteOverride>;
  } catch {
    return {};
  }
};

const saveOverrides = (overrides: Record<string, LoteOverride>) => {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
};

const appendHistory = (entry: string) => {
  const now = new Date().toISOString();
  const line = `${now} | ${entry}`;
  const raw = localStorage.getItem(HISTORY_KEY);
  const history = raw ? (JSON.parse(raw) as string[]) : [];
  history.unshift(line);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 200)));
};

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

const quoteMonthly = (monto: number, cuotas: number, interesAnual: number) => {
  if (cuotas <= 0) return 0;
  const i = interesAnual / 12 / 100;
  if (i <= 0) return monto / cuotas;
  const factor = (i * Math.pow(1 + i, cuotas)) / (Math.pow(1 + i, cuotas) - 1);
  return monto * factor;
};

const buildIdSet = (items: Lote[]) => new Set(items.map((item) => item.id));

const applyOverrides = (items: Lote[], overrides: Record<string, LoteOverride>) =>
  items.map((item) => ({
    ...item,
    ...overrides[item.id],
  }));

const overlayStyle = (transform: OverlayTransform) => ({
  transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
  transformOrigin: "top left",
});

function App() {
  const svgRef = useRef<SVGSVGElement>(null);
  const [rawLotes, setRawLotes] = useState<Lote[]>([]);
  const [overrides, setOverrides] = useState<Record<string, LoteOverride>>({});
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
  const [view, setView] = useState<"mapa" | "tabla">("mapa");
  const [overlay, setOverlay] = useState<OverlayTransform>(defaultOverlay);
  const [drawerTab, setDrawerTab] = useState<"cotizar" | "separar">("cotizar");
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
  const containerSizeRef = useRef({ width: 0, height: 0 });
  const hasFitRef = useRef(false);
  const lastHoveredRef = useRef<string | null>(null);
  const lastSelectedRef = useRef<string | null>(null);
  const highlightedRef = useRef<Set<string>>(new Set());
  const hoverPosRef = useRef({ x: 0, y: 0 });
  const hoverRafRef = useRef<number | null>(null);

  useEffect(() => {
    fetch("/assets/lotes.csv")
      .then((res) => res.text())
      .then((text) => {
        const parsed = Papa.parse<CsvRow>(text, {
          header: true,
          skipEmptyLines: true,
        });
        const rows = (parsed.data || []).flatMap((row: CsvRow): Lote[] => {
          const mz = (row.MZ || "").trim().toUpperCase();
          const lote = Number.parseInt((row.LOTE || "").trim(), 10);
          if (!mz || Number.isNaN(lote)) return [];
          const areaM2 = cleanNumber(row.AREA);
          const price = cleanNumber(row.PRECIO);
          const condicion = (row.CONDICION || "LIBRE").trim().toUpperCase();
          const asesor = (row.ASESOR || "").trim();
          return [
            {
              id: toLoteId(mz, lote),
              mz,
              lote,
              areaM2,
              price,
              condicion: condicion || "LIBRE",
              asesor: asesor || undefined,
            },
          ];
        });
        setRawLotes(rows);
      });
  }, []);

  useEffect(() => {
    const current = loadOverrides();
    setOverrides(current);

    const sync = () => setOverrides(loadOverrides());
    window.addEventListener("storage", sync);
    let channel: BroadcastChannel | null = null;
    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel("arenas-lotes-sync");
      channel.onmessage = sync;
    }
    return () => {
      window.removeEventListener("storage", sync);
      if (channel) channel.close();
    };
  }, []);

  const lotes = useMemo(() => applyOverrides(rawLotes, overrides), [rawLotes, overrides]);

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



  const handleSvgPointer = (event: React.MouseEvent<SVGSVGElement>) => {
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
  };

  const updateOverride = (id: string, patch: LoteOverride) => {
    setOverrides((current) => {
      const next = { ...current, [id]: { ...current[id], ...patch } };
      saveOverrides(next);
      appendHistory(`${id} => ${JSON.stringify(patch)}`);
      if ("BroadcastChannel" in window) {
        const channel = new BroadcastChannel("arenas-lotes-sync");
        channel.postMessage("sync");
        channel.close();
      }
      return next;
    });
  };

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

  const drawerCount = rightOpen ? 1 : 0;
  const MapView = (
    <section className="map-page">
      <section className="map-intro">
        <div className="map-intro__panel-title">Arenas Club – Caracteristicas</div>
        <div className="map-intro__grid">
          <article>
            <h4>🛫 Al filo de la pista</h4>
            <p>Ubicacion privilegiada con acceso directo.</p>
          </article>
          <article>
            <h4>💧⚡ Servicios instalados</h4>
            <p>Red de agua en cada lote y luz con transformador de Hidrandina.</p>
          </article>
          <article>
            <h4>📄 Titulo propio</h4>
            <p>Con su partida registral en SUNARP.</p>
          </article>
          <article>
            <h4>🏝️ Cadena de clubes</h4>
            <p>Acceso exclusivo a nivel nacional para todos nuestros clientes.</p>
          </article>
        </div>
      </section>

      <section className={`map-shell drawer-open-${drawerCount}`}>
        <section className="map-card viewer">
          <div className="map-header">
            <div className="map-header__info">
              <strong>{lotes.length}</strong> lotes cargados -{" "}
              <strong>{filteredLotes.length}</strong> visibles
          </div>
          <div className="legend">
            <span className="legend__item libre">Libre</span>
            <span className="legend__item separado">Separado</span>
            <span className="legend__item vendido">Vendido</span>
          </div>
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
          <div className="export-actions">
            <button className="btn ghost" onClick={exportPrintable}>
              PDF / Imprimir
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
                setMapTransform(state);
                mapTransformRef.current = state;
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
                  x: mapTransform.positionX,
                  y: mapTransform.positionY,
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
                        src="/assets/plano-fondo-demo.png"
                        alt="Plano de fondo"
                        className="map-background"
                        draggable={false}
                      />
                      <ArenasSvg
                        svgRef={svgRef}
                        className="lotes-svg"
                        style={overlayStyle(overlay)}
                        onMouseMove={handleSvgPointer}
                        onClick={handleSvgPointer}
                        onMouseLeave={() => setHoveredId(null)}
                      />
                    </div>
                  </TransformComponent>
                </>
              )}
            </TransformWrapper>
          ) : (
            <div className="table-view">
              <div className="table-filters">
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
                      {lote.condicion === "LIBRE" ? "DISPONIBLE" : lote.condicion}
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
          <h3>Cotizador</h3>
          <div className="drawer__header-actions">
            <a
              className="btn ghost instagram"
              href="https://www.instagram.com/arenasmalabrigo/"
              target="_blank"
              rel="noreferrer"
            >
              Instagram
            </a>
            <button className="btn ghost" onClick={() => setRightOpen(false)}>
              Cerrar
            </button>
          </div>
        </div>
        <div className="drawer__body">
          {selectedLote ? (
            <>
              <div className="drawer-chips">
                <span className="chip">MZ {selectedLote.mz}</span>
                <span className="chip">Lote {selectedLote.lote}</span>
                <span className={`chip status-pill ${statusToClass(selectedLote.condicion)}`}>
                  {selectedLote.condicion === "LIBRE" ? "DISPONIBLE" : selectedLote.condicion}
                </span>
              </div>

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
                          value={quote.inicialMonto}
                          onChange={(event) =>
                            setQuote({ ...quote, inicialMonto: Number(event.target.value || 0) })
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
                            setQuote({ ...quote, cuotas: Number(event.target.value || 0) })
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
              ) : (
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
                <span className="brand__desc">
                  Solo informativo: mira <strong>precio</strong>, <strong>condición</strong> y{" "}
                  <strong>asesor</strong>. Busca por <strong>Manzana</strong> o{" "}
                  <strong>Manzana + Lote</strong> o mira el <strong>Resumen general</strong>.
                </span>
              </div>
            </div>
          </div>
          <div className="topbar__actions">
            <nav className="nav-links">
              <NavLink to="/" end className="nav-link">
                Viewer
              </NavLink>
              <NavLink to="/vendedor" className="nav-link">
                Vendedor
              </NavLink>
              <NavLink to="/editor" className="nav-link">
                Editor
              </NavLink>
            </nav>
            <button className="btn ghost" onClick={() => setRightOpen(true)}>
              Cotizador
            </button>
          </div>
        </header>

        <main className="main">
          <Routes>
            <Route path="/" element={MapView} />
            <Route
              path="/vendedor"
              element={
                <section className="seller-panel">
                  <h3>Panel vendedor</h3>
                  <p className="muted">
                    Cambia estado, precio y cliente. Se sincroniza en otras pestanas (simulado).
                  </p>
                  <div className="seller-table">
                    <div className="seller-row header">
                      <span>MZ</span>
                      <span>LT</span>
                      <span>AREA (M2)</span>
                      <span>ASESOR</span>
                      <span>PRECIO</span>
                      <span>ESTADO</span>
                      <span>CLIENTE(S)</span>
                    </div>
                    {lotes.map((lote) => (
                      <div className="seller-row" key={lote.id}>
                        <span>{lote.mz}</span>
                        <span>{lote.lote}</span>
                        <span>{formatArea(lote.areaM2)}</span>
                        <span>{lote.asesor ?? "—"}</span>
                        <div className="price-input">
                          <span>S/</span>
                          <input
                            type="number"
                            value={lote.price ?? ""}
                            onChange={(event) =>
                              updateOverride(lote.id, {
                                price: event.target.value ? Number(event.target.value) : null,
                              })
                            }
                          />
                        </div>
                        <select
                          className={`seller-status ${statusToClass(lote.condicion)}`}
                          value={lote.condicion}
                          onChange={(event) =>
                            updateOverride(lote.id, { condicion: event.target.value })
                          }
                        >
                          <option value="LIBRE">LIBRE</option>
                          <option value="SEPARADO">SEPARADO</option>
                          <option value="VENDIDO">VENDIDO</option>
                        </select>
                        <input
                          type="text"
                          value={lote.cliente ?? ""}
                          onChange={(event) =>
                            updateOverride(lote.id, { cliente: event.target.value })
                          }
                        />
                      </div>
                    ))}
                  </div>
                </section>
              }
            />
            <Route
              path="/editor"
              element={
                <section className="editor-panel">
                  <div className="editor-header">
                    <h3>Editor de overlay</h3>
                    <p className="muted">Ajusta posicion y escala del SVG sobre el PNG fijo.</p>
                  </div>
                  <div className="editor-grid">
                    <div className="editor-controls">
                      <label>
                        X ({overlay.x}px)
                        <div className="editor-inputs">
                          <input
                            type="number"
                            value={overlay.x}
                            onChange={(event) =>
                              setOverlay({ ...overlay, x: Number(event.target.value || 0) })
                            }
                          />
                          <input
                            type="range"
                            min={-400}
                            max={400}
                            value={overlay.x}
                            onChange={(event) =>
                              setOverlay({ ...overlay, x: Number(event.target.value) })
                            }
                          />
                        </div>
                      </label>
                      <label>
                        Y ({overlay.y}px)
                        <div className="editor-inputs">
                          <input
                            type="number"
                            value={overlay.y}
                            onChange={(event) =>
                              setOverlay({ ...overlay, y: Number(event.target.value || 0) })
                            }
                          />
                          <input
                            type="range"
                            min={-400}
                            max={400}
                            value={overlay.y}
                            onChange={(event) =>
                              setOverlay({ ...overlay, y: Number(event.target.value) })
                            }
                          />
                        </div>
                      </label>
                      <label>
                        Escala ({overlay.scale.toFixed(2)})
                        <div className="editor-inputs">
                          <input
                            type="number"
                            step={0.01}
                            value={overlay.scale}
                            onChange={(event) =>
                              setOverlay({ ...overlay, scale: Number(event.target.value || 1) })
                            }
                          />
                          <input
                            type="range"
                            min={0.5}
                            max={2}
                            step={0.01}
                            value={overlay.scale}
                            onChange={(event) =>
                              setOverlay({ ...overlay, scale: Number(event.target.value) })
                            }
                          />
                        </div>
                      </label>
                      <div className="editor-actions">
                        <button className="btn" onClick={() => setOverlay(defaultOverlay)}>
                          Reset
                        </button>
                      </div>
                      <div className="editor-output">
                        <span>Transform actual</span>
                        <code>
                          x: {overlay.x}, y: {overlay.y}, scale: {overlay.scale.toFixed(2)}
                        </code>
                      </div>
                    </div>
                    <div className="editor-canvas" style={mapVars}>
                      <div className="map-layer">
                        <img
                          src="/assets/plano-fondo-demo.png"
                          alt="Plano de fondo"
                          className="map-background"
                          draggable={false}
                        />
                        <ArenasSvg
                          svgRef={svgRef}
                          className="lotes-svg"
                          style={overlayStyle(overlay)}
                          onMouseMove={handleSvgPointer}
                          onClick={handleSvgPointer}
                          onMouseLeave={() => setHoveredId(null)}
                        />
                      </div>
                    </div>
                  </div>
                </section>
              }
            />
          </Routes>
        </main>

        

        
      </div>
    </BrowserRouter>
  );
}

export default App;

