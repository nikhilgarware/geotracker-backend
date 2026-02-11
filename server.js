/*****************************************************
 * ESP32 GPS Backend - Node.js + Express + MongoDB
 * Enhanced Version - Date Filter + Trip Analysis
 *****************************************************/

const express = require("express");
const mongoose = require("mongoose");

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
      },
      endPoint: {
        lat: points[points.length - 1].lat,
        lng: points[points.length - 1].lng,
        time: points[points.length - 1].time,
      },
      polyline: points.map((p) => [p.lat, p.lng]), // Leaflet format
      raw: points,
    });
  } catch (err) {
    console.error("❌ Trip error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ===================== START SERVER ===================== */
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
