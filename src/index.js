require("dotenv").config();
const express   = require("express");
const helmet    = require("helmet");
const cors      = require("cors");
const rateLimit = require("express-rate-limit");

const app  = express();
const PORT = process.env.PORT || 4000;

app.use(helmet());

// Allowlist: comma-separated FRONTEND_URL(s) plus localhost for dev.
// Using a function reflects the *request* origin when allowed, so multiple
// frontends (local + Vercel) work without hardcoding a single value.
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
allowedOrigins.push("http://localhost:3000");

app.use(cors({
  origin(origin, cb) {
    if (!origin) return cb(null, true);                    // curl / server-to-server
    if (allowedOrigins.includes(origin.replace(/\/$/, ""))) return cb(null, true);
    return cb(null, false);                                // blocked: no CORS headers
  },
  credentials: true,
}));
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use("/api/auth",        require("./routes/auth"));
app.use("/api/posts",       require("./routes/posts"));
app.use("/api/payments",    require("./routes/payments"));
app.use("/api/connections", require("./routes/connections"));
app.use("/api/help",        require("./routes/help"));

app.get("/health", (_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ error: "የሰርቨር ስህተት" });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Digital Delala API running on http://localhost:${PORT}`);
  console.log(`   Supabase: ${process.env.SUPABASE_URL ? "✅" : "❌ not configured"}`);
  console.log(`   Email:    ${process.env.SMTP_USER  ? "✅" : "❌ not configured"}\n`);
});