const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const axios    = require("axios");
const { randomUUID } = require("crypto");
const supabase = require("../db/supabase");
const { requireAuth } = require("../middleware/auth");
const { sendOtpEmail } = require("../services/email");

const router   = express.Router();
const makeToken = (id) => jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

// Public-facing user fields returned on auth (never the password hash)
const USER_FIELDS = "id, name, email, intent, city, is_premium, premium_plan, premium_expiry, is_verified, auth_provider";

// Tighter limiter for OTP endpoints to slow brute-force / email flooding
const otpLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

/* ── OTP helpers ── */
const makeOtp = () => String(Math.floor(100000 + Math.random() * 900000)); // 6 digits

async function storeAndSendOtp({ email, name, purpose = "signup" }) {
  // Invalidate any prior unconsumed codes for this email + purpose
  await supabase.from("email_otps")
    .update({ consumed: true })
    .eq("email", email).eq("purpose", purpose).eq("consumed", false);

  const code      = makeOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const { error } = await supabase.from("email_otps")
    .insert({ id: randomUUID(), email, code, purpose, expires_at: expiresAt });
  if (error) throw new Error(error.message);

  await sendOtpEmail({ toEmail: email, toName: name, code });
}

/* ─────────────────────────────────────────────────────────
   POST /api/auth/signup
   Creates an unverified account, logs the user in immediately,
   and emails a 6-digit OTP so they can verify their email.
───────────────────────────────────────────────────────── */
router.post("/signup", async (req, res) => {
  const { name, email, password, intent, city } = req.body;
  if (!name || !email || !password || !intent || !city)
    return res.status(400).json({ error: "ሁሉም መስኮች ያስፈልጋሉ" });

  const { data: ex } = await supabase.from("users").select("id").eq("email", email).single();
  if (ex) return res.status(409).json({ error: "ይህ ኢሜይል ተመዝግቧል" });

  const hashed = await bcrypt.hash(password, 12);
  const { data: user, error } = await supabase.from("users")
    .insert({ id: randomUUID(), name, email, password: hashed, intent, city, is_verified: false, auth_provider: "email" })
    .select(USER_FIELDS).single();
  if (error) return res.status(500).json({ error: error.message });

  // Send verification code (non-blocking — signup still succeeds if email is slow)
  storeAndSendOtp({ email, name }).catch(e => console.error("OTP send failed:", e.message));

  res.status(201).json({ token: makeToken(user.id), user, otpSent: true });
});

/* ─────────────────────────────────────────────────────────
   POST /api/auth/verify-otp   { email, code }
   Marks the user's email as verified when the code matches.
───────────────────────────────────────────────────────── */
router.post("/verify-otp", otpLimiter, async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.status(400).json({ error: "ኢሜይልና ኮድ ያስፈልጋሉ" });

  const { data: otp } = await supabase.from("email_otps")
    .select("id, code, expires_at, attempts")
    .eq("email", email).eq("purpose", "signup").eq("consumed", false)
    .order("created_at", { ascending: false }).limit(1).single();

  if (!otp) return res.status(400).json({ error: "ኮድ አልተገኘም። እባክዎ አዲስ ይጠይቁ" });
  if (new Date(otp.expires_at) < new Date())
    return res.status(400).json({ error: "ኮዱ ጊዜው አልፏል። እባክዎ አዲስ ይጠይቁ" });
  if (otp.attempts >= 5) {
    await supabase.from("email_otps").update({ consumed: true }).eq("id", otp.id);
    return res.status(429).json({ error: "ብዙ ሙከራዎች። እባክዎ አዲስ ኮድ ይጠይቁ" });
  }

  if (otp.code !== String(code).trim()) {
    await supabase.from("email_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
    return res.status(400).json({ error: "ኮዱ ስህተት ነው" });
  }

  await supabase.from("email_otps").update({ consumed: true }).eq("id", otp.id);
  const { data: user, error } = await supabase.from("users")
    .update({ is_verified: true }).eq("email", email).select(USER_FIELDS).single();
  if (error) return res.status(500).json({ error: error.message });

  res.json({ user, verified: true });
});

/* ─────────────────────────────────────────────────────────
   POST /api/auth/resend-otp   { email }
   Re-sends a code. Always returns success (no account enumeration).
───────────────────────────────────────────────────────── */
router.post("/resend-otp", otpLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "ኢሜይል ያስፈልጋል" });

  const { data: user } = await supabase.from("users")
    .select("name, is_verified").eq("email", email).single();

  if (user && !user.is_verified) {
    storeAndSendOtp({ email, name: user.name }).catch(e => console.error("OTP resend failed:", e.message));
  }
  res.json({ success: true });
});

/* ─────────────────────────────────────────────────────────
   POST /api/auth/signin   { email, password }
───────────────────────────────────────────────────────── */
router.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "ኢሜይልና ፓስወርድ ያስፈልጋሉ" });

  const { data: user } = await supabase.from("users").select("*").eq("email", email).single();
  if (!user || !user.password) return res.status(401).json({ error: "ኢሜይል ወይም ፓስወርድ ስህተት" });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ error: "ኢሜይል ወይም ፓስወርድ ስህተት" });

  const { password: _, ...safe } = user;
  res.json({ token: makeToken(user.id), user: safe });
});

/* ─────────────────────────────────────────────────────────
   POST /api/auth/google   { access_token, intent?, city? }
   `access_token` is a Google OAuth token from the frontend
   (@react-oauth/google `useGoogleLogin`). We verify it is issued
   to OUR client id (tokeninfo) before trusting the profile.
   - existing user        → sign in
   - new user + role/city → create (auto-verified) and sign in
   - new user, no profile → ask the client to collect role + city
───────────────────────────────────────────────────────── */
router.post("/google", async (req, res) => {
  const { access_token, intent, city } = req.body;
  if (!access_token) return res.status(400).json({ error: "Google token ያስፈልጋል" });
  if (!process.env.GOOGLE_CLIENT_ID)
    return res.status(500).json({ error: "Google sign-in is not configured" });

  let email, name, emailVerified;
  try {
    // 1) Verify the token was minted for THIS app (prevents token replay from another client)
    const { data: info } = await axios.get("https://oauth2.googleapis.com/tokeninfo", { params: { access_token } });
    const aud = info.aud || info.azp;
    if (aud !== process.env.GOOGLE_CLIENT_ID)
      return res.status(401).json({ error: "Google token ለዚህ መተግበሪያ አይደለም" });

    // 2) Pull the profile (name + verified email)
    const { data: profile } = await axios.get("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    email         = profile.email || info.email;
    name          = profile.name || (email ? email.split("@")[0] : "User");
    emailVerified = profile.email_verified ?? (info.email_verified === "true" || info.email_verified === true);
  } catch (e) {
    console.error("Google verify failed:", e.response?.data || e.message);
    return res.status(401).json({ error: "Google ማረጋገጥ አልተሳካም" });
  }

  if (!email || !emailVerified)
    return res.status(401).json({ error: "የተረጋገጠ Google ኢሜይል ያስፈልጋል" });

  // Existing account → sign in
  const { data: existing } = await supabase.from("users").select(USER_FIELDS).eq("email", email).single();
  if (existing) return res.json({ token: makeToken(existing.id), user: existing });

  // New account needs a role + city before we can create it
  if (!intent || !city) return res.json({ needsProfile: true, email, name });

  const { data: user, error } = await supabase.from("users")
    .insert({ id: randomUUID(), name, email, password: null, intent, city, is_verified: true, auth_provider: "google" })
    .select(USER_FIELDS).single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ token: makeToken(user.id), user });
});

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
