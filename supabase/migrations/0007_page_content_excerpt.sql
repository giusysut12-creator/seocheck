-- Keep the start of each crawled page's visible text.
--
-- The crawler already walks a page's text to count its words. It threw that
-- text away and kept the number, which is enough to say "this page is thin"
-- and not enough to do anything about it: an assistant asked to improve a
-- product description knowing only the title invents materials, sizes and
-- licences. Keeping the first part of the real text is what makes a rewrite
-- grounded rather than plausible.
--
-- Deliberately an excerpt, not the whole page: 1500 characters is enough to
-- see what a page claims, and the full text of every page on a catalogue
-- would dominate the table for no extra insight.

alter table public.pages
  add column if not exists content_excerpt text;
