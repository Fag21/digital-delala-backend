const express  = require("express");
const bcrypt   = require("bcryptjs");
const jwt      = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const supabase = require("../db/supabase");
const { requireAuth } = require("../middleware/auth");

const router   = express.Router();
const makeToken = (id) => jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

router.post("/signup", async (req, res) => {
  const { name, email, password, intent, city } = req.body;
  if (!name || !email || !password || !intent || !city)
    return res.status(400).json({ error: "ሁሉም መስኮች ያስፈልጋሉ" });

  const { data: ex } = await supabase.from("users").select("id").eq("email", email).single();
  if (ex) return res.status(409).json({ error: "ይህ ኢሜይል ተመዝግቧል" });

  const hashed = await bcrypt.hash(password, 12);
  const { data: user, error } = await supabase.from("users")
    .insert({ id: randomUUID(), name, email, password: hashed, intent, city })
    .select("id, name, email, intent, city, is_premium, premium_plan, premium_expiry").single();
  if (error) return res.status(500).json({ error: error.message });

  res.status(201).json({ token: makeToken(user.id), user });
});

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

router.get("/me", requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;