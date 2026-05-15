const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const bcrypt = require("bcrypt");
const cron = require("node-cron");
const pool = require("./lib/db");
const { encrypt } = require("./lib/encryption");
const {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  getFacebookPages,
  getInstagramBusinessAccount,
  syncInstagramForClient,
} = require("./lib/instagram");

const PORT = process.env.PORT || 3000;
const app = express();

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-insecure-session-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
    },
  })
);

function isPublicApiRoute(req) {
  const p = req.path;
  if (req.method === "POST" && p === "/auth/login") {
    return true;
  }
  if (req.method === "POST" && p === "/auth/logout") {
    return true;
  }
  if (req.method === "GET" && p === "/auth/instagram/callback") {
    return true;
  }
  if (req.method === "GET" && /^\/invites\/[^/]+$/.test(p)) {
    return true;
  }
  if (req.method === "POST" && /^\/invites\/[^/]+\/accept$/.test(p)) {
    return true;
  }
  return false;
}

/** Require a logged-in session for /api/* except explicit public routes. */
function requireApiSession(req, res, next) {
  if (isPublicApiRoute(req)) {
    return next();
  }
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.role !== "admin") {
    return res.status(403).json({ error: "Forbidden" });
  }
  next();
}

/** Admins: any client. Clients: only their own clientId (must match param). */
function requireClientAccess(req, res, next) {
  const { clientId } = req.params;
  if (req.session.role === "admin") {
    return next();
  }
  if (req.session.role === "client" && String(req.session.clientId) === String(clientId)) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
}

app.use("/api", requireApiSession);

app.post("/api/auth/login", async (req, res) => {
  try {
    const email = req.body?.email;
    const password = req.body?.password;
    if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await pool.query(
      "SELECT id, password_hash, role, client_id FROM users WHERE email = $1",
      [email.trim()]
    );
    const row = result.rows[0];

    if (!row) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const match = await bcrypt.compare(password, row.password_hash);
    if (!match) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    if (row.role !== "admin" && row.role !== "client") {
      return res.status(403).json({ error: "Invalid role." });
    }

    req.session.userId = row.id;
    req.session.role = row.role;
    req.session.clientId = row.client_id ?? null;

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: "Could not log out." });
    }
    return res.json({ ok: true });
  });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return res.json({
    userId: req.session.userId,
    role: req.session.role,
    clientId: req.session.clientId ?? null,
  });
});

/* ——— CLIENTS (admin) ——— */

app.get("/api/clients", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, niche, created_at FROM clients ORDER BY created_at DESC"
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to list clients." });
  }
});

app.post("/api/clients", requireAdmin, async (req, res) => {
  try {
    const name = req.body?.name;
    const nicheRaw = req.body?.niche;
    const niche = typeof nicheRaw === "string" ? nicheRaw : null;
    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "name is required." });
    }
    const result = await pool.query(
      `INSERT INTO clients (name, niche) VALUES ($1, $2)
       RETURNING id, name, niche, created_at`,
      [name.trim(), niche]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create client." });
  }
});

app.delete("/api/clients/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM clients WHERE id = $1", [id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to delete client." });
  }
});

/* ——— INSTAGRAM OAUTH ——— */

const META_OAUTH_SCOPES = [
  "instagram_basic",
  "instagram_manage_insights",
  "pages_read_engagement",
  "pages_show_list",
].join(",");

app.get("/api/auth/instagram/start/:clientId", requireAdmin, async (req, res) => {
  try {
    const appId = process.env.META_APP_ID;
    const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
    if (!appId || !baseUrl) {
      return res.status(500).json({ error: "META_APP_ID and BASE_URL must be configured." });
    }

    const redirectUri = `${baseUrl}/api/auth/instagram/callback`;
    const state = String(req.params.clientId);
    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("scope", META_OAUTH_SCOPES);
    url.searchParams.set("response_type", "code");

    return res.redirect(302, url.toString());
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to start OAuth." });
  }
});

app.get("/api/auth/instagram/callback", async (req, res) => {
  const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
  const query = req.query || {};
  const errMsg = query.error_description || query.error;
  const clientIdFromState = query.state != null ? String(query.state) : "";
  const redirect = (extraQuery) => {
    const dest = `${baseUrl}/dashboard.html?client=${encodeURIComponent(clientIdFromState)}${extraQuery ? `&${extraQuery}` : ""}`;
    return res.redirect(302, dest);
  };

  if (errMsg) {
    return redirect(`oauth_error=${encodeURIComponent(String(errMsg))}`);
  }

  const code = query.code;
  if (!code || !clientIdFromState) {
    return redirect("oauth_error=missing_code_or_state");
  }

  try {
    const redirectUri = `${baseUrl}/api/auth/instagram/callback`;
    const short = await exchangeCodeForShortLivedToken(String(code), redirectUri);
    const shortToken = short.access_token;
    if (!shortToken) {
      return redirect("oauth_error=no_access_token");
    }

    const long = await exchangeForLongLivedToken(shortToken);
    const longToken = long.access_token;
    if (!longToken) {
      return redirect("oauth_error=no_long_lived_token");
    }

    const expiresIn = typeof long.expires_in === "number" ? long.expires_in : null;
    const tokenExpiresAt =
      expiresIn != null ? new Date(Date.now() + expiresIn * 1000) : null;

    const pages = await getFacebookPages(longToken);
    let igUserId = null;
    let username = "";

    for (const page of pages.data || []) {
      const ig = await getInstagramBusinessAccount(page.id, page.access_token);
      const ib = ig.instagram_business_account;
      if (ib && ib.id) {
        igUserId = ib.id;
        username = ib.username || "";
        break;
      }
    }

    if (!igUserId) {
      return redirect("oauth_error=no_instagram_account");
    }

    const enc = encrypt(longToken);

    await pool.query(
      `INSERT INTO instagram_accounts (
        client_id,
        ig_user_id,
        username,
        access_token,
        token_expires_at,
        connected_at
      ) VALUES ($1, $2, $3, $4, $5, now())
      ON CONFLICT (ig_user_id) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        username = EXCLUDED.username,
        access_token = EXCLUDED.access_token,
        token_expires_at = EXCLUDED.token_expires_at,
        connected_at = now()`,
      [clientIdFromState, igUserId, username, enc, tokenExpiresAt]
    );

    return redirect("");
  } catch (err) {
    console.error(err);
    const msg = err instanceof Error ? err.message : "oauth_failed";
    return redirect(`oauth_error=${encodeURIComponent(msg)}`);
  }
});

/* ——— SYNC ——— */

app.post(
  "/api/instagram/sync/:clientId",
  requireClientAccess,
  async (req, res) => {
    try {
      await syncInstagramForClient(req.params.clientId, req.body && typeof req.body === "object" ? req.body : {});
      return res.json({ ok: true });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed." });
    }
  }
);

app.get("/api/instagram/sync/:clientId", requireClientAccess, async (req, res) => {
  try {
    await syncInstagramForClient(req.params.clientId, {});
    return res.json({ ok: true, redirect: false });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err instanceof Error ? err.message : "Sync failed." });
  }
});

/* ——— DASHBOARD DATA ——— */

app.get(
  "/api/dashboard/:clientId/overview",
  requireClientAccess,
  async (req, res) => {
    try {
      const { clientId } = req.params;
      const start = req.query.start;
      const end = req.query.end;
      if (typeof start !== "string" || typeof end !== "string") {
        return res.status(400).json({ error: "Query params start and end are required." });
      }

      const result = await pool.query(
        `SELECT id, client_id, date, followers, reach, impressions, profile_views, website_clicks
         FROM account_insights_cache
         WHERE client_id = $1 AND date >= $2 AND date <= $3
         ORDER BY date ASC`,
        [clientId, start, end]
      );
      return res.json(result.rows);
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: "Failed to load overview." });
    }
  }
);

const POSTS_SORT_COLUMNS = {
  likes: "likes",
  reach: "reach",
  comments: "comments",
  shares: "shares",
  saved: "saved",
};

app.get("/api/dashboard/:clientId/posts", requireClientAccess, async (req, res) => {
  try {
    const { clientId } = req.params;
    const start = req.query.start;
    const end = req.query.end;
    if (typeof start !== "string" || typeof end !== "string") {
      return res.status(400).json({ error: "Query params start and end are required." });
    }

    const sortKey = req.query.sort;
    const sortCol =
      typeof sortKey === "string" && POSTS_SORT_COLUMNS[sortKey]
        ? POSTS_SORT_COLUMNS[sortKey]
        : "likes";

    const fmt = req.query.format;
    const values = [clientId, start, end];
    let formatClause = "";
    if (typeof fmt === "string" && fmt.length > 0) {
      values.push(fmt);
      formatClause = ` AND media_type = $${values.length}`;
    }

    const result = await pool.query(
      `SELECT *
       FROM posts_cache
       WHERE client_id = $1 AND timestamp >= $2::timestamp AND timestamp <= $3::timestamp${formatClause}
       ORDER BY ${sortCol} DESC NULLS LAST`,
      values
    );
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load posts." });
  }
});

app.get("/api/dashboard/:clientId/profile", requireClientAccess, async (req, res) => {
  try {
    const { clientId } = req.params;
    const result = await pool.query(
      `SELECT followers_count, username, profile_picture_url
       FROM instagram_accounts
       WHERE client_id = $1
       LIMIT 1`,
      [clientId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No Instagram account for this client." });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to load profile." });
  }
});

/* ——— INVITES ——— */

async function sendInviteEmail(toEmail, token, clientId) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "onboarding@resend.dev";
  const baseUrl = (process.env.BASE_URL || "").replace(/\/$/, "");
  const link =
    baseUrl ? `${baseUrl}/login.html?inviteToken=${encodeURIComponent(token)}` : `(configure BASE_URL) token: ${token}`;

  if (!apiKey) {
    console.warn("RESEND_API_KEY not set; invite email not sent.");
    return;
  }

  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: toEmail,
      subject: "Your dashboard invite",
      html: `<p>You've been invited. Open <a href="${link}">this link</a> to accept (client ${clientId}).</p>`,
    }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Resend error ${r.status}: ${text}`);
  }
}

app.post("/api/clients/:clientId/invite", requireAdmin, async (req, res) => {
  try {
    const { clientId } = req.params;
    const email = req.body?.email;
    if (typeof email !== "string" || !email.trim()) {
      return res.status(400).json({ error: "email is required." });
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO invite_tokens (token, email, client_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [token, email.trim().toLowerCase(), clientId, expiresAt]
    );

    try {
      await sendInviteEmail(email.trim().toLowerCase(), token, clientId);
    } catch (mailErr) {
      console.error(mailErr);
      return res.status(502).json({ error: "Invite created but email failed to send.", token });
    }

    return res.json({ token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to create invite." });
  }
});

app.get("/api/invites/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const result = await pool.query(
      `SELECT email, client_id, expires_at, used_at
       FROM invite_tokens
       WHERE token = $1`,
      [token]
    );
    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Invalid token." });
    }
    if (row.used_at != null) {
      return res.status(400).json({ error: "Token already used." });
    }
    if (new Date(row.expires_at) < new Date()) {
      return res.status(400).json({ error: "Token expired." });
    }
    return res.json({ email: row.email, clientId: row.client_id });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to validate token." });
  }
});

app.post("/api/invites/:token/accept", async (req, res) => {
  const { token } = req.params;
  const password = req.body?.password;
  const name =
    typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim() : "";

  if (typeof password !== "string" || password.length < 8) {
    return res.status(400).json({ error: "password is required (min 8 characters)." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lock = await client.query(
      `SELECT id, email, client_id, expires_at, used_at
       FROM invite_tokens
       WHERE token = $1
       FOR UPDATE`,
      [token]
    );
    const invite = lock.rows[0];
    if (!invite) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Invalid token." });
    }
    if (invite.used_at != null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Token already used." });
    }
    if (new Date(invite.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Token expired." });
    }

    const existing = await client.query("SELECT id FROM users WHERE email = $1", [invite.email]);
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An account with this email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await client.query(
      `INSERT INTO users (name, email, password_hash, role, client_id)
       VALUES ($1, $2, $3, 'client', $4)`,
      [name, invite.email, passwordHash, invite.client_id]
    );
    await client.query(
      `UPDATE invite_tokens SET used_at = now() WHERE token = $1`,
      [token]
    );

    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ error: "Could not accept invite." });
  } finally {
    client.release();
  }
});

app.use(express.static("public"));

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});

cron.schedule("0 */2 * * *", async () => {
  console.log("[cron] Starting scheduled sync for all clients...");
  try {
    const clients = await pool.query("SELECT id FROM clients");
    for (const client of clients.rows) {
      try {
        await syncInstagramForClient(client.id, { days: 3 });
        console.log(`[cron] Synced client ${client.id}`);
      } catch (err) {
        console.error(`[cron] Failed to sync client ${client.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[cron] Failed to fetch clients:", err.message);
  }
});
