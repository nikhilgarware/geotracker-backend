/*****************************************************
 * ESP32 GPS Backend - Node.js + Express + MongoDB
 * Single-file server.js (Render ready)
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
  { timestamps: true }, // adds createdAt, updatedAt
);

const GPS = mongoose.model("GPS", gpsSchema);

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

    console.log("📍 Saved:", gps);

    res.status(201).json({
      success: true,
      message: "GPS data saved",
    });
  } catch (err) {
    console.error("❌ POST error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* -------- GET LATEST GPS -------- */
app.get("/api/gps/latest", async (req, res) => {
  try {
    const data = await GPS.findOne().sort({ createdAt: -1 });

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "No data found",
      });
    }

    res.json({
      success: true,
      data,
    });
  } catch (err) {
    console.error("❌ Latest error:", err);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* -------- GET PAGINATED + FILTERED DATA -------- */
app.get("/api/gps", async (req, res) => {
  try {
    const { page = 1, limit = 10, from, to, sort = "desc" } = req.query;

    const query = {};

    // Date filter
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
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});

/* ===================== START SERVER ===================== */
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
