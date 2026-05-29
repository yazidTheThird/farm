import { useState, useCallback, useMemo, useEffect } from "react";
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ComposedChart
} from "recharts";

/* ─── THEME ─────────────────────────────────────────────────── */
const T = {
  soil:   "#2C1A0E",
  forest: "#1B3A2D",
  moss:   "#3A5C3A",
  leaf:   "#5C8A3C",
  straw:  "#C8A84B",
  ochre:  "#D4732A",
  cream:  "#F5F0E4",
  fog:    "#E8E2D4",
  mist:   "#D0C8B8",
  sky:    "#7EB8C9",
  rain:   "#4A90B8",
  frost:  "#A8D4E6",
};

const FONT_DISPLAY = "'Playfair Display', Georgia, serif";
const FONT_BODY    = "'DM Mono', 'Courier New', monospace";

/* ─── OPEN-METEO VARIABLE DEFINITIONS ───────────────────────── */
const VARIABLES = [
  { id: "temperature_2m_max",            label: "Max Temperature",       unit: "°C", color: T.ochre,  group: "Temperature", chartType: "line" },
  { id: "temperature_2m_min",            label: "Min Temperature",       unit: "°C", color: T.sky,    group: "Temperature", chartType: "line" },
  { id: "temperature_2m_mean",           label: "Mean Temperature",      unit: "°C", color: T.straw,  group: "Temperature", chartType: "line" },
  { id: "precipitation_sum",             label: "Daily Rainfall",        unit: "mm", color: T.rain,   group: "Water", chartType: "bar" },
  { id: "et0_fao_evapotranspiration",    label: "Evapotranspiration",    unit: "mm", color: T.moss,   group: "Water", chartType: "line" },
  { id: "relative_humidity_2m_mean",     label: "Avg Humidity",          unit: "%",  color: T.frost,  group: "Atmosphere", chartType: "area" },
  { id: "windspeed_10m_max",             label: "Max Wind Speed",        unit: "km/h", color: T.mist, group: "Atmosphere", chartType: "line" },
  { id: "shortwave_radiation_sum",       label: "Solar Radiation",       unit: "MJ/m²", color: "#F5C842", group: "Energy", chartType: "area" },
  { id: "soil_temperature_0_to_7cm_mean", label: "Soil Temp (0–7cm)",   unit: "°C", color: "#A0785A", group: "Soil", chartType: "line" },
];

const VAR_MAP = Object.fromEntries(VARIABLES.map(v => [v.id, v]));

/* ─── HELPERS ────────────────────────────────────────────────── */
function formatDate(d) {
  return d.toISOString().split("T")[0];
}
function addDays(d, n) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r;
}
function parseLocalDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function daysBetween(a, b) {
  return Math.round((parseLocalDate(b) - parseLocalDate(a)) / 86400000);
}

/* Growing Degree Days base 10°C */
function computeGDD(data) {
  return data.reduce((sum, d) => {
    const tmax = d.temperature_2m_max ?? 0;
    const tmin = d.temperature_2m_min ?? 0;
    return sum + Math.max(0, (tmax + tmin) / 2 - 10);
  }, 0);
}

/* Simple aridity index: precip / ET0 */
function computeAridity(data) {
  const totalP  = data.reduce((s, d) => s + (d.precipitation_sum ?? 0), 0);
  const totalET = data.reduce((s, d) => s + (d.et0_fao_evapotranspiration ?? 0), 0);
  return totalET > 0 ? (totalP / totalET) : null;
}

/* ─── CUSTOM TOOLTIP ─────────────────────────────────────────── */
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: T.soil, border: `1px solid ${T.straw}`,
      borderRadius: 6, padding: "10px 14px", fontFamily: FONT_BODY,
      fontSize: 12, color: T.cream, minWidth: 160,
    }}>
      <div style={{ color: T.straw, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      {payload.map(p => (
        <div key={p.dataKey} style={{ color: p.color, marginBottom: 2 }}>
          {VAR_MAP[p.dataKey]?.label ?? p.dataKey}: <b>{p.value?.toFixed?.(1) ?? p.value}</b>{" "}
          {VAR_MAP[p.dataKey]?.unit ?? ""}
        </div>
      ))}
    </div>
  );
};

/* ─── STAT CARD ──────────────────────────────────────────────── */
const StatCard = ({ label, value, unit, sub, accent = T.straw }) => (
  <div style={{
    background: `linear-gradient(135deg, ${T.forest} 0%, ${T.soil} 100%)`,
    border: `1px solid ${accent}44`,
    borderRadius: 10, padding: "16px 20px", flex: "1 1 150px",
    fontFamily: FONT_BODY,
  }}>
    <div style={{ color: T.mist, fontSize: 11, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{label}</div>
    <div style={{ color: accent, fontSize: 26, fontWeight: 700, fontFamily: FONT_DISPLAY, lineHeight: 1 }}>
      {value ?? "—"}<span style={{ fontSize: 14, marginLeft: 4 }}>{unit}</span>
    </div>
    {sub && <div style={{ color: T.mist, fontSize: 11, marginTop: 6 }}>{sub}</div>}
  </div>
);

/* ─── SECTION HEADER ─────────────────────────────────────────── */
const SectionTitle = ({ icon, children }) => (
  <div style={{
    fontFamily: FONT_DISPLAY, fontSize: 18, color: T.straw,
    borderBottom: `1px solid ${T.straw}33`, paddingBottom: 8,
    marginBottom: 16, display: "flex", alignItems: "center", gap: 8,
  }}>
    <span>{icon}</span>{children}
  </div>
);

/* ─── CHART BLOCK ────────────────────────────────────────────── */
const ChartBlock = ({ title, data, varIds }) => {
  if (!data.length || !varIds.length) return null;
  const defs = varIds.map(id => VAR_MAP[id]).filter(Boolean);
  const hasBars  = defs.some(d => d.chartType === "bar");
  const hasLines = defs.some(d => d.chartType === "line" || d.chartType === "area");

  const ticks = useMemo(() => {
    const step = Math.max(1, Math.floor(data.length / 10));
    return data.filter((_, i) => i % step === 0).map(d => d.date);
  }, [data]);

  return (
    <div style={{
      background: `${T.soil}CC`, border: `1px solid ${T.forest}`,
      borderRadius: 12, padding: "20px 16px", marginBottom: 20,
    }}>
      <div style={{ fontFamily: FONT_BODY, color: T.straw, fontSize: 13, marginBottom: 14, fontWeight: 700 }}>
        {title}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={`${T.forest}88`} />
          <XAxis dataKey="date" ticks={ticks} tick={{ fill: T.mist, fontSize: 10, fontFamily: FONT_BODY }} />
          <YAxis tick={{ fill: T.mist, fontSize: 10, fontFamily: FONT_BODY }} width={42} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontFamily: FONT_BODY, fontSize: 11, color: T.cream }} />
          {defs.some(d => d.group === "Temperature") && (
            <ReferenceLine y={0} stroke={T.frost} strokeDasharray="4 2" label={{ value: "0°C", fill: T.frost, fontSize: 10 }} />
          )}
          {defs.map(def => {
            if (def.chartType === "bar") return (
              <Bar key={def.id} dataKey={def.id} name={def.label} fill={def.color} opacity={0.85} radius={[2,2,0,0]} />
            );
            if (def.chartType === "area") return (
              <Area key={def.id} type="monotone" dataKey={def.id} name={def.label}
                stroke={def.color} fill={`${def.color}33`} strokeWidth={2} dot={false} />
            );
            return (
              <Line key={def.id} type="monotone" dataKey={def.id} name={def.label}
                stroke={def.color} strokeWidth={2} dot={false} />
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
};

/* ─── MAIN APP ───────────────────────────────────────────────── */
export default function AgriWeather() {
  const today     = new Date();
  const oneYearAgo = addDays(today, -365);

  // Persisted state: load from localStorage
  const [lat, setLat]           = useState(() => localStorage.getItem('agro_lat') || "32.3193");
  const [lon, setLon]           = useState(() => localStorage.getItem('agro_lon') || "-3.6149");
  const [locName, setLocName]   = useState(() => localStorage.getItem('agro_locName') || "");
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem('agro_favorites')) || []; } catch { return []; }
  });
  const [startDate, setStart]   = useState(formatDate(addDays(today, -180)));
  const [endDate, setEnd]       = useState(formatDate(addDays(today, -1)));
  const [selVars, setSelVars]   = useState(new Set([
    "temperature_2m_max","temperature_2m_min","precipitation_sum",
    "relative_humidity_2m_mean","et0_fao_evapotranspiration",
  ]));
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [chartData, setChartData] = useState([]);
  const [rawDaily, setRaw]      = useState(null);
  const [analyzed, setAnalyzed] = useState(false);
  const [showFavs, setShowFavs] = useState(false);

  // Persist location on change
  useEffect(() => { localStorage.setItem('agro_lat', lat); }, [lat]);
  useEffect(() => { localStorage.setItem('agro_lon', lon); }, [lon]);
  useEffect(() => { localStorage.setItem('agro_locName', locName); }, [locName]);
  useEffect(() => { localStorage.setItem('agro_favorites', JSON.stringify(favorites)); }, [favorites]);

  /* toggle variable */
  const toggleVar = id => {
    setSelVars(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  /* ── FETCH ── */
  const fetchWeather = useCallback(async () => {
    if (!lat || !lon) { setError("Please enter latitude and longitude."); return; }
    const days = daysBetween(startDate, endDate);
    if (days < 1) { setError("End date must be after start date."); return; }
    if (days > 1825) { setError("Please keep the date range under 5 years for performance."); return; }

    setLoading(true); setError(null); setAnalyzed(false);
    try {
      const vars = [...selVars].join(",");
      // Use archive API for historical, forecast for future dates
      const today0 = formatDate(new Date());
      const isHistorical = endDate <= today0;
      const baseUrl = isHistorical
        ? "https://archive-api.open-meteo.com/v1/archive"
        : "https://api.open-meteo.com/v1/forecast";

      const url = `${baseUrl}?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=${vars}&timezone=auto`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.reason ?? "Unknown API error");

      const dates = json.daily.time;
      const parsed = dates.map((date, i) => {
        const row = { date };
        for (const v of selVars) {
          const arr = json.daily[v];
          if (arr) row[v] = arr[i];
        }
        return row;
      });

      setRaw(parsed);
      setChartData(parsed);
      setAnalyzed(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [lat, lon, startDate, endDate, selVars]);

  /* ── DERIVED STATS ── */
  const stats = useMemo(() => {
    if (!rawDaily?.length) return null;
    const d = rawDaily;
    const avg = (arr) => { const v = arr.filter(x => x != null); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : null; };
    const sum = (arr) => arr.filter(x => x != null).reduce((s,x)=>s+x,0);
    const max = (arr) => Math.max(...arr.filter(x => x != null));
    const min = (arr) => Math.min(...arr.filter(x => x != null));

    const tMax  = d.map(r => r.temperature_2m_max);
    const tMin  = d.map(r => r.temperature_2m_min);
    const rain  = d.map(r => r.precipitation_sum);
    const hum   = d.map(r => r.relative_humidity_2m_mean);
    const et0   = d.map(r => r.et0_fao_evapotranspiration);

    const frostDays = tMin.filter(t => t != null && t < 0).length;
    const hotDays   = tMax.filter(t => t != null && t > 35).length;
    const dryDays   = rain.filter(r => r != null && r < 1).length;
    const wetDays   = rain.filter(r => r != null && r >= 5).length;

    const gdd       = (selVars.has("temperature_2m_max") && selVars.has("temperature_2m_min"))
                      ? computeGDD(d) : null;
    const aridity   = (selVars.has("precipitation_sum") && selVars.has("et0_fao_evapotranspiration"))
                      ? computeAridity(d) : null;

    const aridLabel = aridity == null ? null
      : aridity < 0.2 ? "Hyper-arid 🏜️"
      : aridity < 0.5 ? "Arid ☀️"
      : aridity < 0.65 ? "Semi-arid 🌾"
      : aridity < 1.0  ? "Dry sub-humid 🌿"
      : "Humid 💧";

    const years = d.length / 365;
    const chillingDays = d.filter(r => {
      if (r.temperature_2m_max == null || r.temperature_2m_min == null) return false;
      const mean = (r.temperature_2m_max + r.temperature_2m_min) / 2;
      return mean >= 1 && mean <= 10;
    }).length;
    const annualChillingHours = Math.round((chillingDays / Math.max(years, 1)) * 8);
    const annualRain  = rain.some(v=>v)  ? sum(rain)  / Math.max(years,1) : null;
    const annualET0   = et0.some(v=>v)   ? sum(et0)   / Math.max(years,1) : null;
    const annualGDD   = gdd != null      ? gdd         / Math.max(years,1) : null;
    const annualFrost = frostDays / Math.max(years,1);
    const annualHot   = hotDays   / Math.max(years,1);

    return {
      avgTMax: tMax.some(v=>v) ? avg(tMax).toFixed(1) : null,
      avgTMin: tMin.some(v=>v) ? avg(tMin).toFixed(1) : null,
      totalRain: rain.some(v=>v) ? sum(rain).toFixed(0) : null,
      avgHum: hum.some(v=>v) ? avg(hum).toFixed(0) : null,
      totalET0: et0.some(v=>v) ? sum(et0).toFixed(0) : null,
      frostDays, hotDays, dryDays, wetDays,
      gdd: gdd?.toFixed(0),
      aridity: aridity?.toFixed(2), aridLabel,
      days: d.length, years: +years.toFixed(1),
      annualChillingHours,
      annualRain:  annualRain  != null ? +annualRain.toFixed(0)  : null,
      annualET0:   annualET0   != null ? +annualET0.toFixed(0)   : null,
      annualGDD:   annualGDD   != null ? +annualGDD.toFixed(0)   : null,
      annualFrost: Math.round(annualFrost),
      annualHot:   Math.round(annualHot),
    };
  }, [rawDaily, selVars]);

  /* ── CHART GROUPS ── */
  const chartGroups = useMemo(() => {
    const groups = {};
    for (const id of selVars) {
      const def = VAR_MAP[id];
      if (!def) continue;
      const g = def.group;
      if (!groups[g]) groups[g] = [];
      groups[g].push(id);
    }
    return groups;
  }, [selVars]);

  /* ── MONTHLY AGGREGATES ── */
  const monthlyData = useMemo(() => {
    if (!rawDaily?.length) return [];
    const months = {};
    for (const row of rawDaily) {
      const m = row.date.slice(0, 7);
      if (!months[m]) months[m] = { date: m, _cnt: 0, _rain: 0 };
      months[m]._cnt++;
      for (const [k, v] of Object.entries(row)) {
        if (k === "date" || v == null) continue;
        if (k === "precipitation_sum") { months[m]._rain += v; }
        else { months[m][k] = (months[m][k] ?? 0) + v; }
      }
    }
    return Object.values(months).map(m => {
      const out = { date: m.date };
      for (const k of Object.keys(m)) {
        if (k.startsWith("_") || k === "date") continue;
        out[k] = +(m[k] / m._cnt).toFixed(2);
      }
      if (m._rain !== undefined) out["precipitation_sum"] = +m._rain.toFixed(1);
      return out;
    });
  }, [rawDaily]);

  /* ─── RENDER ─────────────────────────────────────────────── */
  const groupIcons = { Temperature:"🌡️", Water:"💧", Atmosphere:"🌬️", Energy:"☀️", Soil:"🌱" };

  return (
    <div style={{
      minHeight: "100vh",
      background: `radial-gradient(ellipse at top left, ${T.forest}CC 0%, ${T.soil} 60%)`,
      fontFamily: FONT_BODY, color: T.cream, padding: "0 0 60px",
    }}>
      {/* HEADER */}
      <div style={{
        background: `linear-gradient(to right, ${T.soil}, ${T.forest})`,
        borderBottom: `2px solid ${T.straw}55`,
        padding: "28px 32px 20px",
      }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 30, color: T.straw, letterSpacing: -0.5 }}>
              🌾 AgroClimate Intelligence
            </div>
            <div style={{ color: T.mist, fontSize: 12, marginTop: 4, letterSpacing: 1 }}>
              WEATHER · SOIL · CROP RISK · AGRONOMY
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 980, margin: "0 auto", padding: "28px 20px" }}>

        {/* ── CONTROLS PANEL ── */}
        <div style={{
          background: `${T.forest}99`, border: `1px solid ${T.straw}44`,
          borderRadius: 14, padding: "24px 28px", marginBottom: 28,
          backdropFilter: "blur(8px)",
        }}>
          <SectionTitle icon="📍">Location & Date Range</SectionTitle>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 20 }}>
            <div style={{ flex: "2 1 200px" }}>
              <label style={{ fontSize: 11, color: T.mist, display: "block", marginBottom: 5 }}>SITE NAME (optional)</label>
              <input value={locName} onChange={e=>setLocName(e.target.value)}
                placeholder="e.g. North Field, Beni Mellal"
                style={inputStyle} />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label style={{ fontSize: 11, color: T.mist, display: "block", marginBottom: 5 }}>LATITUDE</label>
              <input value={lat} onChange={e=>setLat(e.target.value)} placeholder="33.06"
                style={inputStyle} />
            </div>
            <div style={{ flex: "1 1 120px" }}>
              <label style={{ fontSize: 11, color: T.mist, display: "block", marginBottom: 5 }}>LONGITUDE</label>
              <input value={lon} onChange={e=>setLon(e.target.value)} placeholder="-7.59"
                style={inputStyle} />
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
              <button onClick={() => { document.getElementById('favInput')?.focus(); setShowFavs(!showFavs); }}
                style={{
                  background: showFavs ? `${T.straw}33` : 'transparent',
                  border: `1px solid ${showFavs ? T.straw : T.mist}44`,
                  borderRadius: 6, padding: "8px 12px", color: showFavs ? T.straw : T.mist,
                  fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: "pointer",
                  alignSelf: "stretch",
                }}>
                {showFavs ? '✕ CLOSE' : '☆ FAVORITES'}
              </button>
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: 11, color: T.mist, display: "block", marginBottom: 5 }}>FROM</label>
              <input type="date" value={startDate} onChange={e=>setStart(e.target.value)}
                min="1940-01-01" max={formatDate(today)}
                style={inputStyle} />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label style={{ fontSize: 11, color: T.mist, display: "block", marginBottom: 5 }}>TO</label>
              <input type="date" value={endDate} onChange={e=>setEnd(e.target.value)}
                min="1940-01-01" max={formatDate(today)}
                style={inputStyle} />
            </div>
          </div>

          {/* QUICK DATE RANGES */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
            {[
              ["Last 30 days", 30], ["Last 90 days", 90], ["Last 6 months", 180],
              ["Last year", 365], ["Last 3 years", 1095], ["Last 5 years", 1825],
            ].map(([label, days]) => (
              <button key={label} onClick={() => {
                setStart(formatDate(addDays(today, -days)));
                setEnd(formatDate(addDays(today, -1)));
              }} style={quickBtnStyle}>{label}</button>
            ))}
          </div>

          {/* FAVORITES PANEL */}
          {showFavs && (
            <div style={{ marginBottom: 20, background: `${T.soil}CC`, border: `1px solid ${T.straw}44`, borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontSize: 12, color: T.straw, fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>⭐ SAVED LOCATIONS</span>
                <span style={{ fontSize: 10, color: T.mist }}>{favorites.length}/10</span>
              </div>
              {favorites.length === 0 && (
                <div style={{ fontSize: 11, color: T.mist, marginBottom: 8 }}>No saved locations yet. Click ☆ next to a location to save it.</div>
              )}
              {favorites.map((fav, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                  borderBottom: i < favorites.length-1 ? `1px solid ${T.forest}` : 'none',
                }}>
                  <span style={{ fontSize: 10, color: T.straw, fontWeight: 700, minWidth: 16 }}>{i+1}.</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: T.cream, cursor: 'pointer' }}
                      onClick={() => { setLat(fav.lat); setLon(fav.lon); setLocName(fav.name || ''); }}>{fav.name || 'Unnamed'}</div>
                    <div style={{ fontSize: 9, color: T.mist }}>{fav.lat}°N, {fav.lon}°E</div>
                  </div>
                  <button onClick={() => {
                    setFavorites(favorites.filter((_, fi) => fi !== i));
                  }} style={{ background: 'transparent', border: 'none', color: '#E88A6A', cursor: 'pointer', fontSize: 14, padding: '2px 6px' }}>✕</button>
                </div>
              ))}
              {favorites.length < 10 && (
                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <input id="favInput" placeholder="Save current location as…" style={{
                    ...inputStyle, fontSize: 11, padding: '6px 10px', flex: 1,
                  }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && e.target.value.trim()) {
                        const existing = favorites.find(f => f.lat === lat && f.lon === lon);
                        if (!existing && favorites.length < 10) {
                          setFavorites([...favorites, { name: e.target.value.trim(), lat, lon }]);
                        }
                        e.target.value = '';
                      }
                    }} />
                  <button onClick={() => {
                    const inp = document.getElementById('favInput');
                    if (inp && inp.value.trim() && !favorites.find(f => f.lat === lat && f.lon === lon) && favorites.length < 10) {
                      setFavorites([...favorites, { name: inp.value.trim(), lat, lon }]);
                      inp.value = '';
                    }
                  }} style={{
                    background: `${T.straw}22`, border: `1px solid ${T.straw}44`,
                    borderRadius: 6, padding: '6px 12px', color: T.straw, fontSize: 11,
                    fontFamily: "'DM Mono', monospace", cursor: 'pointer', whiteSpace: 'nowrap',
                  }}>SAVE</button>
                </div>
              )}
            </div>
          )}

          <SectionTitle icon="📊">Data Variables</SectionTitle>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {VARIABLES.map(v => (
              <button key={v.id} onClick={() => toggleVar(v.id)}
                style={{
                  ...tagStyle,
                  background: selVars.has(v.id) ? `${v.color}33` : "transparent",
                  border: `1px solid ${selVars.has(v.id) ? v.color : T.mist+"55"}`,
                  color: selVars.has(v.id) ? v.color : T.mist,
                }}>
                {groupIcons[v.group] ?? "📌"} {v.label} <span style={{ opacity: 0.6 }}>{v.unit}</span>
              </button>
            ))}
          </div>

          {/* FETCH BUTTON */}
          <div style={{ marginTop: 24, display: "flex", alignItems: "center", gap: 16 }}>
            <button onClick={fetchWeather} disabled={loading} style={{
              background: loading ? T.moss : `linear-gradient(135deg, ${T.ochre}, ${T.straw})`,
              color: T.soil, border: "none", borderRadius: 8,
              padding: "12px 32px", fontSize: 14, fontFamily: FONT_BODY,
              fontWeight: 700, cursor: loading ? "wait" : "pointer",
              letterSpacing: 1, textTransform: "uppercase",
              transition: "opacity .2s",
            }}>
              {loading ? "⏳ Fetching…" : "🔍 Analyze Location"}
            </button>
            {error && <div style={{ color: "#E88A6A", fontSize: 12 }}>⚠️ {error}</div>}
          </div>
        </div>

        {/* ── RESULTS ── */}
        {analyzed && stats && (
          <>
            {/* LOCATION BADGE */}
            <div style={{ marginBottom: 22, color: T.straw, fontFamily: FONT_DISPLAY, fontSize: 20 }}>
              📍 {locName || `${lat}°N, ${lon}°E`}
              <span style={{ fontSize: 13, color: T.mist, fontFamily: FONT_BODY, marginLeft: 10 }}>
                {startDate} → {endDate} · {stats.days} days
              </span>
            </div>

            {/* SUMMARY CARDS */}
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 28 }}>
              {stats.avgTMax && <StatCard label="Avg Max Temp" value={stats.avgTMax} unit="°C" sub={stats.hotDays > 0 ? `${stats.hotDays} days >35°C` : "No extreme heat"} accent={T.ochre} />}
              {stats.avgTMin && <StatCard label="Avg Min Temp" value={stats.avgTMin} unit="°C" sub={`${stats.frostDays} frost days (<0°C)`} accent={T.frost} />}
              {stats.totalRain && <StatCard label="Total Rainfall" value={stats.totalRain} unit="mm" sub={`${stats.wetDays} wet days (≥5mm)`} accent={T.rain} />}
              {stats.avgHum && <StatCard label="Avg Humidity" value={stats.avgHum} unit="%" accent={T.sky} />}
              {stats.totalET0 && <StatCard label="Total ET₀" value={stats.totalET0} unit="mm" sub="Crop water demand" accent={T.moss} />}
            </div>

            {/* AGRI INTELLIGENCE CARDS */}
            <div style={{
              background: `${T.forest}88`, border: `1px solid ${T.straw}33`,
              borderRadius: 14, padding: "20px 24px", marginBottom: 28,
            }}>
              <SectionTitle icon="🌱">Agricultural Intelligence</SectionTitle>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>

                {stats.gdd && (
                  <IntelCard
                    icon="🌡️" title="Growing Degree Days"
                    value={`${stats.gdd} GDD`}
                    desc={`Base 10°C — ${
                      +stats.gdd < 500 ? "Low heat accumulation. Cool-season crops (barley, peas, lettuce) preferred." :
                      +stats.gdd < 1200 ? "Moderate. Suitable for wheat, sunflower, potato." :
                      +stats.gdd < 2000 ? "Good heat. Maize, sorghum, tomato thrive." :
                      "High heat accumulation. Excellent for citrus, cotton, date palm."
                    }`}
                  />
                )}

                {stats.aridity && (
                  <IntelCard
                    icon="💧" title="Aridity Index"
                    value={stats.aridLabel}
                    desc={`P/ET₀ = ${stats.aridity}. ${
                      +stats.aridity < 0.5 ? "Irrigation is ESSENTIAL. Plan for water infrastructure." :
                      +stats.aridity < 0.65 ? "Supplemental irrigation strongly recommended." :
                      "Rainfed agriculture may be viable in good seasons."
                    }`}
                    accent={T.rain}
                  />
                )}

                {stats.frostDays != null && (
                  <IntelCard
                    icon="❄️" title="Frost Risk"
                    value={`${stats.frostDays} frost days`}
                    desc={
                      stats.frostDays === 0 ? "No frost recorded. Frost-sensitive crops (citrus, avocado) safe." :
                      stats.frostDays < 10 ? "Occasional frost. Protect tender crops Nov–Feb." :
                      stats.frostDays < 30 ? "Moderate frost risk. Avoid frost-sensitive crops or use protection." :
                      "High frost incidence. Cold-hardy varieties essential."
                    }
                    accent={T.frost}
                  />
                )}

                {stats.hotDays != null && (
                  <IntelCard
                    icon="🔥" title="Heat Stress Risk"
                    value={`${stats.hotDays} days >35°C`}
                    desc={
                      stats.hotDays === 0 ? "No dangerous heat stress recorded in this period." :
                      stats.hotDays < 15 ? "Low heat stress. Monitor pollination windows." :
                      stats.hotDays < 45 ? "Moderate stress. Schedule irrigation during heat peaks." :
                      "Severe heat stress. Shade nets and drought-tolerant varieties advised."
                    }
                    accent={T.ochre}
                  />
                )}

                {stats.dryDays != null && (
                  <IntelCard
                    icon="🏜️" title="Dry Days"
                    value={`${stats.dryDays} / ${stats.days}`}
                    desc={`${((stats.dryDays/stats.days)*100).toFixed(0)}% of days had <1mm rain. ${
                      stats.dryDays/stats.days > 0.85 ? "Predominantly dry climate — full irrigation system required." :
                      stats.dryDays/stats.days > 0.65 ? "Mostly dry. Drip irrigation or water-efficient systems recommended." :
                      "Regular rainfall pattern supports some rainfed production."
                    }`}
                    accent={T.straw}
                  />
                )}

              </div>
            </div>

            {/* DAILY CHARTS */}
            <div style={{
              background: `${T.forest}88`, border: `1px solid ${T.straw}33`,
              borderRadius: 14, padding: "20px 24px", marginBottom: 28,
            }}>
              <SectionTitle icon="📈">Daily Data Charts</SectionTitle>
              {Object.entries(chartGroups).map(([group, ids]) => (
                <ChartBlock
                  key={group}
                  title={`${groupIcons[group] ?? "📌"} ${group}`}
                  data={chartData}
                  varIds={ids}
                />
              ))}
            </div>

            {/* MONTHLY AGGREGATES */}
            {monthlyData.length > 2 && (
              <div style={{
                background: `${T.forest}88`, border: `1px solid ${T.straw}33`,
                borderRadius: 14, padding: "20px 24px", marginBottom: 28,
              }}>
                <SectionTitle icon="📅">Monthly Averages</SectionTitle>
                {Object.entries(chartGroups).map(([group, ids]) => (
                  <ChartBlock
                    key={group}
                    title={`Monthly · ${groupIcons[group] ?? ""} ${group}`}
                    data={monthlyData}
                    varIds={ids}
                  />
                ))}
              </div>
            )}

            {/* CROP SUITABILITY TABLE */}
            <CropSuitability stats={stats} />
          </>
        )}

        {!analyzed && !loading && (
          <div style={{
            textAlign: "center", padding: "60px 20px",
            color: T.mist, fontFamily: FONT_DISPLAY, fontSize: 20,
            opacity: 0.6,
          }}>
            Enter coordinates, select variables & date range,<br />then click <span style={{color:T.straw}}>Analyze Location</span>.
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── INTEL CARD ─────────────────────────────────────────────── */
const IntelCard = ({ icon, title, value, desc, accent = T.straw }) => (
  <div style={{
    flex: "1 1 220px", background: `${T.soil}CC`,
    border: `1px solid ${accent}33`, borderRadius: 10, padding: "16px 18px",
  }}>
    <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
    <div style={{ color: T.mist, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 }}>{title}</div>
    <div style={{ color: accent, fontSize: 18, fontFamily: FONT_DISPLAY, margin: "6px 0" }}>{value}</div>
    <div style={{ color: T.fog, fontSize: 11, lineHeight: 1.6 }}>{desc}</div>
  </div>
);

/* ─── CROP DATABASE ──────────────────────────────────────────── */
const CROPS = [
  // ── Tree Fruits ──────────────────────────────────────────────
  {
    id:"olive", emoji:"🫒", name:"Olive", category:"Tree Fruit",
    gddOpt:[2000,3500], gddAbs:[1500,5000],
    frostTol:"moderate", maxAnnualFrost:60, frostKillBelow:-6,
    heatOpt:30, heatAbs:65,
    waterNeed:"low", minAridityRainfed:0.25, minAridityIrr:0.0,
    chillingNeeded:300, waterPerHa:4500,
    notes:"Extremely drought-hardy once established. Requires 2 months below 10°C for flower bud differentiation. High temps + dry winds cause poor fruit set. Thrives in Mediterranean climates with mild, rainy winters and hot, dry summers.",
    keyFacts:["Perennial — 3–5 yr to first harvest","Dormancy period needs ~2 months below 10°C","Oil yield drops sharply above 38°C during ripening"],
  },
  {
    id:"citrus", emoji:"🍊", name:"Citrus", category:"Tree Fruit",
    gddOpt:[2000,4000], gddAbs:[1500,5500],
    frostTol:"none", maxAnnualFrost:3, frostKillBelow:-3,
    heatOpt:30, heatAbs:65,
    waterNeed:"moderate", minAridityRainfed:0.5, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:8000,
    notes:"Frost is the main limiting factor. Needs winter rest period (low temps or water deficit). Optimum mean daily temp 18–25°C. Drip irrigation essential in dry climates.",
    keyFacts:["Sensitive to frost below –3°C (flowers/fruit)","Requires 7000–9000 m³/ha/yr water","Best varieties: Valencia, Navel, Clementine"],
  },
  {
    id:"date_palm", emoji:"🌴", name:"Date Palm", category:"Tree Fruit",
    gddOpt:[3000,6000], gddAbs:[2500,9000],
    frostTol:"light", maxAnnualFrost:10, frostKillBelow:-6,
    heatOpt:100, heatAbs:160,
    waterNeed:"high", minAridityRainfed:0.1, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:15000,
    notes:"Loves extreme heat and dry air for ripening. Tolerates mild frost to –6°C during dormancy. High humidity during ripening causes fruit rot. Deep-rooted but heavy water consumer — 12,000–18,000 m³/ha/yr.",
    keyFacts:["Humidity during ripening causes fruit rot and disease","Needs 100+ days above 38°C for premium Medjool","Tolerates saline soils better than most fruit trees","Requires 12,000–18,000 m³/ha/yr — heavy irrigator"],
  },
  {
    id:"peach", emoji:"🍑", name:"Peach (Low-Chill)", category:"Stone Fruit",
    gddOpt:[900,2500], gddAbs:[700,3200],
    frostTol:"moderate", maxAnnualFrost:40, frostKillBelow:-20,
    heatOpt:35, heatAbs:65,
    waterNeed:"moderate", minAridityRainfed:0.5, minAridityIrr:0.0,
    chillingNeeded:200, waterPerHa:6000,
    notes:"Low-chill peach varieties bred for warm climates (e.g. Flordaprince, TropicBeauty, FlordaGrande). Perform well in environments with 900–2500 GDD (base 10°C) with irrigation. Require minimal chilling (100–400h) but heat stress above 35°C at flowering reduces fruit set. Widely grown in North Africa, southern Spain, and California's Central Valley. Elevation helps — cooler nights at 1,200m extend chilling hours.",
    keyFacts:["Low-chill varieties need only 100–400 chilling hrs (below 7°C)","High-elevation semi-arid climates (1,000–1,500m) provide ideal chilling + heat balance","Irrigation essential in hyper-arid conditions (130mm vs 600mm need)","Spring frost at –2°C during flowering destroys crop — monitor microsite","Early harvest = premium market window for export"],
  },
  {
    id:"peach_temp", emoji:"🍑", name:"Peach (Temperate)", category:"Stone Fruit",
    gddOpt:[900,1400], gddAbs:[700,2000],
    frostTol:"moderate", maxAnnualFrost:40, frostKillBelow:-20,
    heatOpt:10, heatAbs:30,
    waterNeed:"moderate", minAridityRainfed:0.5, minAridityIrr:0.0,
    chillingNeeded:700, waterPerHa:6000,
    notes:"Traditional temperate peach varieties. Require substantial chilling for proper bud break (700–1000h). Heat stress above 30°C during fruit development reduces quality. Best suited to continental and high-altitude climates with cold winters.",
    keyFacts:["Needs 700–1000 chilling hrs (below 7°C)","Spring frost at –2°C destroys open flowers","Best for temperate/mountain regions, not warm lowlands"],
  },
  {
    id:"plum", emoji:"🍑", name:"Plum", category:"Stone Fruit",
    gddOpt:[800,1300], gddAbs:[600,2000],
    frostTol:"moderate", maxAnnualFrost:45, frostKillBelow:-25,
    heatOpt:10, heatAbs:30,
    waterNeed:"moderate", minAridityRainfed:0.5, minAridityIrr:0.0,
    chillingNeeded:800, waterPerHa:5500,
    notes:"Similar to peach in chill requirements. Japanese varieties (e.g. Satsuma) are more heat tolerant than European types (e.g. Stanley, Mirabelle). Spring frost at flowering is a key risk.",
    keyFacts:["Needs 600–1200 chilling hrs depending on variety","More adaptable than peach to heavier soils","Japanese plums tolerate more heat than European","Spring frost at –2°C during flowering destroys crop"],
  },
  {
    id:"pomegranate", emoji:"🍎", name:"Pomegranate", category:"Tree Fruit",
    gddOpt:[1800,3200], gddAbs:[1200,4500],
    frostTol:"light", maxAnnualFrost:20, frostKillBelow:-10,
    heatOpt:50, heatAbs:90,
    waterNeed:"low", minAridityRainfed:0.3, minAridityIrr:0.0,
    chillingNeeded:150, waterPerHa:5000,
    notes:"Remarkably drought-tolerant once established. Needs hot dry summers for fruit quality and sweetness. Tolerates mild frost to –10°C during dormancy. High humidity near harvest causes fruit cracking.",
    keyFacts:["Ideal for semi-arid Mediterranean climates","High humidity at harvest causes cracking — avoid coastal fog zones","Wonderful variety dominates commercial production","100–200 chilling hours below 7°C needed for reliable bud break"],
  },
  {
    id:"persimmon", emoji:"🫐", name:"Persimmon (Kaki)", category:"Tree Fruit",
    gddOpt:[1500,2800], gddAbs:[1100,3500],
    frostTol:"moderate", maxAnnualFrost:35, frostKillBelow:-15,
    heatOpt:30, heatAbs:55,
    waterNeed:"moderate", minAridityRainfed:0.45, minAridityIrr:0.0,
    chillingNeeded:300, waterPerHa:5500,
    notes:"Tolerates a range of conditions but prefers moderate heat. Ripe fruit benefits from frost exposure for astringency reduction in some varieties. Thrives in warm temperate to subtropical climates with distinct seasons.",
    keyFacts:["Non-astringent types (Fuyu) more commercially flexible","Good alternative to stone fruits in warm, dry areas","Deep-rooted; moderately drought tolerant","Needs 200–500 chilling hours depending on cultivar"],
  },

  // ── Vegetables ───────────────────────────────────────────────
  {
    id:"tomato", emoji:"🍅", name:"Tomato", category:"Vegetable",
    gddOpt:[1100,1800], gddAbs:[800,2200],
    frostTol:"none", maxAnnualFrost:0, frostKillBelow:0,
    heatOpt:15, heatAbs:35,
    waterNeed:"moderate", minAridityRainfed:0.55, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:5000,
    notes:"Optimum mean daily temp 18–25°C. Pollen sterility above 35°C causes poor fruit set. Night temps above 20°C cause excessive vegetative growth and poor fruit set. Dry climates preferred for disease control.",
    keyFacts:["Heat stress at flowering (>35°C) → blossom drop","Tunnel/shade production extends season","Best yield at night temps 15–18°C","Temperatures above 25°C + humidity → reduced yield"],
  },
  {
    id:"potato", emoji:"🥔", name:"Potato", category:"Vegetable",
    gddOpt:[700,1400], gddAbs:[500,1800],
    frostTol:"none", maxAnnualFrost:0, frostKillBelow:-2,
    heatOpt:5, heatAbs:20,
    waterNeed:"moderate", minAridityRainfed:0.5, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:5000,
    notes:"Optimum mean daily temp 18–20°C. Tuber initiation requires night temps below 15°C. Tuber growth sharply inhibited above 30°C soil temp. Best grown as autumn–winter crop in warm climates.",
    keyFacts:["High heat (>30°C) severely reduces tuber yield — cool season crop","Autumn/winter planting ideal in hot climates","Consistent irrigation critical during tuber bulking","Optimum soil temp for tuber growth: 15–18°C"],
  },
  {
    id:"watermelon", emoji:"🍉", name:"Watermelon", category:"Vegetable",
    gddOpt:[1200,2000], gddAbs:[900,2500],
    frostTol:"none", maxAnnualFrost:0, frostKillBelow:0,
    heatOpt:30, heatAbs:55,
    waterNeed:"high", minAridityRainfed:0.55, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:6000,
    notes:"Prefers hot, dry climate with mean daily temps 22–30°C. Max for growth ~35°C. Very sensitive to frost. Excellent sugar content in arid climates with irrigation. 80–110 day growing period.",
    keyFacts:["Dry air during ripening = high Brix (sweetness)","Needs 80–110 warm days after planting","Drip irrigation keeps foliage dry, reducing disease","Optimum soil temp for roots: 20–35°C"],
  },
  {
    id:"carrot", emoji:"🥕", name:"Carrot", category:"Vegetable",
    gddOpt:[700,1200], gddAbs:[500,1600],
    frostTol:"hardy", maxAnnualFrost:60, frostKillBelow:-8,
    heatOpt:8, heatAbs:20,
    waterNeed:"moderate", minAridityRainfed:0.45, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:4500,
    notes:"Cool-season crop. Optimum mean daily temp 15–20°C. Sandy, well-drained soil essential. Bolts (flowers prematurely) in hot weather above 28°C causing forking and off-flavor.",
    keyFacts:["Heat above 28°C causes forking and off-flavor","Autumn/winter crop in hot climates — summer not viable","High-value export crop with good storage"],
  },
  {
    id:"onion", emoji:"🧅", name:"Onion", category:"Vegetable",
    gddOpt:[700,1100], gddAbs:[500,1500],
    frostTol:"moderate", maxAnnualFrost:40, frostKillBelow:-6,
    heatOpt:10, heatAbs:25,
    waterNeed:"moderate", minAridityRainfed:0.45, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:4000,
    notes:"Day-length sensitive — choose short-day varieties for latitudes below 35°. Stop irrigation 2–3 weeks before harvest for curing. Cool-season crop; optimum 15–20°C.",
    keyFacts:["Short-day vs long-day variety choice is critical","Bulbing triggered by photoperiod, not just heat","High disease risk in humid conditions","Stop irrigation 2–3 weeks before harvest for proper curing"],
  },

  // ── Field Crops ──────────────────────────────────────────────
  {
    id:"wheat", emoji:"🌾", name:"Wheat (Winter)", category:"Field Crop",
    gddOpt:[1200,2000], gddAbs:[800,2500],
    frostTol:"hardy", maxAnnualFrost:90, frostKillBelow:-20,
    heatOpt:15, heatAbs:35,
    waterNeed:"low", minAridityRainfed:0.3, minAridityIrr:0.0,
    chillingNeeded:400, waterPerHa:3500,
    notes:"The backbone of dryland farming in semi-arid regions. Vernalization (cold) required for grain set. Optimum mean daily temp 15–20°C. Dry warm ripening above 18°C preferred. 180–250 days to mature.",
    keyFacts:["Needs 400–600 chilling hrs for proper vernalization","Heat during grain fill (>30°C) reduces protein & yield","Most water-efficient staple grain crop","Mean daily temp below 10–12°C makes wheat a hazardous crop"],
  },
  {
    id:"maize", emoji:"🌽", name:"Maize (Corn)", category:"Field Crop",
    gddOpt:[1800,3000], gddAbs:[1400,3700],
    frostTol:"none", maxAnnualFrost:0, frostKillBelow:0,
    heatOpt:35, heatAbs:70,
    waterNeed:"high", minAridityRainfed:0.6, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:7000,
    notes:"High-yield but water-demanding. Critical water need at silking/tasseling stage. Poor set above 36°C. Medium-season varieties need 2500–3000 GDD (base 10°C). Tolerates hot/dry with sufficient water up to 45°C.",
    keyFacts:["Water stress at silking = catastrophic yield loss","Needs 500–800 mm evenly distributed","Medium varieties need 2500–3000 GDD (base 10°C)","Early: 1800 GDD, medium: 2500–3000, late: 3700+ GDD"],
  },
  {
    id:"sunflower", emoji:"🌻", name:"Sunflower", category:"Field Crop",
    gddOpt:[900,1800], gddAbs:[700,2400],
    frostTol:"light", maxAnnualFrost:10, frostKillBelow:-3,
    heatOpt:20, heatAbs:45,
    waterNeed:"low", minAridityRainfed:0.3, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:4000,
    notes:"Drought-tolerant deep-rooted crop (2–3m taproot). Good cash crop for semi-arid areas. Avoid humid conditions (sclerotinia risk). Mean daily temp optimum 18–25°C. 70–200 day growing period.",
    keyFacts:["Deep taproot accesses subsoil moisture at 2–3m","Low input, high drought tolerance","Oil vs confectionery types have different GDD needs","Susceptible to frost — plant after last frost date"],
  },
  {
    id:"chickpea", emoji:"🫘", name:"Chickpea", category:"Field Crop",
    gddOpt:[600,1400], gddAbs:[400,1800],
    frostTol:"moderate", maxAnnualFrost:30, frostKillBelow:-8,
    heatOpt:10, heatAbs:25,
    waterNeed:"low", minAridityRainfed:0.2, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:2500,
    notes:"Most drought-tolerant grain legume. Fixes nitrogen. Cool-season crop — optimum 15–20°C. Heat stress above 32°C during flowering causes pod abortion. Ideal for rotation with cereals in semi-arid regions.",
    keyFacts:["Excellent water use efficiency — most drought-tolerant legume","Nitrogen-fixing: reduces fertilizer costs by 50–80 kg N/ha","Susceptible to botrytis/ascochyta in humid conditions","Heat stress >32°C at flowering → pod abortion"],
  },

  // ── Forage ───────────────────────────────────────────────────
  {
    id:"alfalfa", emoji:"🌿", name:"Alfalfa (Lucerne)", category:"Forage",
    gddOpt:[700,3500], gddAbs:[400,5000],
    frostTol:"hardy", maxAnnualFrost:90, frostKillBelow:-25,
    heatOpt:5, heatAbs:20,
    waterNeed:"very_high", minAridityRainfed:0.7, minAridityIrr:0.0,
    chillingNeeded:0, waterPerHa:14000,
    notes:"Highest protein forage (18–22% CP). Perennial — 2–12 cuts/year depending on climate. Growth decreases sharply above 30°C — goes dormant in extreme heat. Optimum 25°C. Extremely water-hungry but very productive with irrigation.",
    keyFacts:["Needs 12,000–18,000 m³/ha/yr — plan water supply carefully","Deep-rooted (3–6m) once established","Best forage protein — 18–22% crude protein","2–12 cuts/yr depending on climate; goes dormant in extreme heat","Growth drops sharply above 30°C — not heat-loving"],
  },
];

const CATEGORIES = ["Tree Fruit","Stone Fruit","Vegetable","Field Crop","Forage"];
const CAT_ICONS  = { "Tree Fruit":"🌳", "Stone Fruit":"🍑", "Vegetable":"🥬", "Field Crop":"🌾", "Forage":"🌿" };

/* ─── SCORING ENGINE ─────────────────────────────────────────── */
function scoreCrop(crop, stats, irrigation) {
  const gdd   = stats.annualGDD   ?? 0;
  const frost = stats.annualFrost ?? 0;
  const hot   = stats.annualHot   ?? 0;
  const chill = stats.annualChillingHours ?? 0;
  const aridity = stats.aridity != null ? +stats.aridity : null;
  const rain  = stats.annualRain ?? 0;
  const et0   = stats.annualET0  ?? 0;

  const factors = {};

  /* 1 ── GDD (0–30 pts) */
  const [gMin, gMax] = crop.gddOpt;
  const [gAbsMin, gAbsMax] = crop.gddAbs;
  if (gdd >= gMin && gdd <= gMax) {
    factors.gdd = { score: 30, label: "Optimal heat accumulation" };
  } else if (gdd >= gAbsMin && gdd <= gAbsMax) {
    const dist = gdd < gMin
      ? (gMin - gdd) / (gMin - gAbsMin)
      : (gdd - gMax) / (gAbsMax - gMax);
    factors.gdd = { score: Math.round(30 * (1 - dist * 0.7)), label: gdd < gMin ? "Below optimal GDD" : "Above optimal GDD" };
  } else {
    factors.gdd = { score: 0, label: "GDD outside viable range" };
  }

  /* 2 ── Frost (0–25 pts) */
  const frostKill = crop.frostKillBelow;
  const tmin = stats.avgTMin != null ? +stats.avgTMin : 5;
  const absoluteFrostRisk = tmin < frostKill;
  if (absoluteFrostRisk) {
    factors.frost = { score: 0, label: `Avg min temp risks below ${frostKill}°C kill threshold` };
  } else if (crop.frostTol === "none") {
    if (frost === 0) factors.frost = { score: 25, label: "No frost — ideal" };
    else if (frost <= 3) factors.frost = { score: 15, label: "Rare frost events — manageable" };
    else if (frost <= 10) factors.frost = { score: 5, label: "Frost risk — protection needed" };
    else factors.frost = { score: 0, label: "Too many frost days for this crop" };
  } else if (crop.frostTol === "light") {
    if (frost <= crop.maxAnnualFrost) factors.frost = { score: 22, label: "Frost within tolerance" };
    else factors.frost = { score: Math.max(0, 22 - (frost - crop.maxAnnualFrost)), label: "Frost days exceed tolerance" };
  } else if (crop.frostTol === "moderate") {
    if (frost <= crop.maxAnnualFrost) factors.frost = { score: 25, label: "Frost well within tolerance" };
    else factors.frost = { score: Math.max(5, 25 - Math.round((frost - crop.maxAnnualFrost) * 0.3)), label: "High frost but crop is tolerant" };
  } else { // hardy
    factors.frost = { score: 25, label: "Cold-hardy crop — frost not limiting" };
  }

  /* 3 ── Heat Stress (0–20 pts) */
  if (hot <= crop.heatOpt) {
    factors.heat = { score: 20, label: "Heat stress within tolerance" };
  } else if (hot <= crop.heatAbs) {
    const ratio = (hot - crop.heatOpt) / (crop.heatAbs - crop.heatOpt);
    factors.heat = { score: Math.round(20 * (1 - ratio * 0.8)), label: `${hot} hot days — moderate stress` };
  } else {
    factors.heat = { score: 0, label: `Excessive heat stress (${hot} days >35°C)` };
  }

  /* 4 ── Chilling Hours (0–15 pts, only for crops that need it) */
  if (crop.chillingNeeded > 0) {
    const ratio = Math.min(1, chill / crop.chillingNeeded);
    if (ratio >= 1) {
      factors.chill = { score: 15, label: `${chill}h chilling — sufficient` };
    } else if (ratio >= 0.6) {
      factors.chill = { score: Math.round(15 * ratio * 0.8), label: `${chill}h chilling — marginal (need ${crop.chillingNeeded}h)` };
    } else {
      factors.chill = { score: Math.round(15 * ratio * 0.4), label: `Only ${chill}h chilling — insufficient (need ${crop.chillingNeeded}h)` };
    }
  } else {
    factors.chill = { score: 15, label: "No chilling requirement" };
  }

  /* 5 ── Water Balance (0–10 pts, IRRIGATION-SENSITIVE) */
  if (irrigation) {
    // Irrigation ON — water fully available; score based on water cost (high need = slightly lower for risk)
    const costPenalty = crop.waterNeed === "very_high" ? 2 : crop.waterNeed === "high" ? 1 : 0;
    factors.water = { score: 10 - costPenalty, label: irrigation ? "Irrigation covers water needs" : "" };
  } else {
    // Irrigation OFF — score based on aridity vs crop water need
    if (aridity == null) {
      factors.water = { score: 5, label: "No water data — assuming partial suitability" };
    } else {
      const minA = crop.minAridityRainfed;
      if (aridity >= minA) {
        factors.water = { score: 10, label: `Rainfall sufficient (AI=${aridity} ≥ ${minA})` };
      } else if (aridity >= minA * 0.6) {
        factors.water = { score: Math.round(10 * (aridity / minA)), label: `Marginal rainfall (AI=${aridity}, need ${minA})` };
      } else {
        factors.water = { score: 0, label: `Insufficient rainfall — irrigation mandatory` };
      }
    }
  }

  const total = Object.values(factors).reduce((s, f) => s + f.score, 0);
  const max   = 100; // 30+25+20+15+10
  let pct   = Math.round((total / max) * 100);

  /* ── Viability penalty ── */
  // If a critical factor is severely below its max, tank the score hard.
  // This prevents a crop from scoring decently while lacking something essential.
  const factorMaxes = { gdd:30, frost:25, heat:20, chill:15, water:10 };
  const penalties = {
    gdd:    { threshold: 0.20, multiplier: 0.30 },
    frost:  { threshold: 0.20, multiplier: 0.40 },
    heat:   { threshold: 0.20, multiplier: 0.40 },
    chill:  { threshold: 0.20, multiplier: 0.50 },
    water:  { threshold: 0.20, multiplier: 0.15 }, // water failure is most punishing
  };
  let viability = 1.0;
  let showstoppers = [];
  for (const [key, cfg] of Object.entries(penalties)) {
    if (!factors[key]) continue;
    const fMax = factorMaxes[key];
    const ratio = factors[key].score / fMax;
    if (ratio < cfg.threshold) {
      viability *= cfg.multiplier;
      showstoppers.push(factors[key].label);
    }
  }
  if (viability < 1.0) {
    pct = Math.round(pct * viability);
  }

  // Compute limiting factors
  const limits = Object.entries(factors)
    .filter(([, f]) => f.score < (f.label.includes("Optimal") || f.label.includes("No ") || f.label.includes("sufficient") || f.label.includes("Irrigation") ? 999 : 0))
    .sort((a, b) => a[1].score - b[1].score)
    .slice(0, 2)
    .map(([, f]) => f.label);

  return { pct, factors, limits, showstoppers, viability };
}

/* ─── FACTOR BAR ─────────────────────────────────────────────── */
const FactorBar = ({ label, score, max, color }) => (
  <div style={{ marginBottom: 5 }}>
    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
      <span style={{ fontSize: 10, color: T.mist }}>{label}</span>
      <span style={{ fontSize: 10, color, fontWeight: 700 }}>{score}/{max}</span>
    </div>
    <div style={{ height: 5, background: `${T.soil}`, borderRadius: 3, overflow: "hidden" }}>
      <div style={{
        width: `${(score / max) * 100}%`, height: "100%",
        background: color, borderRadius: 3, transition: "width 0.8s ease",
      }} />
    </div>
  </div>
);

/* ─── CROP CARD ──────────────────────────────────────────────── */
const CropCard = ({ crop, result, expanded, onToggle }) => {
  const { pct, factors, showstoppers, viability } = result;
  const penalized = viability != null && viability < 1;
  const col = pct >= 70 ? T.leaf : pct >= 45 ? T.straw : pct >= 25 ? T.ochre : "#B04030";
  const verdict = pct >= 75 ? "✅ Well Suited"
    : pct >= 55 ? "🟡 Suitable"
    : pct >= 35 ? "⚠️ Marginal"
    : "❌ Not Recommended";

  return (
    <div style={{
      background: expanded ? `${T.soil}EE` : `${T.soil}88`,
      border: `1px solid ${col}44`,
      borderRadius: 10, overflow: "hidden",
      transition: "all 0.2s",
    }}>
      {/* ROW */}
      <div onClick={onToggle} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "12px 16px", cursor: "pointer",
      }}>
        <div style={{ fontSize: 20, width: 28, textAlign: "center", flexShrink: 0 }}>{crop.emoji}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: T.cream, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {crop.name}
          </div>
          <div style={{ fontSize: 10, color: T.mist }}>{crop.category}</div>
        </div>
        {/* Score bar */}
        <div style={{ flex: 2, minWidth: 80 }}>
          <div style={{ height: 8, background: `${T.forest}`, borderRadius: 4, overflow: "hidden", position: 'relative' }}>
            <div style={{
              width: `${pct}%`, height: "100%",
              background: `linear-gradient(to right, ${col}99, ${col})`,
              borderRadius: 4, transition: "width 0.8s ease",
            }} />
            {penalized && <div style={{
              position: 'absolute', right: 2, top: -1, fontSize: 9, color: '#E88A6A',
              fontWeight: 700, lineHeight: 1,
            }}>⚠️</div>}
          </div>
        </div>
        <div style={{ width: 36, textAlign: "right", fontSize: 13, color: col, fontWeight: 700, flexShrink: 0 }}>{pct}%</div>
        <div style={{ width: 110, fontSize: 10, color: col, textAlign: "right", flexShrink: 0 }}>{verdict}</div>
        <div style={{ color: T.mist, fontSize: 10, flexShrink: 0 }}>{expanded ? "▲" : "▼"}</div>
      </div>

      {/* EXPANDED DETAIL */}
      {expanded && (
        <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${T.forest}` }}>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", paddingTop: 14 }}>
            {/* Factor breakdown */}
            <div style={{ flex: "1 1 200px" }}>
              <div style={{ fontSize: 11, color: T.straw, marginBottom: 8, fontWeight: 700 }}>SCORE BREAKDOWN</div>
              <FactorBar label="GDD / Heat Accumulation" score={factors.gdd.score} max={30}
                color={factors.gdd.score >= 24 ? T.leaf : factors.gdd.score >= 15 ? T.straw : T.ochre} />
              <FactorBar label="Frost Compatibility" score={factors.frost.score} max={25}
                color={factors.frost.score >= 20 ? T.leaf : factors.frost.score >= 10 ? T.straw : T.ochre} />
              <FactorBar label="Heat Stress Tolerance" score={factors.heat.score} max={20}
                color={factors.heat.score >= 16 ? T.leaf : factors.heat.score >= 8 ? T.straw : T.ochre} />
              <FactorBar label="Chilling Hours" score={factors.chill.score} max={15}
                color={factors.chill.score >= 12 ? T.leaf : factors.chill.score >= 7 ? T.straw : T.ochre} />
              <FactorBar label="Water Balance" score={factors.water.score} max={10}
                color={factors.water.score >= 8 ? T.leaf : factors.water.score >= 4 ? T.straw : T.ochre} />
            </div>

            {/* Factor notes */}
            <div style={{ flex: "1 1 200px" }}>
              {/* Showstopper warning */}
              {penalized && showstoppers?.length > 0 && (
                <div style={{
                  background: '#E88A6A15', border: '1px solid #E88A6A44',
                  borderRadius: 6, padding: '8px 10px', marginBottom: 10,
                }}>
                  <div style={{ fontSize: 10, color: '#E88A6A', fontWeight: 700, marginBottom: 4 }}>⛔ SHOWSTOPPER</div>
                  {showstoppers.map((s, i) => (
                    <div key={i} style={{ fontSize: 10, color: T.fog, lineHeight: 1.5, marginBottom: 2 }}>• {s}</div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 11, color: T.straw, marginBottom: 8, fontWeight: 700 }}>FACTOR NOTES</div>
              {[
                { icon: "🌡️", text: factors.gdd.label },
                { icon: "❄️", text: factors.frost.label },
                { icon: "🔥", text: factors.heat.label },
                { icon: "🌙", text: factors.chill.label },
                { icon: "💧", text: factors.water.label },
              ].map(({ icon, text }) => (
                <div key={icon} style={{ display: "flex", gap: 6, marginBottom: 5 }}>
                  <span style={{ fontSize: 11, flexShrink: 0 }}>{icon}</span>
                  <span style={{ fontSize: 10, color: T.fog, lineHeight: 1.4 }}>{text}</span>
                </div>
              ))}
            </div>

            {/* Agro notes */}
            <div style={{ flex: "2 1 260px" }}>
              <div style={{ fontSize: 11, color: T.straw, marginBottom: 8, fontWeight: 700 }}>AGRONOMIC NOTES</div>
              <div style={{ fontSize: 11, color: T.fog, lineHeight: 1.7, marginBottom: 10 }}>{crop.notes}</div>
              <div style={{ fontSize: 11, color: T.straw, marginBottom: 6, fontWeight: 700 }}>KEY FACTS</div>
              {crop.keyFacts.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                  <span style={{ color: T.straw, flexShrink: 0 }}>›</span>
                  <span style={{ fontSize: 10, color: T.fog, lineHeight: 1.5 }}>{f}</span>
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: 10, color: T.sky }}>
                💧 Est. water need: ~{(crop.waterPerHa / 10).toFixed(0)} mm/yr · {crop.waterPerHa.toLocaleString()} m³/ha/yr
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── CROP SUITABILITY ───────────────────────────────────────── */
const CropSuitability = ({ stats }) => {
  const [irrigation, setIrrigation] = useState(true);
  const [activeCat, setActiveCat]   = useState("All");
  const [expandedId, setExpandedId] = useState(null);
  const [sortBy, setSortBy]         = useState("score");

  if (!stats?.annualGDD) return null;

  const results = CROPS.map(c => ({ crop: c, result: scoreCrop(c, stats, irrigation) }));

  const filtered = (() => {
    let list = activeCat === "All" ? results : results.filter(r => r.crop.category === activeCat);
    if (sortBy === "score") list = [...list].sort((a,b) => b.result.pct - a.result.pct);
    else list = [...list].sort((a,b) => a.crop.name.localeCompare(b.crop.name));
    return list;
  })();

  const topCrops = results.filter(r => r.result.pct >= 70).length;
  const marginal = results.filter(r => r.result.pct >= 40 && r.result.pct < 70).length;

  return (
    <div style={{
      background: `${T.forest}88`, border: `1px solid ${T.straw}33`,
      borderRadius: 14, padding: "20px 24px",
    }}>
      {/* HEADER ROW */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 18 }}>
        <div>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 18, color: T.straw, display: "flex", alignItems: "center", gap: 8 }}>
            🌾 Crop Suitability Analysis
          </div>
          <div style={{ fontSize: 11, color: T.mist, marginTop: 4 }}>
            {topCrops} well-suited · {marginal} marginal · {results.length - topCrops - marginal} not recommended
          </div>
        </div>

        {/* IRRIGATION TOGGLE */}
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          background: `${T.soil}CC`, border: `1px solid ${irrigation ? T.rain+"66" : T.straw+"44"}`,
          borderRadius: 10, padding: "10px 16px",
        }}>
          <span style={{ fontSize: 11, color: T.mist }}>☁️ Rainfed</span>
          <div
            onClick={() => setIrrigation(v => !v)}
            style={{
              width: 44, height: 24, borderRadius: 12,
              background: irrigation
                ? `linear-gradient(to right, ${T.rain}, ${T.sky})`
                : `${T.soil}`,
              border: `1px solid ${irrigation ? T.rain : T.mist+"44"}`,
              cursor: "pointer", position: "relative", transition: "all 0.3s",
            }}
          >
            <div style={{
              position: "absolute", top: 3,
              left: irrigation ? 22 : 2,
              width: 16, height: 16, borderRadius: "50%",
              background: T.cream, transition: "left 0.3s",
              boxShadow: "0 1px 3px #0006",
            }} />
          </div>
          <span style={{ fontSize: 11, color: irrigation ? T.sky : T.mist }}>💧 Irrigated</span>
        </div>
      </div>

      {/* IRRIGATION INFO BANNER */}
      <div style={{
        background: irrigation ? `${T.rain}18` : `${T.straw}15`,
        border: `1px solid ${irrigation ? T.rain+"44" : T.straw+"33"}`,
        borderRadius: 8, padding: "8px 14px", marginBottom: 18, fontSize: 11,
        color: irrigation ? T.sky : T.straw,
      }}>
        {irrigation
          ? "💧 Irrigation ON — Water availability is not a limiting factor. Scores reflect heat, frost, and GDD compatibility only."
          : "☁️ Rainfed mode — Scores account for natural rainfall vs each crop's water requirements. Drought-tolerant crops rank higher."}
      </div>

      {/* FILTER & SORT */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {["All", ...CATEGORIES].map(cat => (
            <button key={cat} onClick={() => setActiveCat(cat)} style={{
              background: activeCat === cat ? `${T.straw}33` : "transparent",
              border: `1px solid ${activeCat === cat ? T.straw : T.mist+"33"}`,
              color: activeCat === cat ? T.straw : T.mist,
              borderRadius: 20, padding: "4px 12px",
              fontSize: 11, fontFamily: FONT_BODY, cursor: "pointer",
            }}>
              {cat === "All" ? "🌍 All" : `${CAT_ICONS[cat]} ${cat}`}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button onClick={() => setSortBy("score")} style={{
            ...miniBtn, color: sortBy==="score" ? T.straw : T.mist,
            border: `1px solid ${sortBy==="score" ? T.straw+"66" : T.mist+"33"}`,
          }}>Sort: Score</button>
          <button onClick={() => setSortBy("name")} style={{
            ...miniBtn, color: sortBy==="name" ? T.straw : T.mist,
            border: `1px solid ${sortBy==="name" ? T.straw+"66" : T.mist+"33"}`,
          }}>Sort: A–Z</button>
        </div>
      </div>

      {/* CROP LIST */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.map(({ crop, result }) => (
          <CropCard
            key={crop.id}
            crop={crop}
            result={result}
            expanded={expandedId === crop.id}
            onToggle={() => setExpandedId(id => id === crop.id ? null : crop.id)}
          />
        ))}
      </div>

      <div style={{ marginTop: 16, fontSize: 10, color: T.mist, lineHeight: 1.7 }}>
        ⚠️ Scores are climate-based estimates using GDD, frost days, heat stress, chilling hours, and water balance.
        Soil type, variety selection, pest pressure, market access, and management practices are not included.
        Always consult a local agronomist before investment decisions.
      </div>
    </div>
  );
};

const miniBtn = {
  background: "transparent", borderRadius: 6,
  padding: "4px 10px", fontSize: 10,
  fontFamily: "'DM Mono', monospace", cursor: "pointer",
};

/* ─── SHARED STYLES ──────────────────────────────────────────── */
const inputStyle = {
  width: "100%", background: `${T.soil}CC`, border: `1px solid ${T.straw}44`,
  borderRadius: 6, padding: "8px 12px", color: T.cream,
  fontFamily: "'DM Mono', monospace", fontSize: 13, outline: "none",
  boxSizing: "border-box",
};
const quickBtnStyle = {
  background: "transparent", border: `1px solid ${T.straw}44`,
  borderRadius: 6, padding: "5px 12px", color: T.mist,
  fontFamily: "'DM Mono', monospace", fontSize: 11, cursor: "pointer",
};
const tagStyle = {
  borderRadius: 20, padding: "5px 14px", cursor: "pointer",
  fontSize: 11, fontFamily: "'DM Mono', monospace",
  transition: "all .15s", letterSpacing: 0.3,
};
