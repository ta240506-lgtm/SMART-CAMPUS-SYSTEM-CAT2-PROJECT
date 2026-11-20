// Smart Campus Monitor - PostgreSQL telemetry API + dashboard
// Receives ESP32 JSON telemetry, stores it in PostgreSQL, and serves the dashboard.

require("dotenv").config();

const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const API_KEY = process.env.API_KEY || ""; // Optional; configure the same key in ESP32 if enabled.

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it to your .env file.");
  process.exit(1);
}

// Neon connection strings use SSL. Keep certificate verification enabled.
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

app.use(express.json({ limit: "32kb" }));
app.use(express.static(path.join(__dirname, "public")));

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value) {
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return null;
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS telemetry (
      id BIGSERIAL PRIMARY KEY,
      received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      device_id VARCHAR(80) NOT NULL DEFAULT 'ESP32-01',
      facility VARCHAR(80) NOT NULL,
      distance_cm DOUBLE PRECISION,
      temperature_c DOUBLE PRECISION,
      humidity_percent DOUBLE PRECISION,
      predicted_status VARCHAR(30) NOT NULL,
      ultrasonic_ok BOOLEAN,
      temperature_ok BOOLEAN,
      humidity_ok BOOLEAN,
      sensor_error BOOLEAN,
      uptime_ms BIGINT
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_facility_time
    ON telemetry (facility, received_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_telemetry_device_time
    ON telemetry (device_id, received_at DESC);
  `);

  console.log("PostgreSQL tables are ready.");
}

// ESP32 sends HTTP POST /api/telemetry with application/json.
app.post("/api/telemetry", async (req, res) => {
  if (API_KEY && req.get("x-api-key") !== API_KEY) {
    return res.status(401).json({ ok: false, error: "Invalid or missing API key" });
  }

  const body = req.body || {};
  const facility = String(body.facility || "").trim();
  const status = String(body.predicted_status || "").trim().toUpperCase();
  const allowedStatuses = [
    "AVAILABLE",
    "CROWDED/DEGRADED",
    "UNAVAILABLE",
    "SENSOR ERROR"
  ];

  if (!facility || facility.length > 80) {
    return res.status(400).json({
      ok: false,
      error: "facility is required (maximum 80 characters)"
    });
  }

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      error: "predicted_status is missing or invalid"
    });
  }

  const values = [
    String(body.device_id || "ESP32-01").slice(0, 80),
    facility,
    finiteOrNull(body.distance_cm),
    finiteOrNull(body.temperature_c),
    finiteOrNull(body.humidity_percent),
    status,
    boolOrNull(body.ultrasonic_ok),
    boolOrNull(body.temperature_ok),
    boolOrNull(body.humidity_ok),
    boolOrNull(body.sensor_error),
    finiteOrNull(body.uptime_ms)
  ];

  try {
    const result = await pool.query(
      `INSERT INTO telemetry (
        device_id, facility, distance_cm, temperature_c, humidity_percent,
        predicted_status, ultrasonic_ok, temperature_ok, humidity_ok,
        sensor_error, uptime_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING id, received_at`,
      values
    );

    return res.status(201).json({
      ok: true,
      message: "Telemetry stored in PostgreSQL",
      record_id: result.rows[0].id,
      received_at: result.rows[0].received_at
    });
  } catch (err) {
    console.error("PostgreSQL insert failed:", err.message);
    return res.status(500).json({
      ok: false,
      error: "Could not store telemetry"
    });
  }
});

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      ok: true,
      service: "Smart Campus Telemetry API",
      database: "PostgreSQL connected",
      time: new Date().toISOString()
    });
  } catch (err) {
    console.error("Database health check failed:", err.message);
    res.status(503).json({
      ok: false,
      service: "Smart Campus Telemetry API",
      database: "PostgreSQL unavailable"
    });
  }
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const [latestResult, recentResult, countResult, lastResult] = await Promise.all([
      pool.query(`
        SELECT DISTINCT ON (facility) *
        FROM telemetry
        ORDER BY facility, received_at DESC, id DESC
      `),
      pool.query(`
        SELECT * FROM telemetry
        ORDER BY received_at DESC, id DESC
        LIMIT 100
      `),
      pool.query("SELECT COUNT(*)::BIGINT AS count FROM telemetry"),
      pool.query("SELECT MAX(received_at) AS received_at FROM telemetry")
    ]);

    res.json({
      ok: true,
      total_records: Number(countResult.rows[0].count),
      last_received_at: lastResult.rows[0].received_at,
      facilities: latestResult.rows,
      recent: recentResult.rows
    });
  } catch (err) {
    console.error("Dashboard query failed:", err.message);
    res.status(500).json({ ok: false, error: "Could not load dashboard data" });
  }
});

app.get("/api/history", async (req, res) => {
  const facility = String(req.query.facility || "").trim();
  const parsedLimit = Number.parseInt(req.query.limit || "100", 10);
  const limit = Math.min(Math.max(Number.isFinite(parsedLimit) ? parsedLimit : 100, 1), 500);

  try {
    let result;
    if (facility) {
      result = await pool.query(
        `SELECT * FROM telemetry
         WHERE facility = $1
         ORDER BY received_at DESC, id DESC
         LIMIT $2`,
        [facility, limit]
      );
    } else {
      result = await pool.query(
        `SELECT * FROM telemetry
         ORDER BY received_at DESC, id DESC
         LIMIT $1`,
        [limit]
      );
    }

    res.json({ ok: true, records: result.rows.reverse() });
  } catch (err) {
    console.error("History query failed:", err.message);
    res.status(500).json({ ok: false, error: "Could not load telemetry history" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function startServer() {
  try {
    await initializeDatabase();
    await pool.query("SELECT 1");
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Smart Campus dashboard running on port ${PORT}`);
      console.log("Database: PostgreSQL connected");
    });
  } catch (err) {
    console.error("Could not start the application:", err.message);
    console.error("Check DATABASE_URL, Neon project status, and network access.");
    process.exit(1);
  }
}

process.on("SIGINT", async () => {
  await pool.end();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await pool.end();
  process.exit(0);
});

startServer();
