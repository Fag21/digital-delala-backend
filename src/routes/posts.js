const express  = require("express");
const { randomUUID } = require("crypto");
const supabase = require("../db/supabase");
const { requireAuth } = require("../middleware/auth");
const { uploadBase64Image } = require("../services/storage");

const router = express.Router();

router.get("/", async (req, res) => {
  const { city, kind, search, page = 1, limit = 20 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let q = supabase.from("posts")
    .select(`id,title,description,address,district,city,city_en,price,negotiable,kind,type,beds,baths,sqm,photo_url,views,created_at,owner:users!posts_owner_id_fkey(id,name,phone,avatar_url)`, { count: "exact" })
    .eq("is_active", true).order("created_at", { ascending: false })
    .range(offset, offset + Number(limit) - 1);

  if (city)   q = q.eq("city", city);
  if (kind)   q = q.eq("kind", kind);
  if (search) q = q.or(`title.ilike.%${search}%,district.ilike.%${search}%`);

  const { data, error, count } = await q;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ posts: data, total: count, page: Number(page) });
});

router.get("/mine", requireAuth, async (req, res) => {
  const { data, error } = await supabase.from("posts").select("*")
    .eq("owner_id", req.user.id).eq("is_active", true).order("created_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ posts: data });
});

router.get("/:id", async (req, res) => {
  const { data: post, error } = await supabase.from("posts")
    .select(`*,owner:users!posts_owner_id_fkey(id,name,phone,avatar_url,city)`)
    .eq("id", req.params.id).single();
  if (error || !post) return res.status(404).json({ error: "ቤቱ አልተገኘም" });
  supabase.rpc("increment_views", { post_uuid: post.id }).then(() => {});
  res.json({ post });
});

router.post("/", requireAuth, async (req, res) => {
  const { title, description, address, district, city, city_en,
          price, negotiable, kind, type, beds, baths, sqm, photo } = req.body;
  if (!title || !address || !city || !price) return res.status(400).json({ error: "ርዕስ፣ አድራሻ፣ ከተማ እና ዋጋ ያስፈልጋሉ" });
  if (!photo) return res.status(400).json({ error: "ፎቶ ያስፈልጋል" });

  let photoUrl;
  try {
    ({ url: photoUrl } = await uploadBase64Image(photo, "post-photos"));
  } catch (e) {
    // Validation failures carry a user-safe message + 400; everything else is a 500.
    if (e.status === 400) return res.status(400).json({ error: e.message });
    return res.status(500).json({ error: "ፎቶ ሊጫን አልቻለም" });
  }

  const { data: post, error } = await supabase.from("posts")
    .insert({ id: randomUUID(), owner_id: req.user.id, title, description, address,
      district: district || city, city, city_en, price: Number(price),
      negotiable: Boolean(negotiable), kind: kind || "living",
      type: type || "አፓርትመንት", beds: Number(beds) || 0,
      baths: Number(baths) || 0, sqm: Number(sqm) || 0, photo_url: photoUrl })
    .select("*").single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json({ post });
});

router.delete("/:id", requireAuth, async (req, res) => {
  const { data: ex } = await supabase.from("posts").select("owner_id").eq("id", req.params.id).single();
  if (!ex) return res.status(404).json({ error: "ቤቱ አልተገኘም" });
  if (ex.owner_id !== req.user.id) return res.status(403).json({ error: "ፍቃድ የለዎትም" });
  await supabase.from("posts").update({ is_active: false }).eq("id", req.params.id);
  res.json({ success: true });
});

module.exports = router;