const express  = require("express");
const { randomUUID } = require("crypto");
const supabase = require("../db/supabase");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

router.post("/", requireAuth, async (req, res) => {
  const { postId } = req.body;
  if (!postId) return res.status(400).json({ error: "postId ያስፈልጋል" });

  const isPrem = req.user.is_premium && req.user.premium_expiry && new Date(req.user.premium_expiry) > new Date();
  if (!isPrem) return res.status(403).json({ error: "ለመገናኘት ፕሪሚየም ያስፈልጋል" });

  const { data: post } = await supabase.from("posts").select("id,owner_id").eq("id", postId).single();
  if (!post) return res.status(404).json({ error: "ቤቱ አልተገኘም" });
  if (post.owner_id === req.user.id) return res.status(400).json({ error: "የራስዎን ቤት ማያያዝ አይቻልም" });

  const { data: ex } = await supabase.from("connections").select("id").eq("renter_id", req.user.id).eq("post_id", postId).single();
  if (ex) return res.json({ connectionId: ex.id, alreadyConnected: true });

  const { data: conn, error } = await supabase.from("connections")
    .insert({ id: randomUUID(), renter_id: req.user.id, post_id: postId, owner_id: post.owner_id })
    .select("id").single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ connectionId: conn.id });
});

router.get("/", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("connections")
    .select(`id,created_at,post:posts(id,title,city,district,price,photo_url,owner_id,owner:users!posts_owner_id_fkey(id,name,phone,avatar_url))`)
    .eq("renter_id", req.user.id).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ connections: data });
});

router.get("/:id/messages", requireAuth, async (req, res) => {
  const { data: conn } = await supabase.from("connections").select("id")
    .eq("id", req.params.id).or(`renter_id.eq.${req.user.id},owner_id.eq.${req.user.id}`).single();
  if (!conn) return res.status(403).json({ error: "ፍቃድ የለዎትም" });

  const { data: msgs } = await supabase.from("messages").select("id,body,sender_id,created_at,read_at")
    .eq("connection_id", req.params.id).order("created_at", { ascending: true });
  await supabase.from("messages").update({ read_at: new Date().toISOString() })
    .eq("connection_id", req.params.id).neq("sender_id", req.user.id).is("read_at", null);
  res.json({ messages: msgs || [] });
});

router.post("/:id/messages", requireAuth, async (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: "መልዕክት ያስፈልጋል" });
  const { data: conn } = await supabase.from("connections").select("id")
    .eq("id", req.params.id).or(`renter_id.eq.${req.user.id},owner_id.eq.${req.user.id}`).single();
  if (!conn) return res.status(403).json({ error: "ፍቃድ የለዎትም" });
  const { data: msg, error } = await supabase.from("messages")
    .insert({ id: randomUUID(), connection_id: conn.id, sender_id: req.user.id, body: body.trim() })
    .select("id,body,sender_id,created_at").single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ message: msg });
});

module.exports = router;