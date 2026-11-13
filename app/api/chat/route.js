import { supabaseForToken } from "@/lib/supabaseServer";
import { MODES, BASE_RULES, TOOL_RULES } from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

const IMG_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

function cleanAttachments(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 5).flatMap((a) => {
    if (a?.type === "image" && IMG_TYPES.includes(a.mediaType) && typeof a.data === "string")
      return [{ type: "image", name: String(a.name || "image").slice(0, 80), mediaType: a.mediaType, data: a.data }];
    if (a?.type === "pdf" && typeof a.data === "string")
      return [{ type: "pdf", name: String(a.name || "file.pdf").slice(0, 80), data: a.data }];
    if (a?.type === "text" && typeof a.text === "string")
      return [{ type: "text", name: String(a.name || "file.txt").slice(0, 80), text: a.text.slice(0, 60000) }];
    return [];
  });
}

const fileNote = (a) => `\n\n[Attached file: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\``;

// Claude (Anthropic) message format
function toClaude(role, content, atts, withMedia) {
  let text = content;
  const blocks = [];
  for (const a of atts || []) {
    if (a.type === "text") text += fileNote(a);
    else if (withMedia && a.type === "image")
      blocks.push({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } });
    else if (withMedia && a.type === "pdf" && a.data)
      blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } });
  }
  return { role, content: blocks.length ? [...blocks, { type: "text", text }] : text };
}

// OpenAI-compatible format (Groq etc.)
function toOpenAI(role, content, atts, withMedia, cap) {
  let text = cap && content.length > 6000 ? content.slice(0, 6000) + "\n...[lamba message chhota kiya gaya]" : content;
  const images = [];
  for (const a of atts || []) {
    if (a.type === "text") text += fileNote(cap && a.text.length > 8000 ? { ...a, text: a.text.slice(0, 8000) + "\n...[file ka baaki hissa chhoda gaya]" } : a);
    else if (a.type === "pdf") text += `\n\n[PDF "${a.name}" attached, lekin ye model PDF nahi padh sakta.]`;
    else if (withMedia && a.type === "image") images.push({ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.data}` } });
  }
  return { role, content: images.length ? [{ type: "text", text }, ...images] : text };
}

export async function POST(req) {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.AI_API_KEY || process.env.GROQ_API_KEY;
    let provider = (process.env.AI_PROVIDER || "").toLowerCase();
    if (provider !== "anthropic" && provider !== "openai") provider = anthropicKey && !anthropicKey.startsWith("your-") ? "anthropic" : "openai";
    const apiKey = provider === "anthropic" ? anthropicKey : openaiKey;
    if (!apiKey || apiKey.startsWith("your-"))
      return json({ error: provider === "anthropic" ? "Server par ANTHROPIC_API_KEY set nahi hai. .env.local mein apni Claude API key daalo." : "Server par AI_API_KEY set nahi hai." }, 500);

    const token = (req.headers.get("authorization") || "").replace("Bearer ", "").trim();
    if (!token) return json({ error: "Login zaroori hai." }, 401);
    const sb = supabaseForToken(token);
    const { data: auth, error: authErr } = await sb.auth.getUser(token);
    if (authErr || !auth?.user) return json({ error: "Session expire ho gaya. Dobara login karo." }, 401);
    const user = auth.user;

    const body = await req.json();
    const regenerate = !!body.regenerate;
    const atts = regenerate ? [] : cleanAttachments(body.attachments);
    const text = String(body.message || "").trim() || (atts.length ? "Is attachment ko dekho aur meri madad karo." : "");
    const mode = MODES[body.mode] ? body.mode : "coding";
    const tools = body.tools || {};
    let conversationId = body.conversationId || null;
    if (!regenerate && !text) return json({ error: "Message khaali hai." }, 400);
    if (text.length > 50000) return json({ error: "Message bahut lamba hai (max 50000 characters)." }, 400);

    // Daily limit (optional): DAILY_MESSAGE_LIMIT=0 ya khaali = koi limit nahi
    const limit = parseInt(process.env.DAILY_MESSAGE_LIMIT || "0", 10);
    if (limit > 0) {
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      const { count } = await sb.from("messages").select("id", { count: "exact", head: true })
        .eq("user_id", user.id).eq("role", "user").gte("created_at", start.toISOString());
      if ((count || 0) >= limit) return json({ error: `Aaj ki limit (${limit} messages) poori ho gayi. Kal dobara try karo.` }, 429);
    }

    // Conversation (sirf apni)
    if (conversationId) {
      const { data: own } = await sb.from("conversations").select("id").eq("id", conversationId).eq("user_id", user.id).maybeSingle();
      if (!own) return json({ error: "Chat nahi mili." }, 404);
    } else {
      if (regenerate) return json({ error: "Regenerate ke liye chat chahiye." }, 400);
      const title = (text.replace(/\s+/g, " ").slice(0, 60)) || "New chat";
      const { data: conv, error } = await sb.from("conversations").insert({ title, mode, user_id: user.id }).select("id").single();
      if (error) return json({ error: "Chat save nahi ho payi: " + error.message }, 500);
      conversationId = conv.id;
    }

    if (regenerate) {
      const { data: last } = await sb.from("messages").select("id,role").eq("conversation_id", conversationId)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (last?.role === "assistant") await sb.from("messages").delete().eq("id", last.id);
    } else {
      const stored = atts.map((a) => (a.type === "pdf" ? { type: "pdf", name: a.name } : a));
      const { error: insErr } = await sb.from("messages").insert({
        conversation_id: conversationId, user_id: user.id, role: "user", content: text,
        attachments: stored.length ? stored : null,
      });
      if (insErr) return json({ error: "Message save nahi hua: " + insErr.message }, 500);
    }

    const { data: rows } = await sb.from("messages").select("role, content, attachments")
      .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(30);
    const ordered = (rows || []).reverse();
    while (ordered.length && ordered[0].role !== "user") ordered.shift();
    const build = provider === "anthropic" ? toClaude : toOpenAI;
    // Levels: pehle poori history; provider "request too large" (413) bole toh khud chhota karke dobara
    const LEVELS = provider === "anthropic"
      ? [{ m: 30, c: Infinity, t: 4096 }]
      : [{ m: 30, c: Infinity, t: 4096 }, { m: 12, c: 16000, t: 2000 }, { m: 6, c: 8000, t: 1500 }, { m: 2, c: 4000, t: 1000 }];
    const size = (m) => (m.content || "").length + (m.attachments || []).reduce((n, a) => n + (a.text ? a.text.length : 0), 0);
    const makeMessages = (lv) => {
      const L = LEVELS[lv];
      const arr = ordered.slice(-L.m);
      let total = arr.reduce((n, m) => n + size(m), 0);
      while (arr.length > 1 && total > L.c) total -= size(arr.shift());
      while (arr.length && arr[0].role !== "user") arr.shift();
      return arr.map((m, i) => {
        const isLast = i === arr.length - 1;
        const a = isLast && !regenerate ? atts : m.attachments;
        return build(m.role, m.content, a, isLast, lv > 0);
      });
    };
    let level = 0;
    let messages = makeMessages(0);
    if (!messages.length) return json({ error: "Koi message nahi mila." }, 400);

    let system = MODES[mode].system + BASE_RULES;
    const useSearch = !!(tools.search || tools.deep);
    if (provider === "anthropic") {
      if (tools.deep) system += TOOL_RULES.deep;
      else if (tools.search) system += TOOL_RULES.search;
    } else if (useSearch) {
      system += " Tumhare paas live internet access nahi hai. Agar user taaza jaankari maange toh batao ki tumhari knowledge purani ho sakti hai.";
    }
    if (tools.image) system += TOOL_RULES.image;
    const custom = String(body.instructions || "").trim().slice(0, 1500);
    if (custom) system += `\n\nUser ki custom instructions (inhe follow karo):\n${custom}`;

    const ctrl = new AbortController();
    const wantThink = provider === "anthropic" && !!tools.think;

    // ---- request builder
    let url, headers, buildBody;
    if (provider === "anthropic") {
      url = "https://api.anthropic.com/v1/messages";
      headers = { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
      const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
      buildBody = (think) => {
        const b = { model, stream: true, max_tokens: think || tools.deep ? 10000 : 4096, system, messages };
        if (useSearch) b.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: tools.deep ? 10 : 3 }];
        if (think) b.thinking = { type: "enabled", budget_tokens: 4000 };
        return b;
      };
    } else {
      const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
      url = `${base}/chat/completions`;
      headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
      const modelFor = () => (messages.some((m) => Array.isArray(m.content)) ? process.env.AI_VISION_MODEL || process.env.AI_MODEL || "openai/gpt-oss-20b" : process.env.AI_MODEL || "openai/gpt-oss-20b");
      buildBody = () => {
        const model = modelFor();
        const b = { model, stream: true, max_tokens: parseInt(process.env.AI_MAX_TOKENS || "0", 10) || LEVELS[level].t, messages: [{ role: "system", content: system }, ...messages] };
        if (model.startsWith("openai/gpt-oss")) b.reasoning_effort = "low"; // tez aur kam tokens
        return b;
      };
    }

    const encoder = new TextEncoder();
    let full = "";
    let saved = false;
    const save = async () => {
      if (saved || !full) return;
      saved = true;
      await sb.from("messages").insert({ conversation_id: conversationId, user_id: user.id, role: "assistant", content: full });
      await sb.from("conversations").update({ updated_at: new Date().toISOString(), mode }).eq("id", conversationId);
    };

    const readable = new ReadableStream({
      async start(controller) {
        const emit = (t) => { full += t; controller.enqueue(encoder.encode(t)); };
        try {
          for (const think of wantThink ? [true, false] : [false]) {
            let res;
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
            const waitSecs = async (r) => {
              const h = parseFloat(r.headers.get("retry-after"));
              if (!isNaN(h)) return h;
              const t = await r.clone().text().catch(() => "");
              const m = /try again in ([\d.]+)(ms|s)\b/i.exec(t);
              return m ? (m[2].toLowerCase() === "ms" ? parseFloat(m[1]) / 1000 : parseFloat(m[1])) : null;
            };
            for (let attempt = 0; attempt < 8; attempt++) {
              res = await fetch(url, { method: "POST", signal: ctrl.signal, headers, body: JSON.stringify(buildBody(think)) });
              if (res.status === 413 && level < LEVELS.length - 1) { // request bahut badi: chhoti karke dobara
                await res.text().catch(() => {});
                level++; messages = makeMessages(level);
                continue;
              }
              if (res.status === 429) { // thodi der ki limit ho toh ruk kar dobara
                const w = await waitSecs(res);
                if (w !== null && w <= 20 && attempt < 7) { await res.text().catch(() => {}); await sleep(w * 1000 + 300); continue; }
                break;
              }
              if ([500, 503, 529].includes(res.status) && attempt < 7) { // server busy
                await res.text().catch(() => {});
                await sleep(1500 * (attempt + 1));
                continue;
              }
              break;
            }
            if (!res.ok) {
              const errText = await res.text();
              if (think && res.status === 400) continue; // thinking support na ho toh bina thinking ke dobara
              let msg = errText;
              try { const j = JSON.parse(errText); msg = j.error?.message || errText; } catch {}
              throw new Error(`${res.status}: ${msg}`);
            }
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = "";
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split("\n");
              buf = lines.pop();
              for (const line of lines) {
                if (!line.startsWith("data:")) continue;
                const payload = line.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                let ev; try { ev = JSON.parse(payload); } catch { continue; }
                if (provider === "anthropic") {
                  if (ev.type === "content_block_start" && ev.content_block?.type === "text" && full && !/\s$/.test(full)) emit("\n\n");
                  else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") emit(ev.delta.text);
                  else if (ev.type === "error") throw new Error(ev.error?.message || "Claude error");
                } else {
                  const t = ev.choices?.[0]?.delta?.content;
                  if (t) emit(t);
                }
              }
            }
            if (!full) emit("\n\n**Error:** Khaali jawab aaya. Dobara try karo.");
            break;
          }
          await save();
        } catch (e) {
          if (e?.name !== "AbortError") controller.enqueue(encoder.encode("\n\n**Error:** AI se jawab nahi aa paya. " + (e?.message || "")));
          await save();
        } finally {
          try { controller.close(); } catch {}
        }
      },
      async cancel() {
        try { ctrl.abort(); } catch {}
        await save();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Conversation-Id": conversationId,
      },
    });
  } catch (e) {
    return json({ error: "Server error: " + (e?.message || "unknown") }, 500);
  }
}
