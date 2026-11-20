const $ = (id) => document.getElementById(id);
let environmentChart, distanceChart;
const knownFacilities = ["Study Pod", "Library Zone", "Computer Lab"];

function statusClass(status) {
  if (status === "AVAILABLE") return "available";
  if (status === "CROWDED/DEGRADED") return "crowded";
  if (status === "UNAVAILABLE") return "unavailable";
  if (status === "SENSOR ERROR") return "error";
  return "waiting";
}
function fmt(value, digits=1) {
  return value === null || value === undefined ? "—" : Number(value).toFixed(digits);
}
function timeLabel(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString([], {month:"short", day:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit"});
}
function freshness(value) {
  if (!value) return "No data received yet";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 10) return "Updated just now";
  if (seconds < 60) return `Updated ${seconds}s ago`;
  return `Updated ${Math.floor(seconds/60)}m ago`;
}
function renderFacilities(rows) {
  const byName = new Map(rows.map(r => [r.facility, r]));
  const names = [...new Set([...knownFacilities, ...rows.map(r => r.facility)])];
  $("facilityGrid").innerHTML = names.map(name => {
    const r = byName.get(name);
    if (!r) return `<article class="facility-card"><div class="facility-title">${escapeHtml(name)}<span class="status waiting">NO DATA</span></div><div class="facility-reading">— <small>cm</small></div><div class="facility-meta"><span>Temperature —</span><span>Humidity —</span></div><div class="facility-time">Waiting for a reading from this facility label</div></article>`;
    const status = r.predicted_status || "UNKNOWN";
    const sensorOk = r.ultrasonic_ok === 1 && r.temperature_ok === 1 && r.humidity_ok === 1 && r.sensor_error !== 1;
    return `<article class="facility-card">
      <div class="facility-title">${escapeHtml(r.facility)}<span class="status ${statusClass(status)}">${escapeHtml(status)}</span></div>
      <div class="facility-reading">${fmt(r.distance_cm,1)} <small>cm distance</small></div>
      <div class="facility-meta"><span>♨ ${fmt(r.temperature_c,1)} °C</span><span>◌ ${fmt(r.humidity_percent,1)}%</span></div>
      <div class="facility-time">${sensorOk ? "● All sensors reporting" : "● Sensor fault or incomplete reading"} · ${timeLabel(r.received_at)}</div>
    </article>`;
  }).join("");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function renderTable(rows) {
  const latest = rows.slice(0,12);
  if (!latest.length) {
    $("telemetryRows").innerHTML = '<tr><td colspan="7" class="empty-cell">No telemetry received yet. Start your ESP32 simulation and send a POST request.</td></tr>';
    return;
  }
  $("telemetryRows").innerHTML = latest.map(r => {
    const healthy = r.ultrasonic_ok === 1 && r.temperature_ok === 1 && r.humidity_ok === 1 && r.sensor_error !== 1;
    return `<tr><td>${timeLabel(r.received_at)}</td><td><strong>${escapeHtml(r.facility)}</strong></td><td>${fmt(r.distance_cm,1)} cm</td><td>${fmt(r.temperature_c,1)} °C</td><td>${fmt(r.humidity_percent,1)}%</td><td><span class="table-status ${statusClass(r.predicted_status)}">${escapeHtml(r.predicted_status)}</span></td><td class="${healthy?"health-ok":"health-fail"}">${healthy?"HEALTHY":"CHECK"}</td></tr>`;
  }).join("");
}
function buildCharts(rows) {
  const selected = $("facilitySelect").value;
  const filtered = selected ? rows.filter(r => r.facility === selected) : rows;
  const labels = filtered.map(r => new Date(r.received_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}));
  const envData = {
    labels,
    datasets: [
      {label:"Temperature °C",data:filtered.map(r=>r.temperature_c),borderColor:"#e58b43",backgroundColor:"#e58b4320",tension:.32,yAxisID:"y",pointRadius:2},
      {label:"Humidity %",data:filtered.map(r=>r.humidity_percent),borderColor:"#398fba",backgroundColor:"#398fba20",tension:.32,yAxisID:"y1",pointRadius:2}
    ]
  };
  const distanceData = {labels,datasets:[{label:"Distance cm",data:filtered.map(r=>r.distance_cm),borderColor:"#4e78c5",backgroundColor:"#4e78c520",fill:true,tension:.3,pointRadius:2}]};
  const common = {responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},plugins:{legend:{labels:{boxWidth:8,usePointStyle:true,font:{size:10}}}},scales:{x:{ticks:{maxTicksLimit:6,font:{size:9}},grid:{display:false}},y:{ticks:{font:{size:9}},grid:{color:"#eef1f4"}}}};
  if (environmentChart) environmentChart.destroy();
  if (distanceChart) distanceChart.destroy();
  environmentChart = new Chart($("environmentChart"), {...common,type:"line",data:envData,options:{...common,scales:{...common.scales,y:{...common.scales.y,position:"left"},y1:{position:"right",grid:{drawOnChartArea:false},ticks:{font:{size:9}}}}}});
  distanceChart = new Chart($("distanceChart"), {...common,type:"line",data:distanceData,options:common});
}
async function refreshDashboard() {
  try {
    const [dashResponse, historyResponse] = await Promise.all([
      fetch("/api/dashboard", {cache:"no-store"}),
      fetch(`/api/history?limit=100`, {cache:"no-store"})
    ]);
    if (!dashResponse.ok || !historyResponse.ok) throw new Error("API returned an error");
    const dash = await dashResponse.json();
    const history = await historyResponse.json();
    const facilities = dash.facilities || [];
    const recent = dash.recent || [];
    $("connectionDot").className = "pulse-dot ok";
    $("connectionText").textContent = "Connected";
    $("lastUpdated").textContent = "Dashboard API responding";
    $("totalRecords").textContent = dash.total_records ?? 0;
    $("reportingCount").textContent = `${facilities.length} / 3`;
    const newest = recent[0];
    $("latestTemperature").innerHTML = newest ? `${fmt(newest.temperature_c,1)}<em>°C</em>` : "—";
    $("latestHumidity").innerHTML = newest ? `${fmt(newest.humidity_percent,1)}<em>%</em>` : "—";
    $("temperatureFacility").textContent = newest ? newest.facility : "Waiting for sensor data";
    $("humidityFacility").textContent = newest ? newest.facility : "Waiting for sensor data";
    $("dataFreshness").textContent = freshness(dash.last_received_at);
    renderFacilities(facilities);
    renderTable(recent);
    const select = $("facilitySelect");
    const current = select.value;
    const names = [...new Set(history.records.map(r=>r.facility))];
    select.innerHTML = '<option value="">All facilities</option>' + names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");
    if (names.includes(current)) select.value = current;
    buildCharts(history.records || []);
  } catch (err) {
    $("connectionDot").className = "pulse-dot bad";
    $("connectionText").textContent = "API unavailable";
    $("lastUpdated").textContent = "Check server connection";
    console.error(err);
  }
}
$("refreshButton").addEventListener("click", refreshDashboard);
$("facilitySelect").addEventListener("change", refreshDashboard);
refreshDashboard();
setInterval(refreshDashboard, 5000);
