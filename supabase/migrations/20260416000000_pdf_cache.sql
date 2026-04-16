git push origin master
-- PDF content cache: stores extracted text from OnQ PDFs keyed by URL.
-- Avoids re-downloading the same file on every question.
create table if not exists pdf_cache (
  url          text primary key,          -- OnQ file URL (stable identifier)
  text         text not null,             -- extracted plain text from the PDF
  cached_at    timestamptz default now()  -- when it was first cached
);

-- No RLS — this is a shared server-side cache read/written via service role only.
-- No user data is stored here, only course PDF content.

-- Index for fast lookups by URL (already covered by primary key, but explicit for clarity)
create index if not exists pdf_cache_url_idx on pdf_cache(url);
