// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2";
import { Router, IRequest } from "npm:itty-router@4";
import pdf from "npm:pdf-parse@1.1.1";
import mammoth from "npm:mammoth@1.7.2";

// --- CORS ---
// It's a good practice to handle CORS for requests from a browser.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// --- Types ---
// It's helpful to define types for your API, mirroring study-mcp-app/src/types/index.ts
interface PiazzaSyncRequestBody {
  courseId?: string;
  sinceDays?: number;
  maxPosts?: number;
  highSignalOnly?: boolean;
}

interface PresignUploadRequestBody {
  filename: string;
  contentType: string;
  size: number;
}

interface ProcessNoteRequestBody {
  storagePath: string;
  title: string;
  courseId?: string;
  bucket?: string;
}

// --- Supabase Service Role Client ---
// Use this for operations that require bypassing RLS, like writing to protected tables.
const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// --- File Processing Helpers ---
// Ported and adapted from d2l-mcp/src/tools/files.ts for Deno environment.
// Note: Node.js/OS-specific features like `execSync` and `fs` are removed.

async function extractContent(data: ArrayBuffer, contentType: string): Promise<string | null> {
  const lowerContentType = contentType.toLowerCase();

  // Text-based files
  if (lowerContentType.startsWith("text/")) {
    return new TextDecoder().decode(data);
  }

  // PDF files
  if (lowerContentType === "application/pdf") {
    try {
      // pdf-parse expects a Buffer-like object, which Deno's Uint8Array is.
      const pdfData = await pdf(new Uint8Array(data));
      return pdfData?.text || null;
    } catch (error: any) {
      console.error(`[PDF] Error parsing PDF: ${error?.message || error}`);
      throw new Error("Failed to parse PDF file. It may be corrupted or encrypted.");
    }
  }

  // Word documents (.docx)
  if (lowerContentType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    try {
      // Try mammoth.js, which works well in Deno.
      const result = await mammoth.extractRawText({ arrayBuffer: data });
      return result.value;
    } catch (error: any) {
      console.error(`[DOCX] Error parsing DOCX: ${error?.message || error}`);
      throw new Error("Failed to parse DOCX file.");
    }
  }

  console.warn(`Unsupported content type for text extraction: ${contentType}`);
  return null;
}

/**
 * Splits text into chunks of a specified size with overlap.
 * A core component for preparing text for embedding.
 */
function chunkText(text: string, { chunkSize = 1500, chunkOverlap = 200 } = {}): string[] {
  if (!text) return [];

  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(i + chunkSize, text.length);
    chunks.push(text.slice(i, end));
    i += chunkSize - chunkOverlap;
    if (i < 0) i = end; // Ensure progress if overlap is large
  }
  return chunks;
}

/**
 * Generates an embedding for a text string using OpenAI.
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set. Skipping embedding generation.");
    return [];
  }

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: text.replace(/\n/g, " "),
      model: "text-embedding-3-small", // Matches the 1536 dimension in schema
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${error}`);
  }

  const json = await response.json();
  return json.data[0].embedding;
}

/**
 * Generates embeddings for note sections and saves them to the database.
 */
async function embedNoteSections(supabase: SupabaseClient, userId: string, noteId: string): Promise<number> {
  const { data: sections } = await supabase
    .from("note_sections")
    .select("id, content")
    .eq("note_id", noteId)
    .is("embedding", null);

  if (!sections || sections.length === 0) return 0;

  let count = 0;
  for (const section of sections) {
    try {
      const embedding = await generateEmbedding(section.content);
      if (embedding.length > 0) {
        await supabase
          .from("note_sections")
          .update({ embedding })
          .eq("id", section.id);
        count++;
      }
    } catch (e: any) {
      console.error(`Failed to embed section ${section.id}:`, e);
    }
  }
  return count;
}

// --- D2L Helpers ---

async function getD2LCredentials(supabase: SupabaseClient, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_credentials")
    .select("host, token, updated_at")
    .eq("user_id", userId)
    .eq("service", "d2l")
    .single();

  if (error || !data) return null;
  return data;
}

async function fetchD2L(host: string, path: string, cookieHeader: string) {
  const url = `https://${host}${path}`;
  const response = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
      Accept: "application/json",
    },
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error("REAUTH_REQUIRED");
  }
  if (!response.ok) {
    throw new Error(`D2L API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getD2LCourseToc(host: string, orgUnitId: string, cookieHeader: string) {
  // Fetch the Table of Contents for the course (API v1.67 is standard for LE)
  return await fetchD2L(host, `/d2l/api/le/1.67/content/toc/${orgUnitId}`, cookieHeader);
}

function findD2LFiles(modules: any[], files: any[] = []) {
  for (const m of modules) {
    if (m.Topics) {
      for (const t of m.Topics) {
        if (t.TypeIdentifier === 'File' && t.Url) {
          const ext = t.Url.split('.').pop()?.toLowerCase();
          if (ext === 'pdf' || ext === 'docx') {
            files.push({ title: t.Title, url: t.Url, ext });
          }
        }
      }
    }
    if (m.Modules) findD2LFiles(m.Modules, files);
  }
  return files;
}

// --- Marshal Helpers ---
// Ported from d2l-mcp/src/utils/marshal.ts to format D2L responses

function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function removeEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    result[key as keyof T] = value as T[keyof T];
  }
  return result;
}

function marshalAnnouncements(announcements: any[]): any[] {
  return announcements.map((a) => removeEmpty({
    id: a.Id,
    title: a.Title,
    body: stripHtml(a.Body.Text || a.Body.Html),
    date: formatDate(a.CreatedDate),
    attachments: a.Attachments?.length > 0
      ? a.Attachments.map((att: any) => ({ name: att.FileName, size: formatFileSize(att.Size) }))
      : undefined,
  }));
}

function marshalAssignments(assignments: any[]): any[] {
  return assignments.map((a) => {
    let fileTypes: string | null = null;
    if (a.AllowableFileType === 0) fileTypes = 'any';
    else if (a.AllowableFileType === 5 && a.CustomAllowableFileTypes?.length) {
      fileTypes = a.CustomAllowableFileTypes.join(', ');
    }

    return removeEmpty({
      id: a.Id,
      name: a.Name,
      dueDate: formatDate(a.DueDate),
      points: a.Assessment?.ScoreDenominator ?? 0,
      instructions: stripHtml(a.CustomInstructions?.Text || a.CustomInstructions?.Html) || null,
      attachments: a.Attachments?.length > 0
        ? a.Attachments.map((att: any) => ({ name: att.FileName, size: formatFileSize(att.Size) }))
        : undefined,
      links: a.LinkAttachments?.length > 0
        ? a.LinkAttachments.map((l: any) => ({ name: l.Name, url: l.Url }))
        : undefined,
      allowedFileTypes: fileTypes,
    });
  });
}

function marshalGrades(grades: any[]): any[] {
  return grades.map((g) => removeEmpty({
    name: g.GradeObjectName,
    score: g.PointsNumerator !== null && g.PointsDenominator !== null
      ? `${g.PointsNumerator}/${g.PointsDenominator}`
      : null,
    percentage: g.DisplayedGrade?.trim() || null,
    feedback: g.Comments?.Text?.trim() || null,
    lastModified: formatDate(g.LastModified),
  }));
}

// --- Push Notification Helpers ---

async function sendPushToUser(supabase: SupabaseClient, userId: string, title: string, body: string, data?: any) {
  const { data: tokens } = await supabase
    .from("device_tokens")
    .select("device_token")
    .eq("user_id", userId);

  if (!tokens || tokens.length === 0) return;

  const messages = tokens.map((t: any) => ({
    to: t.device_token,
    sound: "default",
    title,
    body,
    data,
    priority: "high",
  }));

  await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });
}

// --- Piazza Helpers ---
// This logic is ported from d2l-mcp/src/tools/piazza.ts and d2l-mcp/src/study/piazzaAuth.ts
// Note: Browser automation with Playwright is NOT supported in Edge Functions.
// This implementation relies on cookies being stored in the database via a WebView login in your app.

async function getPiazzaCookieHeader(supabase: SupabaseClient, userId: string): Promise<string> {
  // Use the admin client to read from the protected user_credentials table
  const { data, error } = await supabaseAdmin
    .from("user_credentials")
    .select("token")
    .eq("user_id", userId)
    .eq("service", "piazza")
    .single();

  if (error || !data?.token) {
    throw new Error("Piazza authentication required. Please connect via the app.");
  }

  const cookieHeader = data.token as string;

  // Lightweight validation check
  const testResponse = await fetch("https://piazza.com/logic/api?method=network.get_my_feed", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({ method: "network.get_my_feed", params: { limit: 1 } }),
  });

  if (!testResponse.ok) {
    // Invalidate stored cookies if they fail
    await supabaseAdmin.from("user_credentials").delete().eq("user_id", userId).eq("service", "piazza");
    throw new Error("Piazza session is invalid or expired. Please re-connect via the app.");
  }

  return cookieHeader;
}

async function fetchPiazza(method: string, params: Record<string, any>, cookieHeader: string): Promise<any> {
  const sessionIdMatch = cookieHeader.match(/session_id=([^;]+)/);
  const csrfToken = sessionIdMatch ? sessionIdMatch[1] : "";

  const response = await fetch(`https://piazza.com/logic/api?method=${encodeURIComponent(method)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Cookie": cookieHeader,
      "csrf-token": csrfToken,
    },
    body: JSON.stringify({ method, params }),
  });

  if (!response.ok) {
    throw new Error(`Piazza API error: ${response.status} ${response.statusText}`);
  }

  const json = await response.json();
  if (json.error) {
    throw new Error(`Piazza API error: ${json.error}`);
  }
  return json.result;
}

// --- Router Setup ---
const router = Router();

// --- Middleware: Auth & Supabase Client ---
// This middleware will run for all routes.
router.all("*", async (req: IRequest) => {
  // 1. Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 2. Create a Supabase client with the user's auth token
  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!, // Use anon key for user-level access
    { global: { headers: { Authorization: req.headers.get("Authorization")! } } }
  );

  // 3. Get the user from the token
  const { data: { user }, error } = await supabaseClient.auth.getUser();
  if (error || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // 4. Attach user and client to the request for other routes to use
  req.user = user;
  req.supabase = supabaseClient;
});

// --- API Routes ---
// Porting routes from d2l-mcp/src/api/routes.ts

/**
 * POST /
 * Action-based dispatcher for compatibility with app requests.
 */
router.post("/", async (req: any) => {
  const body = await req.json();
  const { action } = body;

  if (action === "sync_d2l") {
    // Redirect to the actual sync handler or just call it
    // For now, let's handle it here
    return await router.handle({ ...req, method: 'POST', url: new URL('/d2l/sync', req.url).toString(), json: () => body })
  }

  if (action === "process_note") {
    // Manually handle it since internal redirect with itty-router is tricky with bodies
    // Or just re-route
    return await router.handle({ ...req, method: 'POST', url: new URL('/notes/process', req.url).toString(), json: () => body })
  }

  return new Response(JSON.stringify({ error: "Action not supported" }), { status: 400 });
});

/**
 * GET /dashboard
 * Fetches dashboard data: recent notes, usage, and stats.
 */
router.get("/dashboard", async (req: any) => {
  const { supabase, user } = req;

  const [notesRes, sectionsRes, notesCountRes] = await Promise.all([
    supabase
      .from("notes")
      .select("id, title, course_id, created_at, status")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("note_sections")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
    supabase
      .from("notes")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id),
  ]);

  const responseData = {
    recentNotes: notesRes.data ?? [],
    usage: { totalChunks: sectionsRes.count ?? 0 },
    stats: { notesCount: notesCountRes.count ?? 0 },
  };

  return new Response(JSON.stringify(responseData), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * GET /notes
 * List all notes for the user.
 */
router.get("/notes", async (req: any) => {
  const { supabase, user } = req;
  const courseId = new URL(req.url).searchParams.get("courseId");

  let query = supabase
    .from("notes")
    .select("id, title, course_id, created_at, page_count, status")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (courseId) query = query.eq("course_id", courseId);

  const { data: notes, error } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to list notes" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ notes: notes ?? [] }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * DELETE /notes/:id
 * Delete a note and its sections.
 */
router.delete("/notes/:id", async (req: any) => {
  const { supabase, user } = req;
  const { id } = req.params;

  // Delete note sections first (optional if cascade delete is set up in DB, but good for safety)
  await supabase.from("note_sections").delete().eq("user_id", user.id).eq("note_id", id);

  // Delete the note
  const { error } = await supabase.from("notes").delete().eq("user_id", user.id).eq("id", id);

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to delete note" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ status: "deleted", noteId: id }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * GET /search
 * Semantic search over notes.
 */
router.get("/search", async (req: any) => {
  const { supabase, user } = req;
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const courseId = url.searchParams.get("courseId");
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 10, 1), 50);

  if (!q) {
    return new Response(JSON.stringify({ error: "query q required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const queryEmbedding = await generateEmbedding(q);

    // Call the Supabase RPC function for vector similarity search
    const { data: sections, error } = await supabase.rpc("match_note_sections", {
      query_embedding: queryEmbedding,
      match_count: limit,
      course_filter: courseId || null,
      user_filter: user.id,
    });

    if (error) throw error;

    const hits = (sections ?? []).map((s: any) => ({
      sectionId: s.id,
      noteId: s.note_id,
      title: s.title,
      snippet: s.preview || s.content.slice(0, 200), // Fallback if preview not in RPC
      score: s.similarity,
    }));

    return new Response(JSON.stringify({ hits }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    console.error("[API] search error:", e);
    return new Response(JSON.stringify({ error: "Search failed", details: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/**
 * POST /notes/embed-missing
 * Triggers embedding generation for notes that are missing them.
 */
router.post("/notes/embed-missing", async (req: any) => {
  const { supabase, user } = req;

  // Find notes with sections that have null embeddings
  // This is a simplified approach; usually you'd query note_sections directly
  const { data: sections } = await supabase
    .from("note_sections")
    .select("note_id")
    .eq("user_id", user.id)
    .is("embedding", null)
    .limit(50); // Process in batches

  if (!sections || sections.length === 0) {
    return new Response(JSON.stringify({ success: true, message: "No missing embeddings found" }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Deduplicate note IDs
  const noteIds = [...new Set(sections.map((s: any) => s.note_id))];
  let totalEmbedded = 0;

  for (const noteId of noteIds) {
    totalEmbedded += await embedNoteSections(supabase, user.id, noteId);
  }

  return new Response(JSON.stringify({ success: true, embedded_count: totalEmbedded }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * POST /notes/presign-upload
 * Generates a signed URL for the client to upload a file to Supabase Storage.
 * Replaces the S3 presigned URL logic.
 */
router.post("/notes/presign-upload", async (req: any) => {
  const { user } = req;
  const { filename, contentType, size } = (await req.json()) as PresignUploadRequestBody;
  const bucket = "notes"; // Or get from env var

  if (!filename || !contentType || typeof size !== "number") {
    return new Response(JSON.stringify({ error: "filename, contentType, and size are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Create a safe and unique path for the file in Storage.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const storagePath = `users/${user.id}/${crypto.randomUUID()}-${safeName}`;

  try {
    // Use the admin client to generate a signed URL, as the user-level client
    // might not have direct upload permissions depending on your Storage policies.
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error) throw error;

    return new Response(JSON.stringify({ uploadUrl: data.signedUrl, path: data.path }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    console.error("[API] presign-upload error:", e);
    return new Response(JSON.stringify({ error: "Failed to generate signed upload URL" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/**
 * POST /notes/process
 * Processes a file already uploaded to Supabase Storage.
 */
router.post("/notes/process", async (req: any) => {
  const { supabase, user } = req;
  const { storagePath, title, courseId } = (await req.json()) as ProcessNoteRequestBody;
  const bucket = "notes"; // Or get from env var

  if (!storagePath || !title) {
    return new Response(JSON.stringify({ error: "storagePath and title are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // --- 1. Create Note Record ---
  const { data: note, error: insertErr } = await supabase
    .from("notes")
    .insert({
      user_id: user.id,
      storage_path: storagePath,
      title: title,
      course_id: courseId,
      status: "processing",
    })
    .select("id")
    .single();

  if (insertErr || !note) {
    console.error("[API] note insert error:", insertErr);
    return new Response(JSON.stringify({ error: "Failed to create note record" }), { status: 500 });
  }
  const noteId = note.id;

  try {
    // --- 2. Download File from Storage ---
    // Use the admin client to bypass RLS if storage policies are restrictive.
    const { data: fileData, error: downloadErr } = await supabaseAdmin.storage
      .from(bucket)
      .download(storagePath);

    if (downloadErr) throw new Error(`Failed to download from storage: ${downloadErr.message}`);
    const fileBuffer = await fileData.arrayBuffer();
    const contentType = fileData.type;

    // --- 3. Extract Text Content ---
    const textContent = await extractContent(fileBuffer, contentType);
    if (!textContent || textContent.trim().length === 0) {
      throw new Error("Could not extract any text from the file.");
    }

    // --- 4. Chunk Text ---
    const chunks = chunkText(textContent);
    if (chunks.length === 0) {
      throw new Error("File content was too short to be processed.");
    }

    // --- 5. Save Chunks to Database ---
    const sectionsToInsert = chunks.map((chunk, i) => ({
      note_id: noteId,
      user_id: user.id,
      content: chunk,
      token_count: Math.round(chunk.length / 4), // Rough estimate
      page_number: i + 1, // Simple page number for now
    }));

    const { error: sectionsErr } = await supabase.from("note_sections").insert(sectionsToInsert);
    if (sectionsErr) {
      throw new Error(`Failed to save note sections: ${sectionsErr.message}`);
    }

    // --- 6. Trigger Embedding (Async) ---
    // This can be done immediately or deferred to a background worker.
    // For simplicity, we call it here but don't wait for it.
    const embeddedCount = await embedNoteSections(supabase, user.id, noteId);

    // --- 7. Update Note Status to 'ready' ---
    await supabase
      .from("notes")
      .update({ status: "ready", page_count: chunks.length }) // Using chunk count as page count
      .eq("id", noteId);

    return new Response(
      JSON.stringify({
        noteId: noteId,
        status: "ready",
        chunkCount: chunks.length,
        embedded: embeddedCount,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (e: any) {
    console.error(`[API] /notes/process error for note ${noteId}:`, e);
    // If anything fails, update the note status to 'error'
    await supabase
      .from("notes")
      .update({ status: "error" })
      .eq("id", noteId);

    return new Response(
      JSON.stringify({
        error: "Failed to process file",
        details: e.message,
        noteId: noteId,
      }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});

/**
 * POST /d2l/connect-cookie
 * Stores D2L cookies from a WebView login.
 */
router.post("/d2l/connect-cookie", async (req: any) => {
  const { user } = req;
  const { host, cookies } = await req.json();

  if (!host || !cookies) {
    return new Response(JSON.stringify({ error: "host and cookies required" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Verify cookies by fetching enrollments
  try {
    // Using a standard D2L API endpoint to verify access
    await fetchD2L(host, "/d2l/api/lp/1.30/enrollments/myenrollments/", cookies);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Invalid or expired cookies", details: e.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Store credentials
  const { error } = await supabaseAdmin
    .from("user_credentials")
    .upsert({
      user_id: user.id,
      service: "d2l",
      host: host,
      token: cookies,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,service" });

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to store credentials" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ status: "connected" }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * GET /d2l/status
 * Checks D2L connection status.
 */
router.get("/d2l/status", async (req: any) => {
  const { supabase, user } = req;
  const creds = await getD2LCredentials(supabase, user.id);

  const connected = !!creds?.token;
  let reauthRequired = false;

  // Check token age (e.g., if older than 24 hours, might need reauth)
  if (creds?.updated_at) {
    const age = Date.now() - new Date(creds.updated_at).getTime();
    if (age > 24 * 60 * 60 * 1000) reauthRequired = true;
  }

  return new Response(JSON.stringify({ connected, reauthRequired }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * DELETE /d2l/disconnect
 * Remove D2L credentials.
 */
router.delete("/d2l/disconnect", async (req: any) => {
  const { user } = req;
  const { error } = await supabaseAdmin
    .from("user_credentials")
    .delete()
    .eq("user_id", user.id)
    .eq("service", "d2l");

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to disconnect D2L" }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ status: "disconnected" }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * GET /d2l/courses
 * Fetches enrolled courses from D2L.
 */
router.get("/d2l/courses", async (req: any) => {
  const { supabase, user } = req;
  const creds = await getD2LCredentials(supabase, user.id);

  if (!creds || !creds.token) {
    return new Response(JSON.stringify({ error: "D2L not connected" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  try {
    const data = await fetchD2L(creds.host, "/d2l/api/lp/1.30/enrollments/myenrollments/", creds.token);

    // Transform to simplified format
    const courses = (data.Items || [])
      .filter((e: any) => e.OrgUnit?.Type?.Code === "Course Offering" && e.Access?.IsActive)
      .map((e: any) => ({
        id: String(e.OrgUnit.Id),
        name: e.OrgUnit.Name,
        code: e.OrgUnit.Code,
      }));

    return new Response(JSON.stringify({ courses }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    const status = e.message === "REAUTH_REQUIRED" ? 401 : 500;
    return new Response(JSON.stringify({ error: e.message }), {
      status,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/**
 * GET /d2l/courses/:courseId/announcements
 */
router.get("/d2l/courses/:courseId/announcements", async (req: any) => {
  const { supabase, user } = req;
  const { courseId } = req.params;
  const creds = await getD2LCredentials(supabase, user.id);

  if (!creds?.token) return new Response("D2L not connected", { status: 401 });

  try {
    const news = await fetchD2L(creds.host, `/d2l/api/le/1.67/news/${courseId}/`, creds.token);
    return new Response(JSON.stringify({ announcements: marshalAnnouncements(news) }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: e.message === "REAUTH_REQUIRED" ? 401 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/**
 * GET /d2l/courses/:courseId/assignments
 */
router.get("/d2l/courses/:courseId/assignments", async (req: any) => {
  const { supabase, user } = req;
  const { courseId } = req.params;
  const creds = await getD2LCredentials(supabase, user.id);

  if (!creds?.token) return new Response("D2L not connected", { status: 401 });

  try {
    const folders = await fetchD2L(creds.host, `/d2l/api/le/1.67/dropbox/folders/${courseId}/`, creds.token);
    return new Response(JSON.stringify({
      assignments: marshalAssignments(folders).map(a => ({
        id: a.id,
        name: a.name,
        dueDate: a.dueDate,
        instructions: a.instructions
      }))
    }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: e.message === "REAUTH_REQUIRED" ? 401 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/**
 * GET /d2l/courses/:courseId/grades
 */
router.get("/d2l/courses/:courseId/grades", async (req: any) => {
  const { supabase, user } = req;
  const { courseId } = req.params;
  const creds = await getD2LCredentials(supabase, user.id);

  if (!creds?.token) return new Response("D2L not connected", { status: 401 });

  try {
    const grades = await fetchD2L(creds.host, `/d2l/api/le/1.67/grades/${courseId}/values/myGradeValues/`, creds.token);
    return new Response(JSON.stringify({ grades: marshalGrades(grades) }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: e.message === "REAUTH_REQUIRED" ? 401 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/**
 * POST /d2l/sync
 * Syncs D2L content (PDF/DOCX) for the user.
 */
router.post("/d2l/sync", async (req: any) => {
  const { supabase, user } = req;

  try {
    const credentials = await getD2LCredentials(supabase, user.id);
    if (!credentials) {
      return new Response(JSON.stringify({ error: "D2L credentials not found" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const { host, token } = credentials;
    const cookieHeader = `d2lSession=${token}`;

    const courses = await fetchD2L(host, "/d2l/api/lp/1.67/enrollments/myenrollments/", cookieHeader);
    const activeCourses = courses.Items.filter((c: any) => c.Access.IsActive);

    for (const course of activeCourses) {
      // Process course content...
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/**
 * POST /piazza/connect-cookie
 * Stores Piazza cookies from a WebView login.
 */
router.post("/piazza/connect-cookie", async (req: any) => {
  const { user } = req;
  const { cookies } = await req.json();

  if (!cookies || typeof cookies !== "string" || !cookies.includes("session_id=")) {
    return new Response(JSON.stringify({ error: "Invalid cookies: session_id not found" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Verify cookies before storing
  try {
    const res = await fetch("https://piazza.com/logic/api?method=network.get_my_feed", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: cookies },
      body: JSON.stringify({ method: "network.get_my_feed", params: { limit: 1 } }),
    });
    if (!res.ok) throw new Error("Piazza API check failed");
  } catch (error: any) {
    return new Response(JSON.stringify({ error: "Invalid or expired cookies.", details: error.message }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // Use the admin client to upsert into the protected user_credentials table
  const { error } = await supabaseAdmin
    .from("user_credentials")
    .upsert({
      user_id: user.id,
      service: "piazza",
      token: cookies, // Store cookies in the 'token' field
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,service" });

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to store credentials", details: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ status: "connected" }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * DELETE /piazza/disconnect
 */
router.delete("/piazza/disconnect", async (req: any) => {
  const { user } = req;
  const { error } = await supabaseAdmin
    .from("user_credentials")
    .delete()
    .eq("user_id", user.id)
    .eq("service", "piazza");

  if (error) {
    return new Response(JSON.stringify({ error: "Failed to disconnect Piazza" }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ status: "disconnected" }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * POST /piazza/sync
 * Syncs Piazza posts for the user.
 */
router.post("/piazza/sync", async (req: any) => {
  const { supabase, user } = req;
  const body: PiazzaSyncRequestBody = await req.json();

  try {
    const cookieHeader = await getPiazzaCookieHeader(supabase, user.id);

    // The actual sync logic from d2l-mcp/src/study/src/piazza.js is not provided.
    // This is a simplified re-implementation based on the available tools.
    // It fetches networks, then iterates to fetch posts.
    console.log(`Starting Piazza sync for user ${user.id}`);

    const profile = await fetchPiazza("user_profile.get_profile", {}, cookieHeader);
    const networks = profile?.networks || [];
    if (networks.length === 0) {
      return new Response(JSON.stringify({ success: true, message: "No Piazza networks found.", posts_synced: 0 }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    let totalSynced = 0;
    for (const network of networks) {
      if (body.courseId && network.nid !== body.courseId) {
        continue;
      }

      const feed = await fetchPiazza("network.filter_feed", {
        nid: network.nid,
        limit: body.maxPosts || 40,
        offset: 0,
      }, cookieHeader);

      if (!feed.feed || feed.feed.length === 0) {
        continue;
      }

      const postsToUpsert = feed.feed.map((post: any) => ({
        user_id: user.id,
        post_id: post.id,
        course_id: network.nid,
        course_name: network.name,
        post_nr: post.nr,
        title: post.subject,
        // For simplicity, we're not fetching full content here to avoid many requests.
        // A more complete implementation would fetch each post's content.
        body: post.preview_text || "",
        post_type: post.type,
        tags: post.tags,
        folders: post.folders,
        created_at: new Date(post.created).toISOString(),
        updated_at: new Date(post.updated).toISOString(),
      }));

      if (postsToUpsert.length > 0) {
        // Use the user-scoped client to upsert, assuming RLS is set up for piazza_posts
        const { error } = await supabase.from("piazza_posts").upsert(postsToUpsert, {
          onConflict: "user_id,post_id",
        });
        if (error) {
          console.error(`Error upserting posts for network ${network.nid}: `, error);
        } else {
          totalSynced += postsToUpsert.length;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, posts_synced: totalSynced }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: e.message.includes("authentication") || e.message.includes("expired") ? 401 : 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/**
 * GET /piazza/status
 * Checks Piazza connection status.
 */
router.get("/piazza/status", async (req: any) => {
  const { supabase, user } = req;

  const { data } = await supabaseAdmin
    .from("user_credentials")
    .select("token, updated_at")
    .eq("user_id", user.id)
    .eq("service", "piazza")
    .single();

  const connected = !!data?.token;

  // Get classes count from DB
  const { count } = await supabase
    .from("piazza_posts")
    .select("course_id", { count: "exact", head: true })
    .eq("user_id", user.id);

  return new Response(JSON.stringify({ connected, classesCount: count || 0 }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * POST /push/register
 * Register device token for push notifications.
 */
router.post("/push/register", async (req: any) => {
  const { supabase, user } = req;
  const { deviceToken, platform } = await req.json();

  if (!deviceToken || !platform) {
    return new Response("deviceToken and platform required", { status: 400 });
  }

  const { error } = await supabase
    .from("device_tokens")
    .upsert({
      user_id: user.id,
      device_token: deviceToken,
      platform,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,device_token" });

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  return new Response(JSON.stringify({ status: "registered" }), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
});

/**
 * POST /push/sync
 * Checks for D2L updates (Announcements/Assignments) and sends push notifications.
 */
router.post("/push/sync", async (req: any) => {
  const { supabase, user } = req;
  const creds = await getD2LCredentials(supabase, user.id);

  if (!creds?.token) return new Response("D2L not connected", { status: 200 }); // Silent fail for background tasks

  try {
    // 1. Get Enrollments
    const enrollments = await fetchD2L(creds.host, "/d2l/api/lp/1.30/enrollments/myenrollments/", creds.token);
    const courses = (enrollments.Items || []).filter((e: any) => e.OrgUnit?.Type?.Code === "Course Offering" && e.Access?.IsActive);

    // 2. Get Last Sync Time
    const { data: syncState } = await supabase
      .from("sync_state")
      .select("last_sync_at")
      .eq("user_id", user.id)
      .eq("source", "learn")
      .single();

    const lastSync = syncState?.last_sync_at ? new Date(syncState.last_sync_at).getTime() : Date.now() - 86400000;
    let updatesFound = 0;

    // 3. Check each course
    for (const course of courses) {
      const courseId = course.OrgUnit.Id;
      const courseName = course.OrgUnit.Name;

      // Check News
      const news = await fetchD2L(creds.host, `/d2l/api/le/1.67/news/${courseId}/`, creds.token);
      const newItems = news.filter((n: any) => new Date(n.StartDate).getTime() > lastSync);

      for (const item of newItems.slice(0, 3)) {
        await sendPushToUser(supabase, user.id, `New Announcement in ${courseName}`, item.Title);
        updatesFound++;
      }
    }

    // 4. Update Sync State
    await supabase.from("sync_state").upsert({ user_id: user.id, source: "learn", last_sync_at: new Date().toISOString() }, { onConflict: "user_id,source" });

    return new Response(JSON.stringify({ status: "completed", updates: updatesFound }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});

// --- Fallback Route ---
router.all("*", () => new Response("Not Found", { status: 404 }));

// --- Deno Server ---
Deno.serve(async (req) => {
  try {
    // Extract virtual path from header if present (used by apiClient.ts)
    const xPath = req.headers.get("x-path") || req.headers.get("X-Path");
    if (xPath) {
      const url = new URL(req.url);
      url.pathname = xPath.startsWith("/") ? xPath : `/${xPath}`;
      // Note: We can't mutate req.url directly, but itty-router accepts an object with url property
      return await router.handle({
        ...req,
        url: url.toString(),
        // Ensure standard methods are preserved
        method: req.method,
        headers: req.headers,
        json: () => req.json(),
        formData: () => req.formData(),
        blob: () => req.blob(),
        text: () => req.text(),
        arrayBuffer: () => req.arrayBuffer(),
      });
    }

    return await router.handle(req);
  } catch (e: any) {
    return new Response(JSON.stringify({ error: "Internal Server Error", details: e.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});

/*
NOTE ON MIGRATION:

This Edge Function is designed to replace your Express.js backend by routing requests
to the appropriate logic.

What was ported:
- A router structure to handle different API endpoints like /dashboard, /piazza/sync, etc.
- Database logic using the Supabase Deno client.
- Piazza API interaction that relies on cookies stored in the database. This is compatible with Edge Functions.

What was NOT ported (and why):
- Playwright/Browser Automation: Supabase Edge Functions run in a restricted environment and cannot launch a browser. The logic in 'piazzaAuth.ts' that uses 'chromium.launchPersistentContext' is not portable. Your app must rely on the cookie-based authentication flow (e.g., via a WebView login that captures cookies and sends them to '/piazza/connect-cookie').
- Local File System Access: The logic in 'd2l-mcp/src/tools/files.ts' for reading/writing to the local disk ('os.homedir()', 'fs') is not applicable in a serverless environment. File handling must be done via services like Supabase Storage.
- D2L Logic: The D2L client and tools are extensive. They can be ported following the same pattern as the Piazza logic: create helper functions that use 'fetch' to call the D2L API, and use Supabase to retrieve user credentials/tokens. This file provides a template for how to do that.
- Embedding: The `embedNoteSections` function is a placeholder. You would typically create a separate Edge Function dedicated to embedding (e.g., `embedding-generator`) that this function can invoke. This keeps the embedding model and logic isolated.

Next Steps:
- Port the remaining routes from 'd2l-mcp/src/api/routes.ts' into this router.
- For D2L logic, you will need to port the 'D2LClient' and 'marshal' utilities to Deno, replacing Node.js-specific APIs with Deno/web standards.
- Update your React Native app to point its API calls to this Edge Function's URL.
*/
