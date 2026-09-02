/**
 * goodwe-flow-card-m0e
 *
 * A custom Home Assistant Lovelace card for GoodWe hybrid inverters.
 * Animated energy flow (solar / battery / home / grid), battery SOC ring,
 * PV string bars, daily stats and quick-toggle switches (e.g. Fast Charge).
 *
 * No build step, no dependencies. Serve this single file as a Lovelace
 * resource (type: module) and use `type: custom:goodwe-flow-card-m0e`.
 *
 * Config is documented in README.md. Legacy b2500d-card entity keys
 * (solar_power, p1_power, output_power, battery_percentage,
 * production_today, battery_capacity, custom_settings) are accepted so an
 * existing b2500d config can be dropped in with only the `type` changed.
 */

const CARD_VERSION = "1.17.0";
const FLOW_THRESHOLD_W = 25; // flows below this are treated as zero

/* ---------------------------------------------------------------- helpers */

const num = (v) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

// normalize alert_states / ok_states config: single value or list → lowercase list
const listify = (v) =>
  v == null ? null : (Array.isArray(v) ? v : [v]).map((s) => String(s).trim().toLowerCase());

// should this tile/row flash for the given state?
const isAlert = (item, state) => {
  if (state == null) return false;
  const s = String(state).trim().toLowerCase();
  if (item._alert) return item._alert.includes(s);
  if (item._ok) return !item._ok.includes(s);
  return false;
};

const fmtPower = (w) => {
  if (w === null) return "—";
  const abs = Math.abs(w);
  if (abs >= 10000) return `${(w / 1000).toFixed(1)} kW`;
  if (abs >= 1000) return `${(w / 1000).toFixed(2)} kW`;
  return `${Math.round(w)} W`;
};

const fmtEnergy = (v, unit) => {
  if (v === null) return "—";
  if (unit && unit.toLowerCase() === "wh") return `${(v / 1000).toFixed(2)} kWh`;
  return `${v.toFixed(v >= 100 ? 0 : 2)} kWh`;
};

// value + small-unit markup for the big readouts ("581" + "W")
const powerHtml = (w) => {
  if (w === null) return "—";
  const abs = Math.abs(w);
  if (abs >= 1000) return `${(w / 1000).toFixed(abs >= 10000 ? 1 : 2)}<span class="u">kW</span>`;
  return `${Math.round(w)}<span class="u">W</span>`;
};

const energyHtml = (v, unit) => {
  const s = fmtEnergy(v, unit);
  const m = s.match(/^([\d.]+) (\w+)$/);
  return m ? `${m[1]}<span class="u">${m[2]}</span>` : s;
};

// money-ish units: "$/kWh" → "$0.32/kWh", "¢/kWh" → "22¢/kWh",
// plain "$"/"AUD" (cost sensors) → "$4.31", "$/h" → "$0.24/h"
const fmtPrice = (v, unit) => {
  if (v === null) return "";
  const denom = unit.includes("/") ? unit.slice(unit.indexOf("/")) : "";
  if (unit.includes("$") || /^[A-Z]{3}(\/|$)/.test(unit))
    return `${v < 0 ? "-" : ""}$${Math.abs(v).toFixed(2)}${denom}`;
  if (/¢|c\//i.test(unit)) return `${Math.round(v)}¢${denom || "/kWh"}`;
  return `${v} ${unit}`;
};

// seconds → "45s" / "12m" / "5h 03m" / "2d 4h", for info rows with format: duration
const fmtDuration = (secs) => {
  if (secs === null || !isFinite(secs) || secs <= 0) return "—";
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.round(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, "0")}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
};

// battery ETA: hours from now → "~2:40 pm", rounded to 5 min so power
// jitter doesn't make it flicker; hidden beyond 24 h (power too low to trust)
const fmtEta = (hours) => {
  if (!isFinite(hours) || hours <= 0 || hours > 24) return "";
  const t = new Date(Math.round((Date.now() + hours * 3600000) / 300000) * 300000);
  return t.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

// quantize animation duration so we don't restart the dot every update
const flowDur = (watts) => {
  const d = Math.max(1.2, Math.min(8, 2500 / Math.max(watts, 1)));
  return Math.round(d * 2) / 2;
};

/* ------------------------------------------------------------------ icons */
// Simple hand-drawn stroke icons — no icon font needed.

const ICONS = {
  sun: `<circle cx="12" cy="12" r="4"/>
    <g stroke-linecap="round">
      <line x1="12" y1="2.5" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="21.5"/>
      <line x1="2.5" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="21.5" y2="12"/>
      <line x1="5.3" y1="5.3" x2="7" y2="7"/><line x1="17" y1="17" x2="18.7" y2="18.7"/>
      <line x1="18.7" y1="5.3" x2="17" y2="7"/><line x1="7" y1="17" x2="5.3" y2="18.7"/>
    </g>`,
  home: `<path d="M4 11.5 L12 4.5 L20 11.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M6.5 10.5 V19.5 H17.5 V10.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M10.5 19.5 V14.5 H13.5 V19.5" fill="none" stroke-linejoin="round"/>`,
  battery: `<rect x="7.5" y="6" width="9" height="14" rx="1.5" fill="none"/>
    <line x1="10" y1="3.5" x2="14" y2="3.5" stroke-linecap="round"/>
    <path class="gw-bolt" d="M12.9 9.5 L10.3 13.4 H11.9 L11.1 16.5 L13.7 12.6 H12.1 Z" stroke="none"/>`,
  grid: `<path d="M9 21 L11.2 4 H12.8 L15 21" fill="none" stroke-linejoin="round"/>
    <line x1="7.5" y1="8.5" x2="16.5" y2="8.5"/><line x1="6.5" y1="14" x2="17.5" y2="14"/>
    <path d="M8.2 8.5 L15 14 M15.8 8.5 L9 14" fill="none"/>
    <line x1="6.5" y1="21" x2="17.5" y2="21" stroke-linecap="round"/>`,
  chart: `<line x1="5" y1="20" x2="19" y2="20" stroke-linecap="round"/>
    <rect x="6.5" y="12" width="3" height="6" rx="0.8" stroke="none" fill="currentColor"/>
    <rect x="10.7" y="7" width="3" height="11" rx="0.8" stroke="none" fill="currentColor"/>
    <rect x="14.9" y="10" width="3" height="8" rx="0.8" stroke="none" fill="currentColor"/>`,
  bolt: `<path d="M13.5 3 L6.5 13.5 H11 L9.5 21 L17.5 10 H12.5 Z" stroke-linejoin="round" fill="none"/>`,
  clock: `<circle cx="12" cy="12" r="8.5" fill="none"/>
    <path d="M12 7.5 V12 L15.2 14" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  bell: `<path d="M6.2 17 H17.8 L16.7 15.4 C16.2 14.7 16 13.9 16 13 V10.5 C16 8 14.2 6 12 6 C9.8 6 8 8 8 10.5 V13 C8 13.9 7.8 14.7 7.3 15.4 Z" fill="none" stroke-linejoin="round"/>
    <path d="M10.4 19.3 a1.7 1.7 0 0 0 3.2 0" fill="none" stroke-linecap="round"/>
    <line x1="12" y1="4" x2="12" y2="6" stroke-linecap="round"/>`,
  thermo: `<path d="M10.4 5.2 a1.6 1.6 0 0 1 3.2 0 V13.1 a3.6 3.6 0 1 1 -3.2 0 Z" fill="none" stroke-linejoin="round"/>
    <circle cx="12" cy="16.3" r="1.5" fill="currentColor" stroke="none"/>
    <line x1="12" y1="13.5" x2="12" y2="15" stroke-linecap="round"/>`,
};

const icon = (name, cls = "", style = "") =>
  `<svg class="gw-ic ${cls}"${style ? ` style="${style}"` : ""} viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" fill="none">${ICONS[name] || ICONS.bolt}</svg>`;

/* ------------------------------------------------------------------- card */

class GoodweFlowCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._built = false;
    this._refs = {};
    this._durCache = {};
  }

  /* -------- config -------- */

  setConfig(config) {
    if (!config || (!config.entities && !config.strings && !config.bars)) {
      throw new Error("goodwe-flow-card-m0e: define an `entities:` block");
    }
    const e = config.entities || {};

    // bars: generic labelled power bars ({entity, name, max, color}).
    // `bars:` is the new name, `strings:` is an alias, legacy p1..p4 keys still work.
    let strings = [];
    const barList = config.bars || config.strings;
    if (Array.isArray(barList)) {
      strings = barList.map((s, i) =>
        typeof s === "string"
          ? { entity: s, name: `PV${i + 1}`, max: config.max_string_power || 4000 }
          : { name: `PV${i + 1}`, max: config.max_string_power || 4000, ...s }
      );
    } else {
      [["p1_power", "max_input_power"], ["p2_power", "max_input_power2"],
       ["p3_power", "max_input_power3"], ["p4_power", "max_input_power4"]]
        .forEach(([key, maxKey], i) => {
          if (e[key]) strings.push({ entity: e[key], name: `PV${i + 1}`, max: config[maxKey] || 4000 });
        });
    }

    this._config = {
      name: config.name || "GoodWe",
      pv_power: e.pv_power || e.solar_power,
      house_power: e.house_power || e.output_power,
      grid_power: e.grid_power,
      battery_power: e.battery_power,
      battery_soc: e.battery_soc || e.battery_percentage,
      production_today: e.production_today,
      battery_today: e.battery_today || e.battery_capacity,
      grid_import_today: e.grid_import_today,
      grid_export_today: e.grid_export_today,
      grid_price: e.grid_price,
      last_update: e.last_update,
      labels: {
        solar: "Solar",
        home: "Home",
        battery: "Battery",
        grid: "Grid",
        grid_import: "import",
        grid_export: "export",
        charging: "Charging",
        full: "Full",
        empty: "Empty",
        updated: "updated",
        today: "Today",
        production: "Production",
        battery_today: "Battery",
        grid_in: "Grid in",
        grid_out: "Grid out",
        ...(config.labels || {}),
      },
      strings,
      battery_capacity_kwh: num(config.battery_capacity_kwh),
      pv_max: num(config.pv_max),
      house_max: num(config.house_max),
      battery_min_soc: num(config.battery_min_soc) ?? 0,
      invert_battery: !!config.invert_battery,
      invert_grid: !!config.invert_grid,
      switches: config.switches || config.custom_settings || [],
      tiles: (Array.isArray(config.tiles) ? config.tiles : []).map((t) => ({
        ...t, _alert: listify(t.alert_states), _ok: listify(t.ok_states),
      })),
      info: (Array.isArray(config.info) ? config.info : []).map((t) => ({
        ...t, _alert: listify(t.alert_states), _ok: listify(t.ok_states),
      })),
      buttons: (Array.isArray(config.buttons) ? config.buttons : []).map((g) => ({
        ...g,
        columns: Math.min(6, Math.max(1, num(g.columns) ?? 3)),
        options: (g.options || []).map((o) => (typeof o === "object" ? o : { value: o })),
      })),
      tile_columns: Math.min(4, Math.max(1, num(config.tile_columns) ?? 2)),
      info_columns: Math.min(4, Math.max(1, num(config.info_columns) ?? 1)),
      show_strings: config.show_bars !== false && config.show_strings !== false,
      show_stats: config.show_stats !== false,
      show_separator: config.show_separator !== false,
      layout: ["tall", "wide", "auto"].includes(config.layout) ? config.layout : "auto",
      low_fx: !!config.low_fx,
      info_title: config.info_title || "",
    };
    this._built = false;

    // every entity this card renders — used to skip updates when a hass
    // change didn't touch any of them (HA re-sets hass for EVERY state
    // change in the instance, which starves animations on slow tablets)
    const cc = this._config;
    this._watched = [
      cc.pv_power, cc.house_power, cc.battery_power, cc.battery_soc,
      cc.grid_power, cc.grid_price, cc.production_today, cc.battery_today,
      cc.grid_import_today, cc.grid_export_today, cc.last_update,
      ...cc.strings.map((s) => s.entity),
      ...cc.tiles.map((t) => t.entity),
      ...cc.tiles.map((t) => t.entity2),
      ...cc.info.map((t) => t.entity),
      ...cc.switches.map((s) => s.entity),
      ...cc.buttons.map((g) => g.entity),
    ].filter(Boolean);
  }

  static getStubConfig(_hass, entities) {
    const pick = (suffix) => entities.find((id) => id.endsWith(suffix)) || "";
    return {
      name: "GoodWe",
      entities: {
        pv_power: pick("pv_power"),
        house_power: pick("house_consumption"),
        battery_power: pick("battery_power"),
        battery_soc: pick("battery_state_of_charge"),
        production_today: pick("today_s_pv_generation"),
      },
    };
  }

  getCardSize() { return 6; }

  /* -------- hass updates -------- */

  set hass(hass) {
    const old = this._hass;
    this._hass = hass;
    if (!this._config) return;
    if (!this._built) {
      this._build();
      this._update();
      return;
    }
    // state objects are immutable in HA — a changed entity gets a new object
    if (old && this._watched.every((id) => old.states[id] === hass.states[id])) return;
    this._update();
  }

  _state(id) {
    if (!id || !this._hass) return null;
    const st = this._hass.states[id];
    if (!st || st.state === "unavailable" || st.state === "unknown") return null;
    return st;
  }

  _num(id) {
    const st = this._state(id);
    return st ? num(st.state) : null;
  }

  _energy(id) {
    const st = this._state(id);
    if (!st) return "—";
    return energyHtml(num(st.state), st.attributes.unit_of_measurement);
  }

  // format any sensor state by its unit: %, W/kW, Wh/kWh, price, or raw
  _fmtState(id) {
    const st = this._state(id);
    if (!st) return "—";
    const v = num(st.state);
    const unit = (st.attributes.unit_of_measurement || "").trim();
    if (v === null) return st.state;
    if (unit === "%") return `${Math.round(v)}<span class="u">%</span>`;
    if (unit === "W" || unit === "kW") return powerHtml(unit === "kW" ? v * 1000 : v);
    if (unit.includes("$") || unit.includes("¢") || /^[A-Z]{3}(\/|$)/.test(unit)) {
      const p = fmtPrice(v, unit);
      const ix = p.indexOf("/");
      return ix > 0 ? `${p.slice(0, ix)}<span class="u">${p.slice(ix)}</span>` : p;
    }
    if (/wh$/i.test(unit)) return energyHtml(v, unit);
    return `${st.state}${unit ? `<span class="u">${unit}</span>` : ""}`;
  }

  _moreInfo(entityId) {
    if (!entityId) return;
    const ev = new CustomEvent("hass-more-info", {
      detail: { entityId }, bubbles: true, composed: true,
    });
    this.dispatchEvent(ev);
  }

  /* -------- build DOM (once) -------- */

  _build() {
    const c = this._config;
    const stringsHtml = c.show_strings && c.strings.length
      ? `<div class="strings">${c.strings.map((s, i) => `
          <div class="string" data-entity="${s.entity}">
            <span class="s-name">${s.name}</span>
            <div class="s-bar"><div class="s-fill" id="sfill${i}"${s.color ? ` style="background:${s.color}"` : ""}></div></div>
            <span class="s-val" id="sval${i}">—</span>
          </div>`).join("")}</div>`
      : "";

    const tile = (entity, title, label, valId, ic, icCls) => `
        <div class="stat" data-entity="${entity}">
          <div class="stat-tr"><span class="stat-title">${title}</span>${icon(ic, icCls)}</div>
          <span class="stat-label">${label}</span>
          <span class="stat-val" id="${valId}">—</span>
        </div>`;
    const L = c.labels;
    const statsHtml = c.show_stats ? `
      <div class="stats" style="grid-template-columns: repeat(${c.tile_columns}, minmax(0, 1fr))">
        ${c.production_today ? tile(c.production_today, L.production, L.today, "prodToday", "chart", "solar") : ""}
        ${c.battery_today ? tile(c.battery_today, L.battery_today, L.today, "battToday", "battery", "batt") : ""}
        ${c.grid_import_today ? tile(c.grid_import_today, L.grid_in, L.today, "gridInToday", "grid", "grid") : ""}
        ${c.grid_export_today ? tile(c.grid_export_today, L.grid_out, L.today, "gridOutToday", "grid", "grid") : ""}
        ${c.tiles.map((t, i) => t.entity2 ? `
        <div class="stat two" data-entity="${t.entity}">
          <div class="stat-tr">
            <span class="stat-title">${t.name || t.entity}</span>
            ${icon(t.icon || "bolt", "", t.color ? `color:${t.color}` : "")}
          </div>
          <div class="stat-lbls">
            <span class="stat-label">${t.sub ?? "Now"}</span>
            <span class="stat-label">${t.name2 ?? ""}</span>
          </div>
          <div class="stat-vals">
            <span class="stat-val" id="ctile${i}">—</span>
            <span class="stat-val v2" id="ctile2${i}">—</span>
          </div>
        </div>` : `
        <div class="stat" data-entity="${t.entity}">
          <div class="stat-tr">
            <span class="stat-title">${t.name || t.entity}</span>
            ${icon(t.icon || "bolt", "", t.color ? `color:${t.color}` : "")}
          </div>
          <span class="stat-label">${t.sub ?? "Now"}</span>
          <span class="stat-val" id="ctile${i}">—</span>
        </div>`).join("")}
      </div>` : "";

    // in a multi-column info grid, the cells on the last visual row drop
    // their bottom border (:last-child alone only covers one column)
    const lastRow = c.info.length % c.info_columns || c.info_columns;
    const infoHtml = c.info.length ? `
      ${c.info_title ? `<div class="info-title">${c.info_title}</div>` : ""}
      <div class="info" style="${c.info_columns > 1
        ? `display:grid;grid-template-columns:repeat(${c.info_columns},minmax(0,1fr));column-gap:28px;`
        : ""}">${c.info.map((t, i) => `
        <div class="irow${i >= c.info.length - lastRow ? " no-b" : ""}" data-entity="${t.entity}">
          <span class="i-name">${t.icon ? icon(t.icon, "", t.color ? `color:${t.color}` : "") : ""}${t.name || t.entity}</span>
          <span class="i-val" id="info${i}"${t.color ? ` style="color:${t.color}"` : ""}>—</span>
        </div>`).join("")}</div>` : "";

    const buttonsHtml = c.buttons.map((g, gi) => `
      <div class="btns">
        ${g.name ? `<div class="btns-title">${g.name}<span class="btns-cur" id="bcur${gi}"></span></div>` : ""}
        <div class="btn-grid" style="grid-template-columns: repeat(${g.columns}, minmax(0, 1fr))">
          ${g.options.map((o, oi) => `
          <div class="pbtn" id="pbtn${gi}_${oi}" data-g="${gi}" data-o="${oi}">
            ${icon(g.icon || "bolt")}
            <span class="pbtn-l" id="pbl${gi}_${oi}">${o.label ?? o.value}</span>
          </div>`).join("")}
        </div>
      </div>`).join("");

    const switchesHtml = c.switches.length ? `
      <div class="switches">${c.switches.map((s, i) => `
        <div class="switch" id="sw${i}" data-entity="${s.entity}">
          <span class="sw-icon">${icon("bolt")}</span>
          <span class="sw-name">${s.name || s.entity}</span>
          <span class="sw-toggle"><span class="sw-knob"></span></span>
        </div>`).join("")}</div>` : "";

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          --gw-solar: var(--gw-solar-color, #ffb648);
          --gw-batt: var(--gw-batt-color, #35d49a);
          --gw-batt-low: #ff6b6b;
          --gw-batt-mid: #ffb648;
          --gw-grid: var(--gw-grid-color, #5aa9e6);
          --gw-house: var(--gw-house-color, #9b8cff);
          --gw-bg: var(--ha-card-background, var(--card-background-color, #14161c));
          --gw-tile: rgba(255, 255, 255, 0.045);
          --gw-line: rgba(255, 255, 255, 0.09);
          --gw-text: var(--primary-text-color, #e8eaf0);
          --gw-dim: var(--secondary-text-color, #8b919e);
          display: block;
        }
        .card {
          background: var(--gw-bg);
          border-radius: var(--ha-card-border-radius, 16px);
          box-shadow: var(--ha-card-box-shadow, none);
          border: 1px solid rgba(255, 255, 255, 0.05);
          color: var(--gw-text);
          font-family: inherit;
          padding: 18px 18px 14px;
          overflow: hidden;
        }
        .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px; }
        .title { font-size: 1.15rem; font-weight: 800; letter-spacing: 0.05em; }
        .updated { font-size: 0.72rem; color: var(--gw-dim); }

        /* ---- wide layout: flow left, tiles right (layout: wide, or auto on
                a wide card such as a landscape tablet panel) ---- */
        .layout-wide .body {
          display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          column-gap: 26px; align-items: center;
        }
        .layout-wide .side {
          border-left: 1px solid var(--gw-line); padding-left: 26px;
          align-self: stretch; display: flex; flex-direction: column;
          justify-content: center; min-width: 0;
        }
        .layout-wide .side .divider { display: none; }
        .layout-wide .flow { margin-top: 0; }
        /* layout: auto gets .layout-wide toggled by a ResizeObserver in JS —
           container queries are missing on older tablet/kiosk WebViews */

        /* low_fx: drop glows, pulses and transitions — box-shadow blur on
           circles is the most expensive paint on weak tablet GPUs */
        .fx-off .bubble { box-shadow: none !important; transition: none; }
        .fx-off .node .gw-ic { transition: none; }
        .fx-off .node.batt.charging .gw-bolt { animation: none; }
        .fx-off .lines path { transition: none; }
        .fx-off .s-fill, .fx-off .soc-ring .arc { transition: none; }
        .fx-off .sw-toggle, .fx-off .sw-knob, .fx-off .switch { transition: none; }

        /* value + unit pairs: big number, small dim unit */
        .u { font-size: 0.62em; font-weight: 600; color: var(--gw-dim); margin-left: 2px; }

        /* ---- flow area ---- */
        .flow { position: relative; width: 100%; aspect-ratio: 420 / 300; container-type: inline-size; margin-top: 16px; }
        .flow svg.lines { position: absolute; inset: 0; width: 100%; height: 100%; }
        .lines path { fill: none; stroke: var(--gw-line); stroke-width: 1.6; transition: stroke 0.4s; }
        .lines path.on-solar { stroke: color-mix(in srgb, var(--gw-solar) 45%, transparent); }
        .lines path.on-batt { stroke: color-mix(in srgb, var(--gw-batt) 45%, transparent); }
        .lines path.on-grid { stroke: color-mix(in srgb, var(--gw-grid) 45%, transparent); }
        /* flow dots: HTML divs on GPU-composited transform keyframes
           (generated per card size) — SMIL ran on the main thread and
           stuttered on slow tablets */
        .dotv {
          position: absolute; left: -4.5px; top: -4.5px; width: 9px; height: 9px;
          border-radius: 50%; visibility: hidden; pointer-events: none; z-index: 1;
          will-change: transform;
          animation: 4s linear infinite; animation-play-state: paused;
        }
        .dotv.live { visibility: visible; animation-play-state: running; }
        .dotv.d-solar { background: var(--gw-solar); }
        .dotv.d-batt { background: var(--gw-batt); }
        .dotv.d-grid { background: var(--gw-grid); }

        /* the node box is exactly the bubble, so translate(-50%,-50%) puts the
           circle centre precisely on the path endpoints; labels hang outside */
        .node {
          position: absolute; transform: translate(-50%, -50%);
          cursor: pointer; z-index: 2;
        }
        .node .node-label {
          position: absolute; top: calc(100% + 5px); left: 50%;
          transform: translateX(-50%);
        }
        .node.solar .node-label { top: auto; bottom: calc(100% + 5px); }
        .node-eta {
          position: absolute; top: calc(100% + 23px); left: 50%;
          transform: translateX(-50%); white-space: nowrap;
          font-size: 11px; font-size: clamp(10px, 3.2cqw, 12px);
          color: var(--gw-dim);
        }
        .bubble {
          width: 80px; height: 80px;
          width: clamp(72px, 22cqw, 96px); height: clamp(72px, 22cqw, 96px);
          border-radius: 50%;
          background: var(--gw-bg);
          border: 2px solid var(--gw-line);
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          gap: 1px; transition: border-color 0.4s, box-shadow 0.4s;
        }
        .node .gw-ic {
          width: 20px; height: 20px;
          width: clamp(18px, 5.6cqw, 24px); height: clamp(18px, 5.6cqw, 24px);
          color: var(--gw-dim); transition: color 0.4s;
        }
        .node-val {
          font-size: 14px; font-size: clamp(13px, 4.4cqw, 17px);
          font-weight: 800; letter-spacing: 0.01em; font-variant-numeric: tabular-nums;
        }
        .node-sub { font-size: 10px; font-size: clamp(10px, 3cqw, 12px); color: var(--gw-dim); }
        .node-label {
          font-size: 12px; font-size: clamp(11px, 3.4cqw, 13px);
          color: var(--gw-dim); letter-spacing: 0.04em; white-space: nowrap;
        }

        .node.active-solar .bubble { border-color: var(--gw-solar); box-shadow: 0 0 14px -4px var(--gw-solar); }
        .node.active-solar .gw-ic { color: var(--gw-solar); }
        .node.active-batt .bubble { border-color: currentColor; }
        .node.active-grid .bubble { border-color: var(--gw-grid); box-shadow: 0 0 14px -4px var(--gw-grid); }
        .node.active-grid .gw-ic { color: var(--gw-grid); }
        .node.active-house .bubble { border-color: var(--gw-house); box-shadow: 0 0 14px -4px var(--gw-house); }
        .node.active-house .gw-ic { color: var(--gw-house); }

        /* battery bubble gets its own SOC ring */
        .node.batt .bubble { position: relative; border-color: transparent; }
        .soc-ring { position: absolute; inset: -2px; width: calc(100% + 4px); height: calc(100% + 4px); transform: rotate(-90deg); }
        .soc-ring .track { fill: none; stroke: var(--gw-line); stroke-width: 3; }
        .soc-ring .arc {
          fill: none; stroke: var(--gw-batt); stroke-width: 3; stroke-linecap: round;
          transition: stroke-dashoffset 0.8s, stroke 0.8s;
        }
        /* power rings on solar/home (pv_max / house_max): the ring becomes
           the outline, tinted per node; the glow shadow still applies */
        .node.ringed .bubble { border-color: transparent !important; }
        .node.solar .soc-ring .arc { stroke: var(--gw-solar); }
        .node.house .soc-ring .arc { stroke: var(--gw-house); }
        .node.batt .gw-bolt { fill: none; }
        .node.batt.charging .gw-bolt { fill: currentColor; animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: 0.35; } }

        /* ---- PV strings ---- */
        .divider { height: 1px; background: var(--gw-line); margin: 44px 2px 0; }
        .strings { display: flex; flex-direction: column; gap: 7px; margin: 12px 2px 0; }
        .string { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .s-name { font-size: 0.74rem; font-weight: 600; color: var(--gw-dim); width: 32px; }
        .s-bar { flex: 1; height: 5px; border-radius: 3px; background: var(--gw-line); overflow: hidden; }
        .s-fill { height: 100%; width: 0%; border-radius: 3px; background: var(--gw-solar); transition: width 0.8s; }
        .s-val { font-size: 0.8rem; font-weight: 700; width: 66px; text-align: right; font-variant-numeric: tabular-nums; }

        /* ---- stat tiles (SYMBOX style: bold title, dim sub, big value) ---- */
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 16px; }
        .stat {
          position: relative; display: flex; flex-direction: column; gap: 2px;
          background: var(--gw-tile); border-radius: 14px; padding: 13px 14px 12px; cursor: pointer;
          min-width: 0; border: 1px solid rgba(255, 255, 255, 0.035);
          transition: transform 0.12s;
        }
        .stat:active, .switch:active, .pbtn:active { transform: scale(0.975); }
        .stat, .switch, .pbtn, .irow { -webkit-tap-highlight-color: transparent; }
        .stat .stat-tr { display: flex; align-items: center; gap: 7px; }
        .stat .gw-ic { width: 18px; height: 18px; color: var(--gw-dim); opacity: 0.9; }
        .gw-ic.solar { color: var(--gw-solar); }
        .gw-ic.batt { color: var(--gw-batt); }
        .gw-ic.grid { color: var(--gw-grid); }
        .stat-title { font-size: 0.9rem; font-weight: 700; }
        .stat-label { font-size: 0.68rem; color: var(--gw-dim); }
        .stat-val {
          font-size: 1.45rem; font-weight: 800; margin-top: 6px;
          font-variant-numeric: tabular-nums; line-height: 1.1;
        }
        /* two-entity tiles: main and second value side by side, same size */
        .stat.two .stat-lbls, .stat.two .stat-vals {
          display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
        }
        .stat.two .stat-vals .v2 { text-align: right; }

        /* ---- info list (compact label/value rows) ---- */
        .info {
          background: var(--gw-tile); border-radius: 14px;
          border: 1px solid rgba(255, 255, 255, 0.035);
          padding: 3px 14px; margin-top: 10px;
        }
        .irow {
          display: flex; justify-content: space-between; align-items: baseline;
          gap: 12px; padding: 9px 8px; margin-inline: -8px; border-radius: 8px;
          cursor: pointer; border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }
        .irow:hover { background: rgba(255, 255, 255, 0.04); }
        .irow:last-child, .irow.no-b { border-bottom: 1px solid transparent; }
        .i-name {
          display: flex; align-items: center; gap: 7px;
          font-size: 0.78rem; color: var(--gw-dim); white-space: nowrap;
        }
        .irow .gw-ic { width: 14px; height: 14px; color: var(--gw-dim); flex: none; opacity: 0.9; }
        .i-val {
          font-size: 0.82rem; font-weight: 700; text-align: right;
          font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis;
        }
        .i-val .u { font-size: 0.75em; }

        /* ---- alert flash (kept even in low_fx — it's a signal, not decor) ---- */
        @keyframes gwflash {
          0%, 100% { background: var(--gw-tile); }
          50% { background: rgba(255, 107, 107, 0.28); }
        }
        .stat.flash { animation: gwflash 1.1s ease-in-out infinite; }
        .stat.flash .stat-val, .stat.flash .gw-ic { color: #ff6b6b !important; }
        .irow.flash { animation: gwflash 1.1s ease-in-out infinite; }
        .irow.flash .i-val { color: #ff6b6b; }

        /* ---- preset buttons ---- */
        .btns { margin-top: 12px; }
        .btns-title, .info-title {
          font-size: 0.68rem; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.09em; color: var(--gw-dim); margin: 14px 2px 8px;
        }
        .btns-title { margin-top: 2px; }
        .btns-cur { color: var(--gw-text); font-weight: 700; }
        .btn-grid { display: grid; gap: 8px; }
        .pbtn {
          background: var(--gw-tile); border-radius: 12px; padding: 11px 6px;
          display: flex; flex-direction: column; align-items: center; gap: 6px;
          cursor: pointer; border: 1.5px solid rgba(255, 255, 255, 0.035);
          transition: border-color 0.2s, background 0.2s, transform 0.12s;
        }
        .pbtn .gw-ic { width: 16px; height: 16px; color: var(--gw-dim); }
        .pbtn-l { font-size: 0.8rem; font-weight: 700; font-variant-numeric: tabular-nums; }
        .pbtn.on {
          border-color: var(--gw-solar);
          background: color-mix(in srgb, var(--gw-solar) 15%, var(--gw-tile));
        }
        .pbtn.on .gw-ic { color: var(--gw-solar); }

        /* ---- switches ---- */
        .switches { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
        .switch {
          display: flex; align-items: center; gap: 11px;
          background: var(--gw-tile); border-radius: 14px; padding: 13px 14px; cursor: pointer;
          border: 1px solid rgba(255, 255, 255, 0.035);
          transition: background 0.3s, transform 0.12s;
        }
        .switch .gw-ic { width: 20px; height: 20px; color: var(--gw-dim); transition: color 0.3s; }
        .switch.on .gw-ic { color: var(--gw-batt); }
        .sw-name { flex: 1; font-size: 0.92rem; font-weight: 700; }
        .sw-toggle {
          width: 44px; height: 25px; border-radius: 13px; background: var(--gw-line);
          position: relative; transition: background 0.3s; flex: none;
        }
        .switch.on .sw-toggle { background: var(--gw-batt); }
        .sw-knob {
          position: absolute; top: 2px; left: 2px; width: 21px; height: 21px; border-radius: 50%;
          background: #fff; transition: left 0.25s;
        }
        .switch.on .sw-knob { left: 21px; }
        .switch.unavail { opacity: 0.4; pointer-events: none; }
      </style>

      <div class="card layout-${c.layout}${c.low_fx ? " fx-off" : ""}">
        <div class="header">
          <span class="title">${c.name}</span>
          <span class="updated" id="updated"></span>
        </div>

        <div class="body">
        <div class="flow">
          <svg class="lines" viewBox="0 0 420 300" preserveAspectRatio="none">
            <path id="p-solar-home" d="M210,46 C210,120 250,168 342,168"/>
            <path id="p-solar-batt" d="M210,46 C210,120 170,168 78,168"/>
            <path id="p-solar-grid" d="M210,46 C210,150 210,170 210,262"/>
            <path id="p-batt-home" d="M78,168 L342,168"/>
            <path id="p-grid-home" d="M210,262 C210,200 250,168 342,168"/>
            <path id="p-grid-batt" d="M210,262 C210,200 170,168 78,168"/>
          </svg>
          ${["solar-home|d-solar", "solar-batt|d-solar", "solar-grid|d-solar",
             "batt-home|d-batt", "grid-home|d-grid", "grid-batt|d-grid"]
            .map((f) => {
              const [path, cls] = f.split("|");
              return `<div class="dotv ${cls}" id="dot-${path}" style="animation-name: kf-${path}"></div>`;
            }).join("")}

          <div class="node solar${c.pv_max ? " ringed" : ""}" style="left:50%; top:15.3%" data-entity="${c.pv_power || ""}">
            <span class="node-label">${L.solar}</span>
            <div class="bubble">
              ${c.pv_max ? `<svg class="soc-ring" viewBox="0 0 80 80">
                <circle class="track" cx="40" cy="40" r="38"/>
                <circle class="arc" id="pvArc" cx="40" cy="40" r="38"
                  stroke-dasharray="238.76" stroke-dashoffset="238.76"/>
              </svg>` : ""}
              ${icon("sun")}<span class="node-val" id="pvVal">—</span>
            </div>
          </div>

          <div class="node batt" style="left:18.6%; top:56%" data-entity="${c.battery_soc || c.battery_power || ""}">
            <div class="bubble">
              <svg class="soc-ring" viewBox="0 0 80 80">
                <circle class="track" cx="40" cy="40" r="38"/>
                <circle class="arc" id="socArc" cx="40" cy="40" r="38"
                  stroke-dasharray="238.76" stroke-dashoffset="238.76"/>
              </svg>
              ${icon("battery")}
              <span class="node-val" id="socVal">—</span>
              <span class="node-sub" id="battKwh"></span>
            </div>
            <span class="node-label" id="battLabel">${L.battery}</span>
            <span class="node-eta" id="battEta" hidden></span>
          </div>

          <div class="node house${c.house_max ? " ringed" : ""}" style="left:81.4%; top:56%" data-entity="${c.house_power || ""}">
            <div class="bubble">
              ${c.house_max ? `<svg class="soc-ring" viewBox="0 0 80 80">
                <circle class="track" cx="40" cy="40" r="38"/>
                <circle class="arc" id="houseArc" cx="40" cy="40" r="38"
                  stroke-dasharray="238.76" stroke-dashoffset="238.76"/>
              </svg>` : ""}
              ${icon("home")}<span class="node-val" id="houseVal">—</span>
            </div>
            <span class="node-label">${L.home}</span>
          </div>

          <div class="node grid" style="left:50%; top:87.3%" data-entity="${c.grid_price || c.grid_power || ""}">
            <div class="bubble">
              ${icon("grid")}
              <span class="node-val" id="gridVal">—</span>
              ${c.grid_price ? `<span class="node-sub" id="gridPrice"></span>` : ""}
            </div>
            <span class="node-label" id="gridLabel">${L.grid}</span>
          </div>
        </div>

        <div class="side">
          ${c.show_separator && (stringsHtml || statsHtml || infoHtml || buttonsHtml || switchesHtml) ? `<div class="divider"></div>` : ""}
          ${stringsHtml}
          ${statsHtml}
          ${infoHtml}
          ${buttonsHtml}
          ${switchesHtml}
        </div>
        </div>
      </div>
    `;

    // cache refs
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._refs = {
      updated: $("updated"),
      pvVal: $("pvVal"), houseVal: $("houseVal"), gridVal: $("gridVal"), gridPrice: $("gridPrice"),
      socVal: $("socVal"), socArc: $("socArc"), battKwh: $("battKwh"),
      pvArc: $("pvArc"), houseArc: $("houseArc"),
      battLabel: $("battLabel"), battEta: $("battEta"), gridLabel: $("gridLabel"),
      prodToday: $("prodToday"), battToday: $("battToday"),
      gridInToday: $("gridInToday"), gridOutToday: $("gridOutToday"),
      solarNode: this.shadowRoot.querySelector(".node.solar"),
      battNode: this.shadowRoot.querySelector(".node.batt"),
      houseNode: this.shadowRoot.querySelector(".node.house"),
      gridNode: this.shadowRoot.querySelector(".node.grid"),
    };
    this._durCache = {};

    // node + tile taps → more-info
    this.shadowRoot.querySelectorAll(".node, .stat, .string, .irow").forEach((el) => {
      el.addEventListener("click", () => this._moreInfo(el.dataset.entity));
    });

    // preset button taps → set the group entity to the option's value
    this.shadowRoot.querySelectorAll(".pbtn").forEach((b) => {
      b.addEventListener("click", () => {
        if (!this._hass) return;
        const g = this._config.buttons[+b.dataset.g];
        const o = g.options[+b.dataset.o];
        const domain = g.entity.split(".")[0];
        if (domain === "select" || domain === "input_select") {
          this._hass.callService(domain, "select_option", { entity_id: g.entity, option: String(o.value) });
        } else {
          this._hass.callService(domain, "set_value", { entity_id: g.entity, value: o.value });
        }
      });
    });

    // switch taps → toggle
    this.shadowRoot.querySelectorAll(".switch").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.entity;
        if (id && this._hass) this._hass.callService("homeassistant", "toggle", { entity_id: id });
      });
    });

    // style element holding the generated dot keyframes
    this._kfStyle = document.createElement("style");
    this.shadowRoot.appendChild(this._kfStyle);
    this._kfKey = null;

    // ResizeObserver drives both auto-layout (old kiosk WebViews lack
    // @container) and dot-keyframe regeneration when the card resizes
    if (this._ro) this._ro.disconnect();
    const cardEl = this.shadowRoot.querySelector(".card");
    const flowEl = this.shadowRoot.querySelector(".flow");
    this._roTargets = [cardEl, flowEl];
    if (typeof ResizeObserver !== "undefined") {
      this._ro = new ResizeObserver(() => {
        if (c.layout === "auto") {
          cardEl.classList.toggle("layout-wide", cardEl.getBoundingClientRect().width >= 620);
        }
        this._buildDotKeyframes();
      });
      this._roTargets.forEach((el) => this._ro.observe(el));
    } else {
      setTimeout(() => this._buildDotKeyframes(), 0);
    }

    this._built = true;
  }

  disconnectedCallback() {
    if (this._ro) this._ro.disconnect();
  }

  connectedCallback() {
    if (this._ro && this._built) {
      (this._roTargets || []).forEach((el) => this._ro.observe(el));
    }
  }

  /* -------- per-update rendering -------- */

  // sample each flow path and emit @keyframes moving the dot along it in
  // pixels for the current card size — transform animations composite on
  // the GPU, so they stay smooth while the main thread is busy
  _buildDotKeyframes() {
    const flow = this.shadowRoot.querySelector(".flow");
    if (!flow || !this._kfStyle) return;
    const W = flow.clientWidth, H = flow.clientHeight;
    if (!W || !H) return;
    const key = `${W}x${H}`;
    if (this._kfKey === key) return;
    this._kfKey = key;
    let css = "";
    ["solar-home", "solar-batt", "solar-grid", "batt-home", "grid-home", "grid-batt"]
      .forEach((name) => {
        const p = this.shadowRoot.getElementById(`p-${name}`);
        if (!p || typeof p.getTotalLength !== "function") return;
        const len = p.getTotalLength();
        const steps = 24;
        const fr = [];
        for (let i = 0; i <= steps; i++) {
          const pt = p.getPointAtLength((len * i) / steps);
          fr.push(`${((i / steps) * 100).toFixed(2)}%{transform:translate3d(${((pt.x / 420) * W).toFixed(1)}px,${((pt.y / 300) * H).toFixed(1)}px,0)}`);
        }
        css += `@keyframes kf-${name}{${fr.join("")}}`;
      });
    this._kfStyle.textContent = css;
  }

  _setFlow(name, watts) {
    const dot = this.shadowRoot.getElementById(`dot-${name}`);
    const path = this.shadowRoot.getElementById(`p-${name}`);
    if (!dot) return;
    const active = watts >= FLOW_THRESHOLD_W;
    dot.classList.toggle("live", active);
    const src = name.split("-")[0];
    path.classList.toggle(`on-${src === "solar" ? "solar" : src === "batt" ? "batt" : "grid"}`, active);
    if (active) {
      const dur = flowDur(watts);
      if (this._durCache[name] !== dur) {
        this._durCache[name] = dur;
        dot.style.animationDuration = `${dur}s`;
      }
    }
  }

  _update() {
    const c = this._config;
    const r = this._refs;

    const pv = Math.max(0, this._num(c.pv_power) ?? 0);
    const house = Math.max(0, this._num(c.house_power) ?? 0);

    let battRaw = this._num(c.battery_power) ?? 0; // + = discharging
    if (c.invert_battery) battRaw = -battRaw;
    const battDischarge = Math.max(0, battRaw);
    const battCharge = Math.max(0, -battRaw);

    let gridRaw; // + = exporting
    if (c.grid_power) {
      gridRaw = this._num(c.grid_power) ?? 0;
      if (c.invert_grid) gridRaw = -gridRaw;
    } else {
      gridRaw = pv + battDischarge - house - battCharge;
    }
    const gridExport = Math.max(0, gridRaw);
    const gridImport = Math.max(0, -gridRaw);

    // split flows
    const solarToBatt = Math.min(pv, battCharge);
    const gridToBatt = Math.max(0, battCharge - solarToBatt);
    const solarToHome = Math.min(pv - solarToBatt, house);
    const solarToGrid = Math.max(0, pv - solarToBatt - solarToHome);
    const battToHome = Math.min(battDischarge, Math.max(0, house - solarToHome));
    const gridToHome = Math.max(0, house - solarToHome - battToHome);

    this._setFlow("solar-home", solarToHome);
    this._setFlow("solar-batt", solarToBatt);
    this._setFlow("solar-grid", solarToGrid);
    this._setFlow("batt-home", battToHome);
    this._setFlow("grid-home", gridToHome);
    this._setFlow("grid-batt", gridToBatt);

    // node values
    r.pvVal.innerHTML = c.pv_power ? powerHtml(this._num(c.pv_power)) : "—";
    r.houseVal.innerHTML = c.house_power ? powerHtml(this._num(c.house_power)) : "—";
    r.solarNode.classList.toggle("active-solar", pv >= FLOW_THRESHOLD_W);
    r.houseNode.classList.toggle("active-house", house >= FLOW_THRESHOLD_W);

    // power rings (fraction of configured max)
    const RING_C = 238.76;
    if (r.pvArc) r.pvArc.style.strokeDashoffset = RING_C * (1 - Math.min(1, pv / c.pv_max));
    if (r.houseArc) r.houseArc.style.strokeDashoffset = RING_C * (1 - Math.min(1, house / c.house_max));

    // grid node
    const L = c.labels;
    if (gridImport >= FLOW_THRESHOLD_W) {
      r.gridVal.innerHTML = powerHtml(gridImport);
      r.gridLabel.textContent = `${L.grid} · ${L.grid_import}`;
    } else if (gridExport >= FLOW_THRESHOLD_W) {
      r.gridVal.innerHTML = powerHtml(gridExport);
      r.gridLabel.textContent = `${L.grid} · ${L.grid_export}`;
    } else {
      r.gridVal.innerHTML = `0<span class="u">W</span>`;
      r.gridLabel.textContent = L.grid;
    }
    if (r.gridPrice) {
      const priceSt = this._state(c.grid_price);
      r.gridPrice.textContent = priceSt
        ? fmtPrice(num(priceSt.state), priceSt.attributes.unit_of_measurement || "")
        : "";
    }
    r.gridNode.classList.toggle("active-grid", gridImport >= FLOW_THRESHOLD_W || gridExport >= FLOW_THRESHOLD_W);

    // battery node
    const soc = this._num(c.battery_soc);
    const circumference = 238.76;
    if (soc !== null) {
      r.socVal.innerHTML = `${Math.round(soc)}<span class="u">%</span>`;
      r.socArc.style.strokeDashoffset = circumference * (1 - Math.min(soc, 100) / 100);
      const color = soc < 20 ? "var(--gw-batt-low)" : soc < 45 ? "var(--gw-batt-mid)" : "var(--gw-batt)";
      r.socArc.style.stroke = color;
      r.battNode.style.color = color;
    } else {
      r.socVal.textContent = "—";
      r.socArc.style.strokeDashoffset = circumference;
    }
    if (c.battery_capacity_kwh && soc !== null) {
      r.battKwh.textContent = `${((soc / 100) * c.battery_capacity_kwh).toFixed(2)} kWh`;
    }
    const battActive = battCharge >= FLOW_THRESHOLD_W || battDischarge >= FLOW_THRESHOLD_W;
    r.battNode.classList.toggle("active-batt", battActive);
    r.battNode.classList.toggle("charging", battCharge >= FLOW_THRESHOLD_W);
    r.battLabel.textContent =
      battCharge >= FLOW_THRESHOLD_W ? `${L.charging} · ${fmtPower(battCharge)}` :
      battDischarge >= FLOW_THRESHOLD_W ? `${L.battery} · ${fmtPower(battDischarge)}` : L.battery;

    // time-to-full / time-to-empty (needs battery_capacity_kwh)
    let eta = "";
    if (c.battery_capacity_kwh && soc !== null) {
      const capWh = c.battery_capacity_kwh * 1000;
      if (battCharge >= FLOW_THRESHOLD_W && soc < 99.5) {
        const t = fmtEta(((100 - soc) / 100) * capWh / battCharge);
        if (t) eta = `${L.full} ${t}`;
      } else if (battDischarge >= FLOW_THRESHOLD_W && soc > c.battery_min_soc + 0.5) {
        const t = fmtEta(((soc - c.battery_min_soc) / 100) * capWh / battDischarge);
        if (t) eta = `${L.empty} ${t}`;
      }
    }
    r.battEta.textContent = eta;
    r.battEta.hidden = !eta;

    // power bars (unit-aware: % sensors fill directly, no max needed)
    c.strings.forEach((s, i) => {
      const fill = this.shadowRoot.getElementById(`sfill${i}`);
      const val = this.shadowRoot.getElementById(`sval${i}`);
      if (!fill) return;
      const st = this._state(s.entity);
      const v = st ? num(st.state) : null;
      const unit = st ? (st.attributes.unit_of_measurement || "").trim() : "";
      if (unit === "%") {
        val.textContent = v === null ? "—" : `${Math.round(v)}%`;
        fill.style.width = v === null ? "0%" : `${Math.min(100, Math.max(0, v))}%`;
      } else {
        val.textContent = fmtPower(v);
        fill.style.width = v === null ? "0%" : `${Math.min(100, (v / (s.max || 4000)) * 100)}%`;
      }
    });

    // custom tiles
    c.tiles.forEach((t, i) => {
      const el = this.shadowRoot.getElementById(`ctile${i}`);
      if (!el) return;
      el.innerHTML = this._fmtState(t.entity);
      const el2 = this.shadowRoot.getElementById(`ctile2${i}`);
      if (el2) el2.innerHTML = this._fmtState(t.entity2);
      const st = this._state(t.entity);
      el.parentElement.classList.toggle("flash", isAlert(t, st && st.state));
    });

    // info rows
    c.info.forEach((t, i) => {
      const el = this.shadowRoot.getElementById(`info${i}`);
      if (!el) return;
      el.innerHTML = t.format === "duration"
        ? fmtDuration(this._num(t.entity))
        : this._fmtState(t.entity);
      const st = this._state(t.entity);
      el.parentElement.classList.toggle("flash", isAlert(t, st && st.state));
    });

    // stats
    if (r.prodToday) r.prodToday.innerHTML = this._energy(c.production_today);
    if (r.battToday) r.battToday.innerHTML = this._energy(c.battery_today);
    if (r.gridInToday) r.gridInToday.innerHTML = this._energy(c.grid_import_today);
    if (r.gridOutToday) r.gridOutToday.innerHTML = this._energy(c.grid_export_today);

    // last update
    const lu = this._state(c.last_update);
    if (lu) {
      const d = new Date(lu.state);
      r.updated.textContent = isNaN(d)
        ? lu.state
        : `${L.updated} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }

    // preset buttons: highlight the active option, label numbers with the unit
    c.buttons.forEach((g, gi) => {
      const st = this._state(g.entity);
      const unit = st ? (st.attributes.unit_of_measurement || "").trim() : "";
      const v = st ? num(st.state) : null;
      g.options.forEach((o, oi) => {
        const btn = this.shadowRoot.getElementById(`pbtn${gi}_${oi}`);
        if (!btn) return;
        const lbl = this.shadowRoot.getElementById(`pbl${gi}_${oi}`);
        if (lbl && o.label == null && unit) lbl.textContent = `${o.value} ${unit}`;
        const ov = num(o.value);
        const active = st && (v !== null && ov !== null
          ? Math.abs(v - ov) < 0.5
          : String(st.state).toLowerCase() === String(o.value).toLowerCase());
        btn.classList.toggle("on", !!active);
      });
      const cur = this.shadowRoot.getElementById(`bcur${gi}`);
      if (cur) cur.textContent = st ? ` · ${st.state}${unit ? ` ${unit}` : ""}` : "";
    });

    // switches
    this._config.switches.forEach((s, i) => {
      const el = this.shadowRoot.getElementById(`sw${i}`);
      if (!el) return;
      const st = this._hass.states[s.entity];
      el.classList.toggle("unavail", !st || st.state === "unavailable");
      el.classList.toggle("on", !!st && st.state === "on");
    });
  }
}

customElements.define("goodwe-flow-card-m0e", GoodweFlowCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "goodwe-flow-card-m0e",
  name: "GoodWe Flow Card",
  description: "Animated energy-flow card for GoodWe hybrid inverters (solar, battery, home, grid).",
  preview: true,
});

console.info(`%c GOODWE-FLOW-CARD-M0E %c v${CARD_VERSION} `,
  "background:#35d49a;color:#000;font-weight:700;border-radius:3px 0 0 3px;padding:2px 0",
  "background:#222;color:#35d49a;border-radius:0 3px 3px 0;padding:2px 0");
