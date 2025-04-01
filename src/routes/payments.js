const express  = require("express");
const { v4: uuidv4 } = require("uuid");
const supabase = require("../db/supabase");
const { requireAuth } = require("../middleware/auth");
const { uploadBase64Image } = require("../services/storage");
const {
  sendPaymentNotificationToAdmin,
  sendApprovalEmail,
  sendRejectionEmail,
} = require("../services/email");

const router = express.Router();

const PLANS = {
  monthly: { price: 49,  days: 30  },
  yearly:  { price: 399, days: 365 },
};

/* ─────────────────────────────────────────────────────────
   POST /api/payments/submit
   User submits a payment receipt screenshot after depositing.
   Uploads screenshot to Supabase Storage, saves payment record,
   and sends an email notification to the admin.
───────────────────────────────────────────────────────── */
router.post("/submit", requireAuth, async (req, res) => {
  const { plan, bank, screenshot, txRef } = req.body;

  if (!plan || !bank || !screenshot)
    return res.status(400).json({ error: "plan, bank and screenshot are required" });

  if (!PLANS[plan])
    return res.status(400).json({ error: "Invalid plan. Must be 'monthly' or 'yearly'" });

  // Prevent duplicate pending submissions
  const { data: existing } = await supabase
    .from("payments")
    .select("id")
    .eq("user_id", req.user.id)
    .eq("status", "pending")
    .single();

  if (existing)
    return res.status(409).json({ error: "You already have a pending payment waiting for approval" });

  // Upload screenshot to Supabase Storage
  let screenshotUrl;
  try {
    screenshotUrl = await uploadBase64Image(screenshot, "payment-receipts");
  } catch (e) {
    console.error("Screenshot upload failed:", e.message);
    return res.status(500).json({ error: "Failed to upload screenshot. Please try again." });
  }

  // Save payment record to database
  const { data: payment, error } = await supabase
    .from("payments")
    .insert({
      id:             uuidv4(),
      user_id:        req.user.id,
      plan,
      amount:         PLANS[plan].price,
      bank,
      screenshot_url: screenshotUrl,
      tx_ref:         txRef || null,
      status:         "pending",
    })
    .select("id, plan, amount, bank, status, created_at")
    .single();

  if (error) {
    console.error("Payment insert error:", error.message);
    return res.status(500).json({ error: "Failed to save payment record" });
  }

  // Send email notification to admin (non-blocking)
  sendPaymentNotificationToAdmin({
    userName:      req.user.name,
    userEmail:     req.user.email,
    plan,
    amount:        PLANS[plan].price,
    bank,
    screenshotUrl,
  }).catch(e => console.error("Admin notification email failed:", e.message));

  res.status(201).json({ payment });
});

/* ─────────────────────────────────────────────────────────
   GET /api/payments/my
   Returns the current user's own payment history.
───────────────────────────────────────────────────────── */
router.get("/my", requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from("payments")
    .select("id, plan, amount, bank, status, note, created_at, approved_at")
    .eq("user_id", req.user.id)
    .order("created_at", { ascending: false });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ payments: data });
});

/* ─────────────────────────────────────────────────────────
   GET /api/payments/all
   Admin only — returns all payments with user info.
   Supports ?status=pending|approved|rejected|all
───────────────────────────────────────────────────────── */
router.get("/all", requireAuth, async (req, res) => {
  // Only the admin email can access this endpoint
  const adminSecret = req.headers["x-admin-secret"];
if (adminSecret !== process.env.ADMIN_SECRET)
  return res.status(403).json({ error: "Admin access only" });

  const { status } = req.query;

  let query = supabase
    .from("payments")
    .select(`
      id, plan, amount, bank, screenshot_url, tx_ref,
      status, note, created_at, approved_at,
      user:users!payments_user_id_fkey(id, name, email)
    `)
    .order("created_at", { ascending: false });

  // Filter by status if provided (skip filter for "all")
  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  res.json({ payments: data });
});

/* ─────────────────────────────────────────────────────────
   POST /api/payments/:id/approve
   Admin only — approves a pending payment.
   1. Updates payment status to "approved"
   2. Sets user is_premium = true with correct expiry date
   3. Sends approval confirmation email to user
───────────────────────────────────────────────────────── */
router.post("/:id/approve", requireAuth, async (req, res) => {
const adminSecret = req.headers["x-admin-secret"];
if (adminSecret !== process.env.ADMIN_SECRET)
  return res.status(403).json({ error: "Admin access only" });

  // Fetch the payment with user info
  const { data: payment, error: fetchErr } = await supabase
    .from("payments")
    .select(`
      id, plan, amount, status,
      user:users!payments_user_id_fkey(id, name, email, is_premium)
    `)
    .eq("id", req.params.id)
    .single();

  if (fetchErr || !payment)
    return res.status(404).json({ error: "Payment not found" });

  if (payment.status === "approved")
    return res.status(400).json({ error: "Payment is already approved" });

  if (payment.status === "rejected")
    return res.status(400).json({ error: "Cannot approve a rejected payment. Ask user to resubmit." });

  // Calculate premium expiry date based on plan
  const planDays  = PLANS[payment.plan]?.days || 30;
  const expiresAt = new Date(Date.now() + planDays * 24 * 60 * 60 * 1000).toISOString();
  const now       = new Date().toISOString();

  // 1. Update payment status to approved
  const { error: payErr } = await supabase
    .from("payments")
    .update({ status: "approved", approved_at: now })
    .eq("id", payment.id);

  if (payErr) {
    console.error("Payment approve update error:", payErr.message);
    return res.status(500).json({ error: "Failed to update payment status" });
  }

  // 2. Upgrade user to premium
  const { error: userErr } = await supabase
    .from("users")
    .update({
      is_premium:     true,
      premium_plan:   payment.plan,
      premium_expiry: expiresAt,
    })
    .eq("id", payment.user.id);

  if (userErr) {
    console.error("User premium upgrade error:", userErr.message);
    return res.status(500).json({ error: "Payment approved but failed to upgrade user premium status" });
  }

  // 3. Send confirmation email to user (non-blocking)
  sendApprovalEmail({
    toEmail:  payment.user.email,
    toName:   payment.user.name,
    plan:     payment.plan,
    amount:   payment.amount,
    expiresAt,
  }).catch(e => console.error("Approval email failed:", e.message));

  res.json({
    success:    true,
    message:    `Payment approved. ${payment.user.name} is now ${payment.plan} premium until ${new Date(expiresAt).toLocaleDateString()}`,
    expiresAt,
  });
});

/* ─────────────────────────────────────────────────────────
   POST /api/payments/:id/reject
   Admin only — rejects a pending payment with a reason.
   1. Updates payment status to "rejected" with note
   2. Sends rejection email to user explaining why
───────────────────────────────────────────────────────── */
router.post("/:id/reject", requireAuth, async (req, res) => {
 const adminSecret = req.headers["x-admin-secret"];
 if (adminSecret !== process.env.ADMIN_SECRET)
  return res.status(403).json({ error: "Admin access only" });

  const { note } = req.body;
  if (!note?.trim())
    return res.status(400).json({ error: "A rejection reason is required so the user can fix and resubmit" });

  // Fetch payment with user info
  const { data: payment, error: fetchErr } = await supabase
    .from("payments")
    .select(`
      id, plan, amount, status,
      user:users!payments_user_id_fkey(id, name, email)
    `)
    .eq("id", req.params.id)
    .single();

  if (fetchErr || !payment)
    return res.status(404).json({ error: "Payment not found" });

  if (payment.status !== "pending")
    return res.status(400).json({ error: `Cannot reject a payment that is already '${payment.status}'` });

  // Update payment status to rejected
  const { error: updateErr } = await supabase
    .from("payments")
    .update({ status: "rejected", note: note.trim() })
    .eq("id", payment.id);

  if (updateErr) {
    console.error("Payment reject error:", updateErr.message);
    return res.status(500).json({ error: "Failed to update payment status" });
  }

  // Send rejection email to user (non-blocking)
  sendRejectionEmail({
    toEmail: payment.user.email,
    toName:  payment.user.name,
    reason:  note.trim(),
  }).catch(e => console.error("Rejection email failed:", e.message));

  res.json({
    success: true,
    message: `Payment rejected. ${payment.user.name} has been notified by email.`,
  });
});

module.exports = router;