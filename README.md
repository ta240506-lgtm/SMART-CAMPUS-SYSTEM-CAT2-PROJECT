# Smart Campus Monitor Dashboard

This project receives the JSON telemetry already produced by your ESP32 and displays it in a browser. It stores every accepted reading in SQLite.

## 1. What is included

- `server.js`: Express API and SQLite database.
- `public/`: dashboard interface, charts and live refresh.
- `package.json`: Node.js dependencies.
- `railway.json`: Railway start configuration.
- `.gitignore`: excludes local database and dependencies.

## 2. Run locally on your computer

Install Node.js 20 or newer.

Open a terminal in this project folder and run:

```bash
npm install
npm start
```

Open `http://localhost:3000` in your browser.

The API endpoint is:

```text
POST http://localhost:3000/api/telemetry
```

A local server is useful for testing the dashboard, but Wokwi cannot normally reach your computer's `localhost`. For Wokwi, deploy this app to a public HTTPS host and use that public URL in the ESP32 sketch.

## 3. Connect your existing ESP32 sketch

In the working ESP32 `.ino` file, find the existing line:

```cpp
const char* TELEMETRY_URL = "https://httpbin.org/post";
```

Replace it with your deployed server address:

```cpp
const char* TELEMETRY_URL = "https://YOUR-PUBLIC-DOMAIN/api/telemetry";
```

Keep the rest of your sensor, classification, LED, buzzer and OLED code unchanged. Your current JSON field names are supported:

- `facility`
- `distance_cm`
- `temperature_c`
- `humidity_percent`
- `predicted_status`
- `ultrasonic_ok`
- `temperature_ok`
- `humidity_ok`
- `sensor_error`
- `uptime_ms`

The API accepts HTTP status `201 Created` when a record is stored. Your ESP32 code should treat any 2xx response as success. If it only treats exactly `200` as success, update that check to accept `responseCode >= 200 && responseCode < 300`.

## 4. Deploy publicly using Railway

1. Create a GitHub repository and upload the contents of this folder.
2. Sign in to Railway and create a new project from that GitHub repository.
3. Add a public domain to the deployed service.
4. Add a persistent volume mounted at `/data`.
5. Add the environment variable `DB_PATH=/data/smart_campus.db`.
6. Deploy. Railway uses `npm start` from `package.json`.
7. Open `https://YOUR-PUBLIC-DOMAIN/api/health`. It should return JSON with `"ok": true`.
8. Paste `https://YOUR-PUBLIC-DOMAIN/api/telemetry` into the ESP32 `TELEMETRY_URL`.
9. Restart Wokwi and check the dashboard URL.

Do not use a temporary or private deployment URL. The ESP32 simulator needs to reach the API over the public internet. A persistent volume is important because otherwise SQLite data may be lost when the service is redeployed or restarted.

## 5. Test the API without ESP32

After starting the server, send a test request from a terminal:

```bash
curl -X POST http://localhost:3000/api/telemetry \
  -H "Content-Type: application/json" \
  -d "{\"facility\":\"Library Zone\",\"distance_cm\":152.24,\"temperature_c\":24,\"humidity_percent\":40,\"predicted_status\":\"AVAILABLE\",\"ultrasonic_ok\":true,\"temperature_ok\":true,\"humidity_ok\":true,\"sensor_error\":false,\"uptime_ms\":12000}"
```

Expected response: JSON containing `"ok": true`, `"message": "Telemetry stored"` and a record ID.

Then open `http://localhost:3000` and the reading should appear.

## 6. API reference

- `POST /api/telemetry` — receive and store one sensor reading.
- `GET /api/dashboard` — summary, latest reading per facility label and recent records.
- `GET /api/history?limit=100` — historical readings.
- `GET /api/history?facility=Library%20Zone&limit=100` — history for one facility label.
- `GET /api/health` — service health check.

## 7. Important prototype limitation

Your current push button changes the facility name included in the payload. It does not make one physical sensor set measure three places. The dashboard shows the latest reading associated with each facility label, but for genuine simultaneous monitoring you need one sensor node per facility and a unique `device_id` per node.

The API currently uses the server receive time as `received_at`, which records when the server received the reading. It does not assume that the ESP32's uptime is a wall-clock timestamp.

## 8. Security and production notes

- The sample is intended for a university prototype.
- For a public deployment, add an API key or other authentication before exposing the endpoint to unrestricted traffic.
- If setting `API_KEY` on the server, add the matching `X-API-Key` header to ESP32 requests.
- Keep HTTPS certificate verification enabled in a real deployment. Do not use insecure certificate bypass outside a controlled simulation.
- `better-sqlite3` stores data in the configured SQLite file. Back up the persistent volume for long-term use.
