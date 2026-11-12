-- Phase 8B W6 (B12, me-avatar.png): each admin's own photo, a small circle crop made in the panel
-- (≤ 200 KB, never on the public site). Additive: a new table; no admin row changes.
CREATE TABLE admin_avatars (
  email       TEXT PRIMARY KEY,                -- the admin (admins.email)
  image       TEXT NOT NULL,                   -- data:image/webp|jpeg|png;base64,…
  updated_ms  INTEGER NOT NULL
);
