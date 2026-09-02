# GoodWe Flow Card

A custom Home Assistant Lovelace card for GoodWe hybrid inverters. Instead of
static tiles it draws a live, animated energy-flow diagram — solar, battery,
home and grid as nodes, with dots travelling along the wires at a speed
proportional to the power flowing. Inspired by
[b2500d-card](https://github.com/Neisi/b2500d-card), rebuilt from scratch with
no dependencies and no build step.

**Preview:** serve the repo root (e.g. `python3 -m http.server`) and open
`/demo/` to see the card running against mocked data with selectable
scenarios.

## Features

- Animated flow lines: solar → home, solar → battery, solar → grid (export),
  battery → home, grid → home (import), grid → battery (fast charge)
- Battery SOC ring that changes colour (green / amber / red) with charge level,
  pulsing bolt while charging, remaining kWh, and a time-to-full / time-to-empty
  estimate ("Full 2:40 pm") — both need `battery_capacity_kwh` set
- Grid node automatically labels itself *import* / *export*; if you have no
  grid sensor the card derives grid power from PV, battery and house load
- Live electricity price inside the grid node (e.g. an Amber Electric price
  sensor) via `entities.grid_price`
- Every label on the card is editable via the `labels:` block
- Labelled power bars for anything — PV strings, UPS/backup load, EV charger —
  each with its own name, max scale and colour; a divider separates them from
  the flow diagram
- Daily stats row: solar today, battery today, grid in/out today
- Landscape/tablet layout: `layout: auto` (default) puts the flow beside the
  tiles whenever the card is wider than ~620px; force with `layout: wide` or
  keep it stacked with `layout: tall`
- Custom tiles for any sensor (`tiles:`) — UPS load, prices, temperatures —
  auto-formatted by unit (%, W/kW, Wh/kWh, $/kWh) with pick-an-icon and colour
- Compact info list (`info:`) for small readings — voltages, currents, states,
  alarms — as label/value rows, with `format: duration` for seconds sensors
- Quick-toggle pills for switches (e.g. GoodWe Fast Charge) — tap to toggle
- Tap any node or stat to open the entity's more-info dialog
- Accepts legacy `b2500d-card` entity keys, so an existing config drops in
  with just the `type:` line changed

## Install

### HACS (recommended)

1. HACS → ⋮ → **Custom repositories** → add `https://github.com/m0edev/goodwe-flow-card-m0e`
   with type **Dashboard**.
2. Search for **GoodWe Flow Card (m0e)** in HACS and download it — HACS picks
   up `dist/goodwe-flow-card-m0e.js` and registers the Lovelace resource for
   you.
3. Add the card to a dashboard (YAML below).

### Manual

1. Copy `dist/goodwe-flow-card-m0e.js` into your HA `config/www/` folder.
2. Add a Lovelace resource: **Settings → Dashboards → ⋮ → Resources →
   Add** → URL `/local/goodwe-flow-card-m0e.js`, type **JavaScript module**.
3. Add the card to a dashboard (YAML below).

## Example config (GoodWe ET/EH via the core GoodWe integration)

```yaml
type: custom:goodwe-flow-card-m0e
name: SYMBOX
battery_capacity_kwh: 1.6        # optional — shows remaining kWh in the ring
entities:
  pv_power: sensor.symphony_house_goodwe_pv_power
  p1_power: sensor.symphony_house_goodwe_pv1_power
  house_power: sensor.symphony_house_goodwe_house_consumption
  battery_power: sensor.symphony_house_goodwe_battery_power
  battery_soc: sensor.symphony_house_goodwe_battery_state_of_charge
  production_today: sensor.symphony_house_goodwe_today_s_pv_generation
  battery_today: sensor.symphony_house_goodwe_today_battery_discharge
  last_update: sensor.symphony_house_goodwe_timestamp
  grid_price: sensor.symphony_house_amber_express_symphonyhouse_general_price
  # optional extras if you have them:
  # grid_power: sensor.symphony_house_goodwe_active_power
  # grid_import_today: sensor.symphony_house_goodwe_today_energy_import
  # grid_export_today: sensor.symphony_house_goodwe_today_energy_export
bars:                            # labelled power bars under the flow
  - entity: sensor.symphony_house_goodwe_pv_power
    name: PV
    max: 6600
  - entity: sensor.symphony_house_goodwe_backup_load
    name: UPS
    max: 2400
    color: "#5aa9e6"
tiles:                           # optional extra tiles for any sensor
  - entity: sensor.symphony_house_goodwe_ups_load
    name: UPS
    sub: Load
    icon: bolt
    color: "#5aa9e6"
switches:
  - entity: switch.symphony_house_goodwe_fast_charging_switch
    name: Fast Charge
labels:            # optional — override any text on the card
  home: House
  grid_import: buying
  grid_export: selling
```

## All options

| Option | Default | Description |
| --- | --- | --- |
| `name` | `GoodWe` | Card title |
| `entities.pv_power` | — | Total PV power (W). Legacy alias: `solar_power` |
| `entities.house_power` | — | House consumption (W). Legacy alias: `output_power` |
| `entities.battery_power` | — | Battery power (W), positive = discharging |
| `entities.battery_soc` | — | Battery state of charge (%). Legacy alias: `battery_percentage` |
| `entities.grid_power` | derived | Grid power (W), positive = exporting. Derived from the other sensors if omitted |
| `entities.production_today` | — | PV generation today (kWh or Wh) |
| `entities.battery_today` | — | Battery energy today (kWh or Wh). Legacy alias: `battery_capacity` |
| `entities.grid_import_today` / `grid_export_today` | — | Optional daily grid stats |
| `entities.grid_price` | — | Live electricity price shown in the grid node (`$/kWh` or `¢/kWh` sensors, e.g. Amber) |
| `entities.last_update` | — | Timestamp sensor shown in the header |
| `entities.p1_power` … `p4_power` | — | Per-string PV sensors (legacy style) |
| `bars` | — | Labelled power bars: `[{entity, name, max, color}]` — overrides `pN_power`. `%` sensors fill the bar directly (no `max` needed). `strings` is an accepted alias |
| `tiles` | — | Extra stat tiles: `[{entity, name, sub, icon, color}]`, appended after the built-in daily tiles. Icons: `sun`, `home`, `battery`, `grid`, `chart`, `bolt` |
| `max_input_power` … `max_input_power4` | `4000` | Max W per string, scales its bar |
| `battery_capacity_kwh` | — | Usable pack size; enables the kWh readout and the time-to-full/empty estimate |
| `battery_min_soc` | `0` | Discharge floor (%); time-to-empty counts down to this instead of 0 |
| `invert_battery` | `false` | Set if charging/discharging show reversed |
| `invert_grid` | `false` | Set if import/export show reversed |
| `info` | — | Compact label/value rows: `[{entity, name, format}]`; `format: duration` renders a seconds sensor as `5h 03m` |
| `switches` | `[]` | Toggle pills: `[{entity, name}]`. Legacy alias: `custom_settings` |
| `show_bars` / `show_stats` / `show_separator` | `true` | Hide the power bars / stats row / divider line |
| `layout` | `auto` | `auto` = side-by-side when the card is wide (landscape tablet), stacked when narrow; `wide` / `tall` force it |
| `labels` | — | Override any text: `solar`, `home`, `battery`, `grid`, `grid_import`, `grid_export`, `charging`, `full`, `empty`, `updated`, `today`, `production`, `battery_today`, `grid_in`, `grid_out` |

### Sign conventions

The GoodWe integration reports battery power as **positive while discharging**
and grid (`active_power`) as **positive while exporting**. Some firmware /
Modbus setups are reversed — if the animation runs the wrong way, flip
`invert_battery` or `invert_grid` rather than editing sensors.

## Theming

Override these CSS variables in your HA theme to restyle the card:
`--gw-solar-color`, `--gw-batt-color`, `--gw-grid-color`, `--gw-house-color`.
Card background and text colours follow the active HA theme.
