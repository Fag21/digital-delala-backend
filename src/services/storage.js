const supabase = require("../db/supabase");
const { randomUUID, createHash } = require("crypto");
const imageSize = require("image-size");

/* ─────────────────────────────────────────────────────────
   Server-side image validation + upload.

   Client-side checks (browser) are advisory only — a malicious
   user can bypass them and POST any base64 string. Everything
   below is enforced on the *decoded bytes*, never on the
   attacker-controlled `data:` MIME prefix.
───────────────────────────────────────────────────────── */

// Keep in sync with the frontend hint ("JPG, PNG or WEBP · max 8MB").
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const MIN_DIMENSION = 100;         // px — anything smaller is junk / tracking pixel
const MAX_DIMENSION = 10000;       // px — guards against decompression-bomb dimensions

// image-size reports these `type` strings; map them to canonical extension + MIME.
const ALLOWED = {
  jpg:  { ext: "jpg",  mime: "image/jpeg" },
  jpeg: { ext: "jpg",  mime: "image/jpeg" },
  png:  { ext: "png",  mime: "image/png"  },
  webp: { ext: "webp", mime: "image/webp" },
};

/**
 * Decode a base64 data-URL, validate it is a real allowed image within
 * size/dimension limits, and compute its content hash.
 *
 * @returns {{ buffer: Buffer, hash: string, type: string, ext: string,
 *             mime: string, width: number, height: number, size: number }}
 * @throws  {Error} with a user-safe `.message` and a `.status` (400) on bad input.
 */
function decodeAndValidateImage(base64DataUrl) {
  if (typeof base64DataUrl !== "string")
    throw badRequest("ትክክለኛ ምስል አልተላከም"); // No valid image provided

  const matches = base64DataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!matches) throw badRequest("ትክክለኛ ምስል አልተላከም");

  const base64 = matches[2];
  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    throw badRequest("ትክክለኛ ምስል አልተላከም");
  }

  if (!buffer.length) throw badRequest("ትክክለኛ ምስል አልተላከም");

  if (buffer.length > MAX_BYTES)
    throw badRequest("ምስሉ በጣም ትልቅ ነው። ከ8 ሜባ መብለጥ የለበትም"); // Too large, max 8MB

  // Detect the *real* format from the bytes (ignores the data-URL prefix).
  let dim;
  try {
    dim = imageSize(buffer);
  } catch {
    throw badRequest("ትክክለኛ ምስል አይደለም"); // Not a valid image
  }

  const spec = ALLOWED[dim.type];
  if (!spec)
    throw badRequest("የተፈቀደ የምስል አይነት JPG, PNG ወይም WEBP ብቻ ነው"); // Only JPG/PNG/WEBP allowed

  if (!dim.width || !dim.height ||
      dim.width  < MIN_DIMENSION || dim.height < MIN_DIMENSION ||
      dim.width  > MAX_DIMENSION || dim.height > MAX_DIMENSION)
    throw badRequest("የምስሉ መጠን ተቀባይነት የለውም"); // Unacceptable image dimensions

  const hash = createHash("sha256").update(buffer).digest("hex");

  return {
    buffer,
    hash,
    type:   dim.type,
    ext:    spec.ext,
    mime:   spec.mime,
    width:  dim.width,
    height: dim.height,
    size:   buffer.length,
  };
}

/**
 * Upload an already-validated buffer to a Storage bucket.
 * @returns {Promise<string>} public URL
 */
async function uploadImageBuffer(buffer, bucket, mime, ext) {
  const filename = `${randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, buffer, { contentType: mime, upsert: false });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}

/**
 * Validate + upload a base64 data-URL image in one step.
 * @returns {Promise<{ url: string, hash: string, type: string,
 *                      width: number, height: number, size: number }>}
 */
async function uploadBase64Image(base64DataUrl, bucket) {
  const img = decodeAndValidateImage(base64DataUrl);
  const url = await uploadImageBuffer(img.buffer, bucket, img.mime, img.ext);
  return {
    url,
    hash:   img.hash,
    type:   img.type,
    width:  img.width,
    height: img.height,
    size:   img.size,
  };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

module.exports = {
  uploadBase64Image,
  decodeAndValidateImage,
  uploadImageBuffer,
};
