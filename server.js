/*****************************************************
 * ESP32 GPS Backend - Node.js + Express + MongoDB
 * Enhanced Version - Date Filter + Trip Analysis
 *****************************************************/

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

/* ===================== CONFIG ===================== */
const PORT = process.env.PORT || 3000;
const MONGO_URI =
  "mongodb+srv://root:root@cluster0cluster.5oogq.mongodb.net/geotracker?retryWrites=true&w=majority";

/* ===================== MIDDLEWARE ===================== */
app.use(express.json());

/* ===================== MONGODB CONNECT ===================== */
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

/* ===================== SCHEMA ===================== */
const gpsSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    time: { type: String, required: true },
  },
  { timestamps: true },
);

const GPS = mongoose.model("GPS", gpsSchema);

/* ===================== ROUTES SCHEMA ===================== */
const routeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    polyline: { type: Array, required: true }, // array of [lat,lng]
    bbox: {
      // simple bounding box to speed up prefilter { minLat, minLng, maxLat, maxLng }
      minLat: Number,
      minLng: Number,
      maxLat: Number,
      maxLng: Number,
    },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

const Route = mongoose.model("Route", routeSchema);

/* ===================== UTIL: GEOMETRY & MATCHING ===================== */
// distance from point p to segment [v,w] (all lat/lng) in meters
function pointToSegmentDistanceMeters(p, v, w) {
  // convert to Cartesian approximation using lat/lng as degrees -> use haversine for endpoints
  // project p onto segment (v,w) in lat/lng space (approximate) then compute haversine.
  const lat1 = v[0],
    lon1 = v[1];
  const lat2 = w[0],
    lon2 = w[1];
  const lat3 = p[0],
    lon3 = p[1];

  // if segment degenerate
  if (lat1 === lat2 && lon1 === lon2)
    return distanceMeters(lat1, lon1, lat3, lon3);

  // convert degrees to radians for projection math
  const toRad = (d) => (d * Math.PI) / 180;
  const x1 = toRad(lon1),
    y1 = toRad(lat1);
  const x2 = toRad(lon2),
    y2 = toRad(lat2);
  const x3 = toRad(lon3),
    y3 = toRad(lat3);

  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = ((x3 - x1) * dx + (y3 - y1) * dy) / (dx * dx + dy * dy);
  const tt = Math.max(0, Math.min(1, t));
  const projX = x1 + tt * dx;
  const projY = y1 + tt * dy;
  // convert back to degrees for haversine
  const projLon = (projX * 180) / Math.PI;
  const projLat = (projY * 180) / Math.PI;
  return distanceMeters(projLat, projLon, lat3, lon3);
}

// compute nearest distance from point p to polyline (array of [lat,lng]) in meters
function nearestDistanceToPolylineMeters(p, polyline) {
  if (!Array.isArray(polyline) || polyline.length === 0) return Infinity;
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const d = pointToSegmentDistanceMeters(p, polyline[i], polyline[i + 1]);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Match a trip polyline (array [lat,lng]) against saved routes.
 * Returns best candidate { routeId, name, score, avgDistance, fractionWithin }
 */
async function matchTripToRoutes(tripPolyline, opts = {}) {
  const SAMPLE_LIMIT = opts.sampleLimit ?? 60;
  const DIST_THRESHOLD = opts.distThresholdMeters ?? 75; // D
  const MAX_DIST = opts.maxDist ?? 400; // for normalization

  if (!Array.isArray(tripPolyline) || tripPolyline.length < 2) return null;

  const routes = await Route.find({}).lean();
  if (!routes.length) return null;

  // sample indices
  const n = tripPolyline.length;
  const step = Math.max(1, Math.floor(n / SAMPLE_LIMIT));
  const samples = [];
  for (let i = 0; i < n; i += step) samples.push(tripPolyline[i]);
  if (samples[samples.length - 1] !== tripPolyline[n - 1])
    samples.push(tripPolyline[n - 1]);

  let best = null;

  for (const r of routes) {
    const poly = r.polyline || [];
    if (!poly.length) continue;
    // quick bbox reject
    if (r.bbox) {
      const lats = samples.map((s) => s[0]);
      const lngs = samples.map((s) => s[1]);
      const sMinLat = Math.min(...lats),
        sMaxLat = Math.max(...lats);
      const sMinLng = Math.min(...lngs),
        sMaxLng = Math.max(...lngs);
      // if trip bbox doesn't intersect route bbox, skip
      if (
        sMaxLat < r.bbox.minLat - 0.01 ||
        sMinLat > r.bbox.maxLat + 0.01 ||
        sMaxLng < r.bbox.minLng - 0.01 ||
        sMinLng > r.bbox.maxLng + 0.01
      ) {
        continue;
      }
    }

    let sum = 0;
    let withinCount = 0;
    for (const s of samples) {
      const d = nearestDistanceToPolylineMeters(s, poly);
      sum += d;
      if (d <= DIST_THRESHOLD) withinCount++;
    }
    const avgDist = sum / samples.length;
    const fractionWithin = withinCount / samples.length; // 0..1
    const score =
      0.6 * fractionWithin + 0.4 * (1 - Math.min(avgDist, MAX_DIST) / MAX_DIST);

    if (!best || score > best.score) {
      best = {
        routeId: r._id,
        name: r.name,
        score,
        avgDistanceMeters: avgDist,
        fractionWithin,
      };
    }
  }

  return best;
}

/* ===================== UTIL: DISTANCE ===================== */
function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

app.use(
  cors({
    origin: [
      "http://localhost:5173", // for local dev
      "https://geo-tracker-frontend-gtrd7evy7-nikhils-projects-f153eec7.vercel.app",
      "https://geo-tracker-frontend-self.vercel.app",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  }),
);

/* ===================== ROUTES ===================== */

/* -------- Health Check -------- */
app.get("/", (req, res) => {
  res.send("🚀 ESP32 GPS API is running");
});

/* -------- POST GPS DATA -------- */
app.post("/api/gps", async (req, res) => {
  try {
    const { lat, lng, time } = req.body;

    if (lat === undefined || lng === undefined || !time) {
      return res.status(400).json({
        success: false,
        message: "lat, lng, time are required",
      });
    }

    const gps = new GPS({ lat, lng, time });
    await gps.save();

    res.status(201).json({
      success: true,
      message: "GPS data saved",
    });
  } catch (err) {
    console.error("❌ POST error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ============================================================
   1️⃣ DATE-SPECIFIC + RANGE FILTER + PAGINATION
============================================================ */
app.get("/api/gps", async (req, res) => {
  try {
    const { page = 1, limit = 50, date, from, to, sort = "desc" } = req.query;

    const query = {};

    // Single date filter
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);

      const end = new Date(date);
      end.setHours(23, 59, 59, 999);

      query.createdAt = { $gte: start, $lte: end };
    }

    // Date range filter
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }

    const skip = (page - 1) * limit;

    const data = await GPS.find(query)
      .sort({ createdAt: sort === "asc" ? 1 : -1 })
      .skip(Number(skip))
      .limit(Number(limit));

    const total = await GPS.countDocuments(query);

    res.json({
      success: true,
      pagination: {
        totalRecords: total,
        currentPage: Number(page),
        totalPages: Math.ceil(total / limit),
        limit: Number(limit),
      },
      data,
    });
  } catch (err) {
    console.error("❌ GET error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ============================================================
   2️⃣ TRIP ANALYSIS API (Leaflet Ready)
============================================================ */
app.get("/api/gps/trip", async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        success: false,
        message: "date query param required (YYYY-MM-DD)",
      });
    }

    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(date);
    end.setHours(23, 59, 59, 999);

    const points = await GPS.find({
      createdAt: { $gte: start, $lte: end },
    }).sort({ createdAt: 1 });

    if (!points.length) {
      return res.status(404).json({
        success: false,
        message: "No trip data found for this date",
      });
    }

    let totalDistance = 0;

    for (let i = 1; i < points.length; i++) {
      totalDistance += distanceMeters(
        points[i - 1].lat,
        points[i - 1].lng,
        points[i].lat,
        points[i].lng,
      );
    }

    // build basic response
    const polyline = points.map((p) => [p.lat, p.lng]);
    const base = {
      success: true,
      tripDate: date,
      totalPoints: points.length,
      totalDistanceMeters: totalDistance,
      totalDistanceKm: (totalDistance / 1000).toFixed(2),
      startPoint: {
        lat: points[0].lat,
        lng: points[0].lng,
        time: points[0].time,
        createdAt: points[0].createdAt,
      },
      endPoint: {
        lat: points[points.length - 1].lat,
        lng: points[points.length - 1].lng,
        time: points[points.length - 1].time,
        createdAt: points[points.length - 1].createdAt,
      },
      polyline,
      raw: points,
    };

    // attempt to match to saved routes (if any)
    try {
      const candidate = await matchTripToRoutes(polyline);
      const SAME_THRESHOLD = 0.75;
      if (candidate) {
        base.candidate = candidate;
        if (candidate.score >= SAME_THRESHOLD) {
          base.matchedRoute = {
            routeId: candidate.routeId,
            name: candidate.name,
            confidence: candidate.score,
          };
        }
      }
    } catch (err) {
      console.error("⚠️ route matching error:", err);
    }

    res.json(base);
  } catch (err) {
    console.error("❌ Trip error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ============================================================
   HEALTH CHECK (Better Stack Ready)
============================================================ */
app.get("/health", async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState;

    const dbStatus =
      dbState === 0
        ? "disconnected"
        : dbState === 1
          ? "connected"
          : dbState === 2
            ? "connecting"
            : dbState === 3
              ? "disconnecting"
              : "unknown";

    res.status(200).json({
      success: true,
      status: "ok",
      serverTime: new Date().toISOString(),
      uptimeSeconds: process.uptime(),
      environment: process.env.NODE_ENV || "development",
      database: dbStatus,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      status: "error",
      message: err.message,
    });
  }
});

/* ============================================================
   ROUTES: Create / List / Sync candidates
============================================================ */
// compute bbox for polyline
function computeBbox(polyline) {
  const lats = polyline.map((p) => p[0]);
  const lngs = polyline.map((p) => p[1]);
  return {
    minLat: Math.min(...lats),
    minLng: Math.min(...lngs),
    maxLat: Math.max(...lats),
    maxLng: Math.max(...lngs),
  };
}

// Create route
app.post("/api/routes", async (req, res) => {
  try {
    const { name, polyline, description } = req.body;
    if (!name || !Array.isArray(polyline) || polyline.length < 2) {
      return res
        .status(400)
        .json({ success: false, message: "name + polyline required" });
    }
    const bbox = computeBbox(polyline);
    const route = new Route({ name, description, polyline, bbox });
    await route.save();
    res.status(201).json({ success: true, route });
  } catch (err) {
    console.error("❌ Create route error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// List routes
app.get("/api/routes", async (req, res) => {
  try {
    const routes = await Route.find({}).sort({ createdAt: -1 }).lean();
    res.json({ success: true, routes });
  } catch (err) {
    console.error("❌ List routes error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * Sync candidates: scan dates between from/to and return trips that do not match existing routes (or low confidence)
 * POST /api/routes/sync with JSON { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }
 */
app.post("/api/routes/sync", async (req, res) => {
  try {
    const { from, to } = req.body || {};
    if (!from || !to)
      return res
        .status(400)
        .json({ success: false, message: "from and to required" });
    const fromD = new Date(from);
    fromD.setHours(0, 0, 0, 0);
    const toD = new Date(to);
    toD.setHours(23, 59, 59, 999);
    const SAME_THRESHOLD = 0.75;

    // gather all distinct dates that have points in range
    const points = await GPS.find({ createdAt: { $gte: fromD, $lte: toD } })
      .sort({ createdAt: 1 })
      .lean();
    if (!points.length) return res.json({ success: true, candidates: [] });

    // group points by date (YYYY-MM-DD)
    const groups = {};
    for (const p of points) {
      const d = new Date(p.createdAt);
      const key = d.toISOString().slice(0, 10);
      groups[key] = groups[key] || [];
      groups[key].push(p);
    }

    const candidates = [];
    for (const [date, pts] of Object.entries(groups)) {
      const polyline = pts.map((p) => [p.lat, p.lng]);
      const candidate = await matchTripToRoutes(polyline);
      if (!candidate || candidate.score < SAME_THRESHOLD) {
        // include candidate information (score if present)
        candidates.push({ date, polyline, candidate });
      }
    }

    res.json({ success: true, candidates });
  } catch (err) {
    console.error("❌ Sync routes error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/**
 * Analyze saved routes between from/to dates.
 * Returns for each route: tripsMatched, avgDurationSeconds
 * GET /api/routes/analysis?from=YYYY-MM-DD&to=YYYY-MM-DD
 */
app.get("/api/routes/analysis", async (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to)
      return res
        .status(400)
        .json({ success: false, message: "from and to required" });
    const fromD = new Date(from);
    fromD.setHours(0, 0, 0, 0);
    const toD = new Date(to);
    toD.setHours(23, 59, 59, 999);
    const SAME_THRESHOLD = 0.75;

    const routes = await Route.find({}).lean();
    if (!routes.length) return res.json({ success: true, analysis: [] });

    const points = await GPS.find({ createdAt: { $gte: fromD, $lte: toD } })
      .sort({ createdAt: 1 })
      .lean();
    if (!points.length) return res.json({ success: true, analysis: [] });

    // group by date
    const groups = {};
    for (const p of points) {
      const d = new Date(p.createdAt);
      const key = d.toISOString().slice(0, 10);
      groups[key] = groups[key] || [];
      groups[key].push(p);
    }

    // prepare per-route accumulators
    const accum = {};
    for (const r of routes)
      accum[r._id] = {
        routeId: r._id,
        name: r.name,
        matchedTrips: 0,
        totalDurationSec: 0,
      };

    for (const [date, pts] of Object.entries(groups)) {
      const polyline = pts.map((p) => [p.lat, p.lng]);
      const candidate = await matchTripToRoutes(polyline);
      if (!candidate || candidate.score < SAME_THRESHOLD) continue;
      const rid = String(candidate.routeId);
      if (!accum[rid]) continue;
      // duration estimate from createdAt of first/last point
      const startTs = new Date(pts[0].createdAt).getTime();
      const endTs = new Date(pts[pts.length - 1].createdAt).getTime();
      const durSec = Math.max(0, Math.round((endTs - startTs) / 1000));
      accum[rid].matchedTrips += 1;
      accum[rid].totalDurationSec += durSec;
    }

    const analysis = Object.values(accum).map((a) => ({
      routeId: a.routeId,
      name: a.name,
      trips: a.matchedTrips,
      avgDurationSec: a.matchedTrips
        ? Math.round(a.totalDurationSec / a.matchedTrips)
        : 0,
    }));

    res.json({ success: true, analysis });
  } catch (err) {
    console.error("❌ Routes analysis error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ===================== START SERVER ===================== */
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
