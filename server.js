const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();

/* ===================== CONFIG ===================== */
const PORT = process.env.PORT || 3000;
const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb+srv://root:root@cluster0cluster.5oogq.mongodb.net/geotracker?retryWrites=true&w=majority";

/* ===================== MIDDLEWARE ===================== */
app.use(express.json());

/* ===================== MONGODB CONNECT ===================== */
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error("❌ MongoDB Connection Error:", err));

/* ===================== SCHEMAS & MODELS ===================== */
const gpsSchema = new mongoose.Schema(
  {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    time: { type: String, required: true },
  },
  { timestamps: true },
);
const GPS = mongoose.model("GPS", gpsSchema);

const markerBase = {
  name: { type: String, required: true },
  lat: { type: Number },
  lng: { type: Number },
  meta: { type: mongoose.Schema.Types.Mixed },
};
const namedSchema = new mongoose.Schema({ ...markerBase }, { timestamps: true });
const checkpointSchema = new mongoose.Schema({ ...markerBase }, { timestamps: true });
const segmentSchema = new mongoose.Schema({ ...markerBase }, { timestamps: true });

const NamedLocation = mongoose.model("NamedLocation", namedSchema);
const Checkpoint = mongoose.model("Checkpoint", checkpointSchema);
const SegmentMarker = mongoose.model("SegmentMarker", segmentSchema);

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
      "https://geo-tracker-frontend-self.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

/* ===================== MARKERS API (Mongo) ===================== */
app.get("/api/named-locations", async (req, res) => {
  try {
    const rows = await NamedLocation.find().sort({ _id: 1 }).lean();
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error("GET named-locations error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});
app.get("/api/named-locations/:id", async (req, res) => {
  const row = await NamedLocation.findById(req.params.id).lean();
  if (!row)
    return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
});
app.post("/api/named-locations", async (req, res) => {
  const { name, lat, lng, meta } = req.body;
  if (!name || typeof lat !== "number" || typeof lng !== "number")
    return res
      .status(400)
      .json({ success: false, message: "name, lat, lng required" });
  const created = await NamedLocation.create({ name, lat, lng, meta });
  res.json({ success: true, data: created });
});
app.put("/api/named-locations/:id", async (req, res) => {
  const updated = await NamedLocation.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true },
  ).lean();
  res.json({ success: true, data: updated });
});
app.delete("/api/named-locations/:id", async (req, res) => {
  await NamedLocation.findByIdAndDelete(req.params.id);
  res.json({ success: true, data: { deleted: true, id: req.params.id } });
});

app.get("/api/checkpoints", async (req, res) => {
  const rows = await Checkpoint.find().sort({ _id: 1 }).lean();
  res.json({ success: true, data: rows });
});
app.get("/api/checkpoints/:id", async (req, res) => {
  const row = await Checkpoint.findById(req.params.id).lean();
  if (!row)
    return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
});
app.post("/api/checkpoints", async (req, res) => {
  const { name, lat, lng, meta } = req.body;
  if (!name || typeof lat !== "number" || typeof lng !== "number")
    return res
      .status(400)
      .json({ success: false, message: "name, lat, lng required" });
  const created = await Checkpoint.create({ name, lat, lng, meta });
  res.json({ success: true, data: created });
});
app.put("/api/checkpoints/:id", async (req, res) => {
  const updated = await Checkpoint.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
  }).lean();
  res.json({ success: true, data: updated });
});
app.delete("/api/checkpoints/:id", async (req, res) => {
  await Checkpoint.findByIdAndDelete(req.params.id);
  res.json({ success: true, data: { deleted: true, id: req.params.id } });
});

app.get("/api/segments-markers", async (req, res) => {
  const rows = await SegmentMarker.find().sort({ _id: 1 }).lean();
  res.json({ success: true, data: rows });
});
app.get("/api/segments-markers/:id", async (req, res) => {
  const row = await SegmentMarker.findById(req.params.id).lean();
  if (!row)
    return res.status(404).json({ success: false, message: "Not found" });
  res.json({ success: true, data: row });
});
app.post("/api/segments-markers", async (req, res) => {
  const { name, lat, lng, meta } = req.body;
  if (!name)
    return res.status(400).json({ success: false, message: "name required" });
  const created = await SegmentMarker.create({ name, lat, lng, meta });
  res.json({ success: true, data: created });
});
app.put("/api/segments-markers/:id", async (req, res) => {
  const updated = await SegmentMarker.findByIdAndUpdate(
    req.params.id,
    req.body,
    { new: true },
  ).lean();
  res.json({ success: true, data: updated });
});
app.delete("/api/segments-markers/:id", async (req, res) => {
  await SegmentMarker.findByIdAndDelete(req.params.id);
  res.json({ success: true, data: { deleted: true, id: req.params.id } });
});

// Convenience: fetch all markers in one request
app.get("/api/markers", async (req, res) => {
  const named = await NamedLocation.find().lean();
  const checkpoints = await Checkpoint.find().lean();
  const segments = await SegmentMarker.find().lean();
  // normalize coords into coords array for frontend convenience
  const norm = (rows) =>
    rows.map((r) => ({
      ...r,
      coords: r.lat != null && r.lng != null ? [r.lat, r.lng] : null,
    }));
  res.json({
    success: true,
    data: {
      named: norm(named),
      checkpoints: norm(checkpoints),
      segments: norm(segments),
    },
  });
});

/* ===================== GPS & Trip APIs (Mongo-backed) ===================== */
app.get("/", (req, res) => {
  res.send("🚀 ESP32 GPS API is running (Mongo)");
});

app.post("/api/gps", async (req, res) => {
  try {
    const { lat, lng, time } = req.body;
    if (lat === undefined || lng === undefined || !time) {
      return res
        .status(400)
        .json({ success: false, message: "lat, lng, time are required" });
    }
    const gps = new GPS({ lat, lng, time });
    await gps.save();
    res.status(201).json({ success: true, message: "GPS data saved" });
  } catch (err) {
    console.error("❌ POST error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

app.get("/api/gps", async (req, res) => {
  try {
    const { page = 1, limit = 5000, date, from, to, sort = "asc" } = req.query;
    const query = {};
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }
    if (from || to) {
      query.createdAt = {};
      if (from) query.createdAt.$gte = new Date(from);
      if (to) query.createdAt.$lte = new Date(to);
    }
    const skip = (page - 1) * limit;
    const data = await GPS.find(query)
      .sort({ createdAt: sort === "asc" ? 1 : -1 })
      .skip(Number(skip))
      .limit(Number(limit))
      .lean();
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

app.get("/api/gps/trip", async (req, res) => {
  try {
    const { date } = req.query;
    if (!date)
      return res.status(400).json({
        success: false,
        message: "date query param required (YYYY-MM-DD)",
      });
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    const points = await GPS.find({ createdAt: { $gte: start, $lte: end } })
      .sort({ createdAt: 1 })
      .lean();
    if (!points.length)
      return res
        .status(404)
        .json({ success: false, message: "No trip data found for this date" });
    let totalDistance = 0;
    for (let i = 1; i < points.length; i++) {
      totalDistance += distanceMeters(
        points[i - 1].lat,
        points[i - 1].lng,
        points[i].lat,
        points[i].lng,
      );
    }
    res.json({
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
      polyline: points.map((p) => [p.lat, p.lng]),
      raw: points,
      points,
    });
  } catch (err) {
    console.error("❌ Trip error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

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
    res
      .status(500)
      .json({ success: false, status: "error", message: err.message });
  }
});

/* ===================== START SERVER ===================== */
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
