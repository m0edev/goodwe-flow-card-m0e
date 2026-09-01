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

const CARD_VERSION = "1.0.0";
const FLOW_THRESHOLD_W = 25; // flows below this are treated as zero

/* ---------------------------------------------------------------- helpers */

const num = (v) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
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
};

const icon = (name, cls = "") =>
  `<svg class="gw-ic ${cls}" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.6" fill="none">${ICONS[name] || ICONS.bolt}</svg>`;

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
    if (!config || (!config.entities && !config.strings)) {
      throw new Error("goodwe-flow-card-m0e: define an `entities:` block");
    }
    const e = config.entities || {};

    // strings: new style `strings:` list, or legacy p1..p4 keys
    let strings = [];
    if (Array.isArray(config.strings)) {
      strings = config.strings.map((s, i) =>
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
      last_update: e.last_update,
      strings,
      battery_capacity_kwh: num(config.battery_capacity_kwh),
      invert_battery: !!config.invert_battery,
      invert_grid: !!config.invert_grid,
      switches: config.switches || config.custom_settings || [],
      show_strings: config.show_strings !== false,
      show_stats: config.show_stats !== false,
    };
    this._built = false;
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
    this._hass = hass;
    if (!this._config) return;
    if (!this._built) this._build();
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
            <div class="s-bar"><div class="s-fill" id="sfill${i}"></div></div>
            <span class="s-val" id="sval${i}">—</span>
          </div>`).join("")}</div>`
      : "";

    const tile = (entity, title, label, valId, ic, icCls) => `
        <div class="stat" data-entity="${entity}">
          <span class="stat-title">${title}</span>
          <span class="stat-label">${label}</span>
          <span class="stat-val" id="${valId}">—</span>
          ${icon(ic, icCls)}
        </div>`;
    const statsHtml = c.show_stats ? `
      <div class="stats">
        ${c.production_today ? tile(c.production_today, "Production", "Today", "prodToday", "chart", "solar") : ""}
        ${c.battery_today ? tile(c.battery_today, "Battery", "Today", "battToday", "battery", "batt") : ""}
        ${c.grid_import_today ? tile(c.grid_import_today, "Grid in", "Today", "gridInToday", "grid", "grid") : ""}
        ${c.grid_export_today ? tile(c.grid_export_today, "Grid out", "Today", "gridOutToday", "grid", "grid") : ""}
      </div>` : "";

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

        /* value + unit pairs: big number, small dim unit */
        .u { font-size: 0.62em; font-weight: 600; color: var(--gw-dim); margin-left: 2px; }

        /* ---- flow area ---- */
        .flow { position: relative; width: 100%; aspect-ratio: 420 / 300; container-type: inline-size; }
        .flow svg.lines { position: absolute; inset: 0; width: 100%; height: 100%; }
        .lines path { fill: none; stroke: var(--gw-line); stroke-width: 1.6; transition: stroke 0.4s; }
        .lines path.on-solar { stroke: color-mix(in srgb, var(--gw-solar) 45%, transparent); }
        .lines path.on-batt { stroke: color-mix(in srgb, var(--gw-batt) 45%, transparent); }
        .lines path.on-grid { stroke: color-mix(in srgb, var(--gw-grid) 45%, transparent); }
        .dot { visibility: hidden; }
        .dot.live { visibility: visible; }
        .dot.d-solar { fill: var(--gw-solar); }
        .dot.d-batt { fill: var(--gw-batt); }
        .dot.d-grid { fill: var(--gw-grid); }

        .node {
          position: absolute; transform: translate(-50%, -50%);
          display: flex; flex-direction: column; align-items: center; gap: 3px;
          cursor: pointer; z-index: 2;
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
        .node.batt .gw-bolt { fill: none; }
        .node.batt.charging .gw-bolt { fill: currentColor; animation: pulse 1.6s ease-in-out infinite; }
        @keyframes pulse { 50% { opacity: 0.35; } }

        /* ---- PV strings ---- */
        .strings { display: flex; flex-direction: column; gap: 7px; margin: 12px 2px 0; }
        .string { display: flex; align-items: center; gap: 10px; cursor: pointer; }
        .s-name { font-size: 0.74rem; font-weight: 600; color: var(--gw-dim); width: 32px; }
        .s-bar { flex: 1; height: 5px; border-radius: 3px; background: var(--gw-line); overflow: hidden; }
        .s-fill { height: 100%; width: 0%; border-radius: 3px; background: var(--gw-solar); transition: width 0.8s; }
        .s-val { font-size: 0.8rem; font-weight: 700; width: 66px; text-align: right; font-variant-numeric: tabular-nums; }

        /* ---- stat tiles (SYMBOX style: bold title, dim sub, big value) ---- */
        .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
        .stat {
          position: relative; display: flex; flex-direction: column; gap: 2px;
          background: var(--gw-tile); border-radius: 14px; padding: 13px 14px 12px; cursor: pointer;
          min-width: 0;
        }
        .stat .gw-ic {
          position: absolute; right: 12px; bottom: 12px;
          width: 20px; height: 20px; color: var(--gw-dim); opacity: 0.8;
        }
        .gw-ic.solar { color: var(--gw-solar); }
        .gw-ic.batt { color: var(--gw-batt); }
        .gw-ic.grid { color: var(--gw-grid); }
        .stat-title { font-size: 0.9rem; font-weight: 700; }
        .stat-label { font-size: 0.68rem; color: var(--gw-dim); }
        .stat-val {
          font-size: 1.45rem; font-weight: 800; margin-top: 6px;
          font-variant-numeric: tabular-nums; line-height: 1.1;
        }

        /* ---- switches ---- */
        .switches { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
        .switch {
          display: flex; align-items: center; gap: 11px;
          background: var(--gw-tile); border-radius: 14px; padding: 13px 14px; cursor: pointer;
          transition: background 0.3s;
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

      <div class="card">
        <div class="header">
          <span class="title">${c.name}</span>
          <span class="updated" id="updated"></span>
        </div>

        <div class="flow">
          <svg class="lines" viewBox="0 0 420 300" preserveAspectRatio="none">
            <path id="p-solar-home" d="M210,46 C210,120 250,168 342,168"/>
            <path id="p-solar-batt" d="M210,46 C210,120 170,168 78,168"/>
            <path id="p-solar-grid" d="M210,46 C210,150 210,170 210,262"/>
            <path id="p-batt-home" d="M78,168 L342,168"/>
            <path id="p-grid-home" d="M210,262 C210,200 250,168 342,168"/>
            <path id="p-grid-batt" d="M210,262 C210,200 170,168 78,168"/>
            ${["solar-home|d-solar", "solar-batt|d-solar", "solar-grid|d-solar",
               "batt-home|d-batt", "grid-home|d-grid", "grid-batt|d-grid"]
              .map((f) => {
                const [path, cls] = f.split("|");
                return `<circle class="dot ${cls}" id="dot-${path}" r="4.5">
                  <animateMotion id="anim-${path}" dur="4s" repeatCount="indefinite">
                    <mpath href="#p-${path}"/>
                  </animateMotion>
                </circle>`;
              }).join("")}
          </svg>

          <div class="node solar" style="left:50%; top:15.3%" data-entity="${c.pv_power || ""}">
            <span class="node-label">Solar</span>
            <div class="bubble">${icon("sun")}<span class="node-val" id="pvVal">—</span></div>
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
            <span class="node-label" id="battLabel">Battery</span>
          </div>

          <div class="node house" style="left:81.4%; top:56%" data-entity="${c.house_power || ""}">
            <div class="bubble">${icon("home")}<span class="node-val" id="houseVal">—</span></div>
            <span class="node-label">Home</span>
          </div>

          <div class="node grid" style="left:50%; top:87.3%" data-entity="${c.grid_power || ""}">
            <div class="bubble">${icon("grid")}<span class="node-val" id="gridVal">—</span></div>
            <span class="node-label" id="gridLabel">Grid</span>
          </div>
        </div>

        ${stringsHtml}
        ${statsHtml}
        ${switchesHtml}
      </div>
    `;

    // cache refs
    const $ = (id) => this.shadowRoot.getElementById(id);
    this._refs = {
      updated: $("updated"),
      pvVal: $("pvVal"), houseVal: $("houseVal"), gridVal: $("gridVal"),
      socVal: $("socVal"), socArc: $("socArc"), battKwh: $("battKwh"),
      battLabel: $("battLabel"), gridLabel: $("gridLabel"),
      prodToday: $("prodToday"), battToday: $("battToday"),
      gridInToday: $("gridInToday"), gridOutToday: $("gridOutToday"),
      solarNode: this.shadowRoot.querySelector(".node.solar"),
      battNode: this.shadowRoot.querySelector(".node.batt"),
      houseNode: this.shadowRoot.querySelector(".node.house"),
      gridNode: this.shadowRoot.querySelector(".node.grid"),
    };
    this._durCache = {};

    // node + tile taps → more-info
    this.shadowRoot.querySelectorAll(".node, .stat, .string").forEach((el) => {
      el.addEventListener("click", () => this._moreInfo(el.dataset.entity));
    });

    // switch taps → toggle
    this.shadowRoot.querySelectorAll(".switch").forEach((el) => {
      el.addEventListener("click", () => {
        const id = el.dataset.entity;
        if (id && this._hass) this._hass.callService("homeassistant", "toggle", { entity_id: id });
      });
    });

    this._built = true;
  }

  /* -------- per-update rendering -------- */

  _setFlow(name, watts) {
    const dot = this.shadowRoot.getElementById(`dot-${name}`);
    const anim = this.shadowRoot.getElementById(`anim-${name}`);
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
        anim.setAttribute("dur", `${dur}s`);
        if (typeof anim.beginElement === "function") {
          try { anim.beginElement(); } catch (e) { /* SMIL not ready yet */ }
        }
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

    // grid node
    if (gridImport >= FLOW_THRESHOLD_W) {
      r.gridVal.innerHTML = powerHtml(gridImport);
      r.gridLabel.textContent = "Grid · import";
    } else if (gridExport >= FLOW_THRESHOLD_W) {
      r.gridVal.innerHTML = powerHtml(gridExport);
      r.gridLabel.textContent = "Grid · export";
    } else {
      r.gridVal.innerHTML = `0<span class="u">W</span>`;
      r.gridLabel.textContent = "Grid";
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
      battCharge >= FLOW_THRESHOLD_W ? `Charging · ${fmtPower(battCharge)}` :
      battDischarge >= FLOW_THRESHOLD_W ? `Battery · ${fmtPower(battDischarge)}` : "Battery";

    // PV strings
    c.strings.forEach((s, i) => {
      const fill = this.shadowRoot.getElementById(`sfill${i}`);
      const val = this.shadowRoot.getElementById(`sval${i}`);
      if (!fill) return;
      const w = this._num(s.entity);
      val.textContent = fmtPower(w);
      fill.style.width = w === null ? "0%" : `${Math.min(100, (w / (s.max || 4000)) * 100)}%`;
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
        : `updated ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }

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
