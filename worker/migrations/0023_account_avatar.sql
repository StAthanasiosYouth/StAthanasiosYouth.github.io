-- Accounts improvements, Step 1: the member's optional photo (forward-only, additive).
-- The bytes live in the private R2 bucket under avatars/; D1 holds the reference only (account/avatar.js).
ALTER TABLE participants ADD COLUMN avatar_key TEXT;
ALTER TABLE participants ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0;
