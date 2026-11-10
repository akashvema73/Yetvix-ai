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

// OpenAI-compatible format (Groq / OpenRouter / OpenAI)
function toMessage(role, content, atts, withMedia) {
  let text = content;
  const images = [];
  for (const a of atts || []) {
    if (a.type === "text") text += `\n\n[Attached file: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\``;
    else if (a.type === "pdf") text += `\n\n[PDF "${a.name}" attached, lekin ye model PDF nahi padh sakta. User ko text copy-paste karne ko bolo.]`;
    else if (withMedia && a.type === "image") images.push({ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.data}` } });
  }
  if (images.length) return { role, content: [{ type: "text", text }, ...images], hasImage: true };
  return { role, content: text };
}

export async function POST(req) {
  try {
    const apiKey = process.env.AI_API_KEY || process.env.GROQ_API_KEY;
    if (!apiKey || apiKey.startsWith("your-"))
      return json({ error: "Server par AI_API_KEY set nahi hai. .env.local file mein apni Groq key daalo." }, 500);

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
    if (text.length > 8000) return json({ error: "Message bahut lamba hai (max 8000 characters)." }, 400);

    // Daily limit
    const limit = parseInt(process.env.DAILY_MESSAGE_LIMIT || "50", 10);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const { count } = await sb.from("messages").select("id", { count: "exact", head: true })
      .eq("user_id", user.id).eq("role", "user").gte("created_at", start.toISOString());
    if ((count || 0) >= limit) return json({ error: `Aaj ki limit (${limit} messages) poori ho gayi. Kal dobara try karo.` }, 429);

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
    const history = ordered.map((m, i) => {
      const isLast = i === ordered.length - 1;
      const a = isLast && !regenerate ? atts : m.attachments;
      return toMessage(m.role, m.content, a, isLast);
    });
    if (!history.length) return json({ error: "Koi message nahi mila." }, 400);
    const hasImage = history.some((m) => m.hasImage);
    const messages = history.map(({ role, content }) => ({ role, content }));

    let system = MODES[mode].system + BASE_RULES;
    if (tools.deep || tools.search) system += " Tumhare paas live internet access nahi hai. Agar user taaza jaankari maange toh batao ki tumhari knowledge purani ho sakti hai.";
    if (tools.image) system += TOOL_RULES.image;
    const custom = String(body.instructions || "").trim().slice(0, 1500);
    if (custom) system += `\n\nUser ki custom instructions (inhe follow karo):\n${custom}`;

    const base = (process.env.AI_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
    const model = hasImage
      ? process.env.AI_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct"
      : process.env.AI_MODEL || "llama-3.3-70b-versatile";
    const url = `${base}/chat/completions`;
    const ctrl = new AbortController();
    const buildBody = () => ({
      model,
      stream: true,
      max_tokens: 4096,
      messages: [{ role: "system", content: system }, ...messages],
    });

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
        try {
          let res;
          for (let attempt = 0; attempt < 4; attempt++) {
            res = await fetch(url, {
              method: "POST", signal: ctrl.signal,
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
              body: JSON.stringify(buildBody()),
            });
            // Server busy (500/503) ho toh thodi der ruk ke dobara try karo
            if (![500, 503].includes(res.status) || attempt === 3) break;
            await res.text().catch(() => {});
            await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
          }
          if (!res.ok) {
            const errText = await res.text();
            let msg = errText;
            try { msg = JSON.parse(errText).error?.message || errText; } catch {}
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
              const t = ev.choices?.[0]?.delta?.content;
              if (t) { full += t; controller.enqueue(encoder.encode(t)); }
            }
          }
          if (!full) controller.enqueue(encoder.encode("\n\n**Error:** Khaali jawab aaya. Dobara try karo."));
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