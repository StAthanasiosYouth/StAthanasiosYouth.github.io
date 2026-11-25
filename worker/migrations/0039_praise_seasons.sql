-- «خبزنا اليومي» P5b (owner 2026-11-25): a praise can be set for a whole season (coptic.js SEASONS).
-- The two of the Virgin the review named for one: «الصوم هو أول وصية» → صوم العذراء (still a candidate: its text waits
-- for the owner), «يا م ر ي م» → شهر كيهك. Only while each is still where 0038 put it and has no seasons; rev + 1.
UPDATE saints_items SET data = json_set(data, '$.praises[3].seasons', json('["virgin-fast"]')), rev = rev + 1, updated_at = 0, updated_by = 'P5b seasons' WHERE kind = 'person' AND id = 'mary' AND json_extract(data, '$.praises[3].title') = 'الصوم هو أول وصية' AND json_extract(data, '$.praises[3].seasons') IS NULL;
UPDATE saints_items SET data = json_set(data, '$.praises[4].seasons', json('["kiahk"]')), rev = rev + 1, updated_at = 0, updated_by = 'P5b seasons' WHERE kind = 'person' AND id = 'mary' AND json_extract(data, '$.praises[4].title') = 'يا م ر ي م' AND json_extract(data, '$.praises[4].seasons') IS NULL;
