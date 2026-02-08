# Mapa interactivo � Arenas Malabrigo

MVP en React + Vite para un mapa de lotes con SVG sobre PNG. Incluye:
- Vista **mapa** con zoom, pan, hover y seleccion de lotes.
- Vista **tabla** con filtros y exportacion.
- Panel **vendedor** para actualizar estado, precio y cliente.
- Cotizador con impresion y exportacion CSV.

## Requisitos
- Node.js 18+ recomendado

## Instalacion
```bash
npm install
```

## Desarrollo
```bash
npm run dev
```

## Build
```bash
npm run build
```

## Datos
Por defecto se carga desde:
```
public/assets/lotes.csv
```
Columnas esperadas: `MZ`, `LOTE`, `AREA`, `PRECIO`, `CONDICION`, `ASESOR`.

## Exportaciones
- **PDF/Imprimir**: genera una vista A4 con cotizacion y mapa visible.
- **CSV**: exporta la tabla filtrada para Excel.

## Notas de despliegue
El SVG principal esta en:
```
src/components/arenas.tsx
```

Si vas a conectar Google Sheets, reemplaza el `fetch` del CSV por la URL publica o la API. 