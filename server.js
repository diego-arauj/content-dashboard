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

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true, limit: "5mb" }));

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
  const client = await pool.connect();
  try {
    const { id } = req.params;
    await client.query("BEGIN");
    // Delete all related data before removing the client
    await client.query("DELETE FROM instagram_accounts WHERE client_id = $1", [id]);
    await client.query("DELETE FROM posts_cache WHERE client_id = $1", [id]);
    await client.query("DELETE FROM account_insights_cache WHERE client_id = $1", [id]);
    await client.query("DELETE FROM users WHERE client_id = $1 AND role = 'client'", [id]);
    await client.query("DELETE FROM invite_tokens WHERE client_id = $1", [id]);
    await client.query("DELETE FROM clients WHERE id = $1", [id]);
    await client.query("COMMIT");
    return res.json({ ok: true });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ error: "Failed to delete client." });
  } finally {
    client.release();
  }
});

/** Clean up orphaned instagram_accounts rows whose client no longer exists */
app.post("/api/admin/cleanup-orphans", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM instagram_accounts
       WHERE client_id NOT IN (SELECT id FROM clients)
       RETURNING client_id, ig_user_id, username`
    );
    return res.json({ deleted: result.rows, count: result.rowCount });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Cleanup failed." });
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
    console.log(
      "[IG OAuth] pages returned:",
      JSON.stringify(
        pages?.data?.map((p) => ({ id: p.id, name: p.name })),
        null,
        2
      )
    );
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

    console.log("[IG OAuth] igUserId found:", igUserId, "username:", username);

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

/* ——— INSTAGRAM TOKEN STATUS ——— */

/** Returns token status for all instagram accounts (admin only). */
app.get("/api/instagram/token-status", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ia.client_id, c.name AS client_name, ia.username,
              ia.token_expires_at, ia.connected_at
       FROM instagram_accounts ia
       JOIN clients c ON c.id = ia.client_id
       ORDER BY c.name ASC`
    );
    const rows = result.rows.map((r) => {
      const expiresAt = r.token_expires_at ? new Date(r.token_expires_at) : null;
      const daysRemaining = expiresAt
        ? Math.round((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
      // "connected" = account exists but no expiry date tracked (legacy records)
      let status = "connected";
      if (expiresAt) {
        if (daysRemaining <= 0)  status = "expired";
        else if (daysRemaining <= 10) status = "critical";
        else if (daysRemaining <= 30) status = "warning";
        else status = "ok";
      }
      return {
        client_id: r.client_id,
        client_name: r.client_name,
        username: r.username,
        token_expires_at: r.token_expires_at,
        days_remaining: daysRemaining,
        status,
        connected_at: r.connected_at,
      };
    });
    return res.json(rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch token status." });
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
  date: "timestamp",
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
    const sortDir = req.query.dir === "asc" ? "ASC" : "DESC";

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
       ORDER BY ${sortCol} ${sortDir} NULLS LAST`,
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

/* ═══════════════════════════════════════════════════════
   AI ANALYSIS — powered by OpenRouter
═══════════════════════════════════════════════════════ */

/** Baixa uma imagem e devolve data-URI base64; null se falhar/expirar.
    Limita o tamanho para não estourar memória do container. */
async function fetchImageBase64(url, maxBytes = 1_500_000) {
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "ContentDashboard/1.0" },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) return null;
    const mime = (r.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    if (!mime.startsWith("image/")) return null;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

app.post("/api/ai/analysis", requireClientAccess, async (req, res) => {
  try {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
      return res.status(503).json({ error: "OPENROUTER_API_KEY não configurada no servidor." });
    }

    const posts    = Array.isArray(req.body.posts)    ? req.body.posts    : [];
    const overview = Array.isArray(req.body.overview) ? req.body.overview : [];
    const period      = typeof req.body.period      === "string" ? req.body.period      : "";
    const clientName  = typeof req.body.clientName  === "string" ? req.body.clientName  : "";
    const customPrompt= typeof req.body.customPrompt=== "string" ? req.body.customPrompt: "";

    /* Formatador numérico sem toLocaleString (pode não existir no container) */
    const fmtN = (n) => {
      const v = Number(n) || 0;
      if (v >= 1e6) return (v / 1e6).toFixed(1).replace(".", ",") + "M";
      if (v >= 1e3) return (v / 1e3).toFixed(1).replace(".", ",") + "k";
      return String(Math.round(v));
    };

    const totalPosts    = posts.length;
    const totalReach    = overview.reduce((s, r) => s + (Number(r.reach)    || 0), 0);
    const totalLikes    = posts.reduce((s, p)    => s + (Number(p.likes)    || 0), 0);
    const totalComments = posts.reduce((s, p)    => s + (Number(p.comments) || 0), 0);
    const totalShares   = posts.reduce((s, p)    => s + (Number(p.shares)   || 0), 0);

    const fmtCount = { VIDEO: 0, IMAGE: 0, CAROUSEL_ALBUM: 0 };
    for (const p of posts) { if (fmtCount[p.media_type] !== undefined) fmtCount[p.media_type]++; }

    const top6Reach    = [...posts].sort((a,b) => (Number(b.reach)||0)    - (Number(a.reach)||0)   ).slice(0, 6);
    const top6Likes    = [...posts].sort((a,b) => (Number(b.likes)||0)    - (Number(a.likes)||0)   ).slice(0, 6);
    const top6Comments = [...posts].sort((a,b) => (Number(b.comments)||0) - (Number(a.comments)||0)).slice(0, 6);
    const top6Shares   = [...posts].sort((a,b) => (Number(b.shares)||0)   - (Number(a.shares)||0)  ).slice(0, 6);

    const fmtCaption = (c) => {
      if (!c || !String(c).trim()) return "(sem legenda)";
      return String(c).trim().replace(/\n+/g, " ").slice(0, 200);
    };

    const fmtRow = (p, i) =>
      `${i + 1}. ${p.media_type || "?"} | alcance: ${fmtN(p.reach)} | curtidas: ${fmtN(p.likes)} | coment.: ${fmtN(p.comments)} | compart.: ${fmtN(p.shares)} | legenda: "${fmtCaption(p.caption)}"`;

    const prompt = [
      "Você é um estrategista de social media especializado em influenciadores brasileiros de grande porte. Analise os dados e os quatro pódios abaixo e responda em português.",
      "",
      `Cliente: ${clientName}`,
      `Período: ${period}`,
      `Posts publicados: ${totalPosts}`,
      `Formatos: ${fmtCount.VIDEO} vídeos / ${fmtCount.IMAGE} imagens / ${fmtCount.CAROUSEL_ALBUM} carrosséis`,
      /* Sem insights de conta no período, "alcance total: 0" seria um zero
         falso e a IA analisaria um dado que não existe. Melhor omitir. */
      ...(overview.length > 0
        ? [`Alcance total: ${fmtN(totalReach)}`]
        : ["Alcance total da conta: não disponível para este período (use o alcance por post nos pódios abaixo)"]),
      `Curtidas totais: ${fmtN(totalLikes)}`,
      `Comentários totais: ${fmtN(totalComments)}`,
      `Compartilhamentos totais: ${fmtN(totalShares)}`,
      "",
      "TOP 6 — ALCANCE:",
      ...top6Reach.map(fmtRow),
      "",
      "TOP 6 — CURTIDAS:",
      ...top6Likes.map(fmtRow),
      "",
      "TOP 6 — COMENTÁRIOS:",
      ...top6Comments.map(fmtRow),
      "",
      "TOP 6 — COMPARTILHAMENTOS:",
      ...top6Shares.map(fmtRow),
      "",
      "Responda com exatamente duas seções, sem markdown com asteriscos:",
      "",
      "O QUE FUNCIONOU:",
      "(tópicos curtos — temas, formatos, padrões visuais (cenário, pessoas, estilo) e de legenda que se repetem nos pódios; destaque posts que aparecem em múltiplos rankings como sinal forte)",
      "",
      "SUGESTÕES PARA O PRÓXIMO MÊS:",
      "(3 a 5 sugestões específicas e acionáveis baseadas nos padrões identificados)",
      "",
      "Seja direto. Máximo 220 palavras no total.",
      ...(customPrompt ? ["", `Instruções adicionais do gestor: ${customPrompt}`] : []),
    ].join("\n");

    console.log("[ai] Prompt length:", prompt.length, "chars");

    /* ── Coleta imagens dos pódios (deduplicadas, limitadas) e baixa em base64 ──
       O CDN do Instagram costuma bloquear acesso server-side de terceiros,
       então convertemos aqui para garantir a entrega ao modelo. */
    const MAX_IMAGES = 10;
    const ordered = [...top6Reach, ...top6Shares, ...top6Likes, ...top6Comments];
    const seen = new Set();
    const imageCandidates = [];
    for (const p of ordered) {
      const url = p.thumbnail_url || p.media_url;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const dateStr = p.timestamp ? new Date(p.timestamp).toISOString().slice(0, 10) : "s/data";
      imageCandidates.push({ url, label: `Post ${dateStr} — ${p.media_type || "?"} | alcance ${fmtN(p.reach)}, compart. ${fmtN(p.shares)}` });
      if (imageCandidates.length >= MAX_IMAGES) break;
    }

    const fetched = await Promise.all(imageCandidates.map(c => fetchImageBase64(c.url)));
    const images = imageCandidates
      .map((c, i) => ({ ...c, data: fetched[i] }))
      .filter(c => c.data);
    console.log("[ai] Images:", `${images.length}/${imageCandidates.length} baixadas`);

    /* Monta o conteúdo: texto + imagens (se houver) */
    let content;
    if (images.length) {
      content = [
        { type: "text", text: prompt + "\n\nA seguir, as miniaturas dos principais posts do período. Use-as para identificar padrões VISUAIS de conteúdo (cenário, pessoas, estilo) e relacione com os números acima:" },
      ];
      for (const img of images) {
        content.push({ type: "text", text: img.label });
        content.push({ type: "image_url", image_url: { url: img.data } });
      }
    } else {
      content = prompt;
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
        "X-Title": "Content Dashboard",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content }],
        max_tokens: 700,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(90000),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[ai] OpenRouter error:", response.status, errText.slice(0, 500));
      return res.status(502).json({ error: `Erro na API de IA (${response.status}). Verifique a chave OpenRouter.` });
    }

    const data = await response.json();
    const analysis = data.choices?.[0]?.message?.content?.trim() || "";
    console.log("[ai] Analysis OK, length:", analysis.length);
    return res.json({ analysis });

  } catch (err) {
    console.error("[ai] Unhandled error:", err?.message || err);
    if (!res.headersSent) {
      return res.status(500).json({ error: "Erro interno: " + (err?.message || "desconhecido") });
    }
  }
});

app.use(express.static(process.env.STATIC_DIR || "/app/public"));

/* Error handler global — garante que qualquer erro (inclusive do parser
   de JSON, ex: corpo grande demais) retorne JSON e não HTML/502. */
app.use((err, req, res, next) => {
  console.error("[error-handler]", err?.type || "", err?.message || err);
  if (res.headersSent) return next(err);
  const status = err?.status || err?.statusCode || 500;
  res.status(status).json({ error: err?.message || "Erro interno do servidor." });
});

/* Não deixar uma exceção/rejeição não tratada derrubar o processo */
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});

cron.schedule("0 */2 * * *", async () => {
  console.log("[cron] Starting scheduled sync for all clients...");
  try {
    const clients = await pool.query("SELECT id FROM clients");
    for (const client of clients.rows) {
      try {
        await syncInstagramForClient(client.id, { days: 730 });
      } catch (err) {
        console.error(`[cron] sync failed for ${client.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[cron] Failed to fetch clients:", err.message);
  }
});
