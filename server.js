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
  .then(() => {
    console.log("✅ MongoDB Connected");
  })
  .catch((err) => {
    console.error("❌ MongoDB Connection Error:", err);
  });

/* ===================== SCHEMA ===================== */
const gpsSchema = new mongoose.Schema({
  lat: {
    type: Number,
    required: true,
  },
  lng: {
    type: Number,
    required: true,
  },
  time: {
    type: String,
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

/* ===================== MODEL ===================== */
const GPS = mongoose.model("GPS", gpsSchema);

/* ===================== ROUTES ===================== */

// Health check (Render)
app.get("/", (req, res) => {
  res.status(200).send("🚀 ESP32 GPS API is running");
});

// Receive GPS data from ESP32
app.post("/api/gps", async (req, res) => {
  try {
    const { lat, lng, time } = req.body;

    // Validation
    if (lat === undefined || lng === undefined || !time) {
      return res.status(400).json({
        success: false,
        message: "lat, lng and time are required",
      });
    }

    // Save to DB
    const gpsData = new GPS({
      lat,
      lng,
      time,
    });

    await gpsData.save();

    console.log("📍 GPS Data Saved:", gpsData);

    return res.status(201).json({
      success: true,
      message: "GPS data stored successfully",
    });
  } catch (error) {
    console.error("❌ Error saving GPS data:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/* ===================== START SERVER ===================== */
app.listen(PORT, () => {
  console.log(`🌍 Server running on port ${PORT}`);
});
