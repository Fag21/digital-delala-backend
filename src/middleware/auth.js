const jwt      = require("jsonwebtoken");
const supabase = require("../db/supabase");

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "ያልተፈቀደ ትዕዛዝ" });
  }
  const token = header.split(" ")[1];
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "ቶከን ልክ ያልሆነ ወይም ጊዜው ያለፈ" });
  }
  const { data: user, error } = await supabase
    .from("users")
    .select("id, name, email, intent, city, is_premium, premium_plan, premium_expiry")
    .eq("id", payload.sub)
    .single();
  if (error || !user) return res.status(401).json({ error: "ተጠቃሚ አልተገኘም" });
  req.user = user;
  next();
}

module.exports = { requireAuth };