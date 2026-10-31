-- Accounts improvements, Step 2 fix: the first-time walkthrough shows once per account, on any device (forward-only, additive).
ALTER TABLE participants ADD COLUMN onboarded_at INTEGER;
