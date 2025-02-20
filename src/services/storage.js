const supabase = require("../db/supabase");
const { randomUUID } = require("crypto");

async function uploadBase64Image(base64DataUrl, bucket) {
  const matches = base64DataUrl.match(/^data:(.+);base64,(.+)$/);
  if (!matches) throw new Error("Invalid base64 image");

  const mimeType  = matches[1];
  const base64    = matches[2];
  const extension = mimeType.split("/")[1] || "jpg";
  const filename  = `${randomUUID()}.${extension}`;
  const buffer    = Buffer.from(base64, "base64");

  const { error } = await supabase.storage
    .from(bucket)
    .upload(filename, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Upload failed: ${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(filename);
  return data.publicUrl;
}

module.exports = { uploadBase64Image };