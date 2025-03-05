const express  = require("express");
const { randomUUID } = require("crypto");
const supabase = require("../db/supabase");
const { sendHelpTicket } = require("../services/email");

const router = express.Router();

router.post("/", async (req, res) => {
  const { name, email, type, message } = req.body;
  if (!name || !email || !type || !message)
    return res.status(400).json({ error: "ሁሉም መስኮች ያስፈልጋሉ" });

  await supabase.from("help_tickets").insert({
    id: randomUUID(), name, email, type, message
  });

  sendHelpTicket({ name, email, type, message })
    .catch(e => console.error("Help email failed:", e.message));

  res.status(201).json({ success: true });
});

module.exports = router;