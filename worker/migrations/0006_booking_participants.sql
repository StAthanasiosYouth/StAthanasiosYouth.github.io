-- 0006 booking participants (Phase 1): «كل فرد باسمه وسنه» — the people of a
-- booking, one by one, each priced by age. JSON [{ name, age, cat }]; the
-- counts (requested) are derived from it on the server, so prices, seats,
-- capacity and accounting work exactly as before. NULL for counter bookings.
ALTER TABLE bookings ADD COLUMN participants TEXT;
