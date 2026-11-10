"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import { MODES } from "@/lib/prompts";
import Markdown from "@/components/Markdown";
import Icon from "@/components/Icon";

const attSrc = (a) => `data:${a.mediaType};base64,${a.data}`;

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82).split(",")[1]);
    };
    img.onerror = reject;
    img.src = url;
  });
}
const readB64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });

export default function Home() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(false);
  const [convs, setConvs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState("coding");
  const [loading, setLoading] = useState(false);
  const [menu, setMenu] = useState(false);
  const [q, setQ] = useState("");
  const [atts, setAtts] = useState([]);
  const [tools, setTools] = useState({ search: false, deep: false, think: false, image: false });
  const [plus, setPlus] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [instr, setInstr] = useState("");
  const [theme, setTheme] = useState("dark");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(-1);
  const [toast, setToast] = useState("");
  const bottomRef = useRef(null), taRef = useRef(null), fileRef = useRef(null), abortRef = useRef(null), recRef = useRef(null);

  const say = (t) => { setToast(t); setTimeout(() => setToast(""), 2500); };

  useEffect(() => {
    try {
      const t = localStorage.getItem("yx_theme") || "dark";
      setTheme(t); document.documentElement.dataset.theme = t;
      setInstr(localStorage.getItem("yx_instr") || "");
    } catch {}
  }, []);
  function toggleTheme() {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t); document.documentElement.dataset.theme = t;
    try { localStorage.setItem("yx_theme", t); } catch {}
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/login");
      else { setSession(data.session); setReady(true); }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) router.replace("/login"); });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  const loadConvs = useCallback(async () => {
    const { data: s } = await supabase.auth.getSession();
    const uid = s.session?.user?.id;
    if (!uid) return;
    const { data } = await supabase.from("conversations").select("id,title,mode,updated_at,pinned,is_shared")
      .eq("user_id", uid).order("pinned", { ascending: false }).order("updated_at", { ascending: false });
    setConvs(data || []);
  }, []);
  useEffect(() => { if (ready) loadConvs(); }, [ready, loadConvs]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [messages]);

  async function openConv(c) {
    if (loading) return;
    setActiveId(c.id); setMode(c.mode in MODES ? c.mode : "coding"); setMenu(false);
    const { data } = await supabase.from("messages").select("id,role,content,attachments").eq("conversation_id", c.id).order("created_at");
    setMessages(data || []);
  }
  function newChat() { if (loading) return; setActiveId(null); setMessages([]); setAtts([]); setMenu(false); }

  async function removeConv(e, id) {
    e.stopPropagation();
    if (!confirm("Ye chat delete karni hai?")) return;
    await supabase.from("conversations").delete().eq("id", id);
    if (id === activeId) newChat();
    loadConvs();
  }
  async function renameConv(e, c) {
    e.stopPropagation();
    const t = prompt("Chat ka naya naam:", c.title);
    if (!t || !t.trim()) return;
    await supabase.from("conversations").update({ title: t.trim().slice(0, 80) }).eq("id", c.id);
    loadConvs();
  }
  async function pinConv(e, c) {
    e.stopPropagation();
    await supabase.from("conversations").update({ pinned: !c.pinned }).eq("id", c.id);
    loadConvs();
  }

  // ---- attachments
  async function addFiles(files) {
    const list = Array.from(files || []);
    for (const f of list) {
      if (atts.length >= 5) { say("Max 5 attachments"); break; }
      try {
        if (f.type.startsWith("image/")) {
          const data = await compressImage(f);
          setAtts((a) => [...a, { type: "image", name: f.name, mediaType: "image/jpeg", data }]);
        } else if (f.type === "application/pdf") {
          if (f.size > 2.5 * 1024 * 1024) { say("PDF max 2.5MB"); continue; }
          setAtts((a) => [...a, { type: "pdf", name: f.name, data: null, _b64: null }]);
          const data = await readB64(f);
          setAtts((a) => a.map((x) => (x.name === f.name && x.type === "pdf" ? { type: "pdf", name: f.name, data } : x)));
        } else if (f.size < 400 * 1024) {
          const text = await f.text();
          if (/\u0000/.test(text.slice(0, 2000))) { say(f.name + ": ye file type support nahi"); continue; }
          setAtts((a) => [...a, { type: "text", name: f.name, text: text.slice(0, 60000) }]);
        } else say(f.name + " bahut badi hai (max 400KB)");
      } catch { say("File read nahi hui: " + f.name); }
    }
  }
  function onPaste(e) {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length) { e.preventDefault(); addFiles(files); }
  }
  const toggleTool = (k) => setTools((t) => {
    const n = { ...t, [k]: !t[k] };
    if (k === "deep" && n.deep) n.search = true;
    return n;
  });

  // ---- send
  async function send(textArg, regen = false) {
    const text = (textArg ?? input).trim();
    if (loading) return;
    if (!regen && !text && atts.length === 0) return;
    if (atts.some((a) => a.type === "pdf" && !a.data)) return say("PDF abhi load ho rahi hai...");
    const sendAtts = regen ? [] : atts;
    if (!regen) { setInput(""); setAtts([]); if (taRef.current) taRef.current.style.height = "auto"; }
    setLoading(true);
    setMessages((m) => {
      const base = regen ? (m[m.length - 1]?.role === "assistant" ? m.slice(0, -1) : m) : [...m, { role: "user", content: text, attachments: sendAtts }];
      return [...base, { role: "assistant", content: "" }];
    });
    const setLast = (content) => setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content }; return c; });
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const { data } = await supabase.auth.getSession();
      const res = await fetch("/api/chat", {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token}` },
        body: JSON.stringify({ message: text, conversationId: activeId, mode, tools, attachments: sendAtts, regenerate: regen, instructions: instr }),
      });
      if (!res.ok) {
        let msg = "Kuch galat hua.";
        try { msg = (await res.json()).error || msg; } catch {}
        setLast("**Error:** " + msg);
      } else {
        const newId = res.headers.get("X-Conversation-Id");
        const reader = res.body.getReader(), dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setLast(acc);
        }
        if (newId && newId !== activeId) setActiveId(newId);
        loadConvs();
      }
    } catch (e) {
      if (e?.name !== "AbortError") setLast("**Error:** Network problem hai. Internet check karke dobara try karo.");
      else loadConvs();
    } finally { setLoading(false); abortRef.current = null; }
  }
  const stop = () => abortRef.current?.abort();

  // ---- voice
  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return say("Voice input ke liye Chrome/Edge use karo");
    if (listening) { recRef.current?.stop(); return; }
    const r = new SR(); const base = input;
    r.lang = "hi-IN"; r.interimResults = true; r.continuous = true;
    r.onresult = (e) => { let t = ""; for (const x of e.results) t += x[0].transcript; setInput((base ? base + " " : "") + t); };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    recRef.current = r; r.start(); setListening(true);
  }
  function speak(i, text) {
    if (!("speechSynthesis" in window)) return say("Is browser mein read-aloud nahi hai");
    window.speechSynthesis.cancel();
    if (speaking === i) { setSpeaking(-1); return; }
    const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, " code block ").replace(/[#*_`>|-]/g, " "));
    u.onend = () => setSpeaking(-1);
    setSpeaking(i); window.speechSynthesis.speak(u);
  }
  async function copyText(t) { try { await navigator.clipboard.writeText(t); say("Copy ho gaya"); } catch {} }

  // ---- share / export
  const active = convs.find((c) => c.id === activeId);
  const shareUrl = active ? `${typeof window !== "undefined" ? window.location.origin : ""}/share/${active.id}` : "";
  async function setShared(on) {
    if (!active) return;
    const { error } = await supabase.from("conversations").update({ is_shared: on }).eq("id", active.id);
    if (error) return say("Share nahi ho paya: " + error.message);
    await loadConvs();
  }
  function exportChat() {
    if (!messages.length) return say("Export ke liye pehle chat karo");
    const md = `# ${active?.title || "Yetvix AI chat"}\n\n` + messages.map((m) => `**${m.role === "user" ? "You" : "Yetvix AI"}:**\n\n${m.content}`).join("\n\n---\n\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    a.download = (active?.title || "yetvix-chat").replace(/[^\w-]+/g, "_").slice(0, 40) + ".md"; a.click();
  }
  function saveSettings() {
    try { localStorage.setItem("yx_instr", instr); } catch {}
    setSettingsOpen(false); say("Settings save ho gayi");
  }

  function onKey(e) { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }
  function onInput(e) {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + "px";
  }

  if (!ready) return <div className="boot"><img src="/logo.png" width="56" alt="" className="pulse" /></div>;
  const m = MODES[mode];
  const shown = convs.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()));
  const toolList = [
    ["search", "globe", "Web search", "Live internet se jawab"],
    ["deep", "research", "Deep research", "Kai sources, full report"],
    ["think", "bulb", "Thinking", "Mushkil sawaalon ke liye"],
    ["image", "image", "Create image", "SVG image/logo banao"],
  ];
  const lastIdx = messages.length - 1;

  return (
    <div className="app">
      <aside className={"side" + (menu ? " open" : "")}>
        <div className="logo"><img className="logomark" src="/logo.png" alt="" />Yetvix <b>AI</b></div>
        <button className="primary newbtn" onClick={newChat}><Icon name="plus" size={16} /> New chat</button>
        <div className="searchbox"><Icon name="search" size={15} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chats search karo" /></div>
        <div className="convs">
          {shown.length === 0 && <p className="muted small pad">{convs.length ? "Kuch nahi mila." : "Abhi koi chat nahi hai."}</p>}
          {shown.map((c) => (
            <div key={c.id} className={"conv" + (c.id === activeId ? " active" : "")} onClick={() => openConv(c)}>
              <span className={"dot " + c.mode} />
              <span className="ctitle">{c.title}</span>
              {c.is_shared && <span className="tag">shared</span>}
              <span className="cact">
                <button aria-label="Pin" className={c.pinned ? "on" : ""} onClick={(e) => pinConv(e, c)}><Icon name="pin" size={14} /></button>
                <button aria-label="Rename" onClick={(e) => renameConv(e, c)}><Icon name="edit" size={14} /></button>
                <button aria-label="Delete" className="d" onClick={(e) => removeConv(e, c.id)}><Icon name="trash" size={14} /></button>
              </span>
            </div>
          ))}
        </div>
        <div className="user">
          <span className="avatar">{(session?.user?.email || "?")[0].toUpperCase()}</span>
          <span className="email">{session?.user?.email}</span>
          <button className="iconbtn" title="Settings" onClick={() => setSettingsOpen(true)}><Icon name="sliders" /></button>
          <button className="iconbtn" title="Logout" onClick={() => supabase.auth.signOut()}><Icon name="logout" /></button>
        </div>
      </aside>
      {menu && <div className="scrim" onClick={() => setMenu(false)} />}

      <main className="main">
        <header className="top">
          <button className="iconbtn burger" aria-label="Menu" onClick={() => setMenu(true)}><Icon name="menu" size={22} /></button>
          <div className="tabs" role="tablist">
            {Object.entries(MODES).map(([k, v]) => (
              <button key={k} role="tab" aria-selected={mode === k} className={"tab " + k + (mode === k ? " on" : "")} disabled={loading} onClick={() => setMode(k)}>{v.label}</button>
            ))}
          </div>
          <div className="topact">
            <button className="ghost" onClick={() => (active ? setShareOpen(true) : say("Pehle chat shuru karo, phir share karo"))}><Icon name="share" size={16} /><span>Share</span></button>
            <button className="iconbtn" title="Export (.md)" onClick={exportChat}><Icon name="download" /></button>
            <button className="iconbtn" title="Theme" onClick={toggleTheme}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>
          </div>
        </header>

        <section className="feed" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
          {messages.length === 0 ? (
            <div className="empty">
              <img className="heroicon" src="/logo.png" alt="" />
              <h2>{m.hint}</h2>
              <p className="muted">Kuch bhi poocho, ya neeche se shuru karo.</p>
              <div className="chips">
                {m.suggestions.map((s) => (<button key={s} className="chip" onClick={() => send(s)}>{s}</button>))}
              </div>
            </div>
          ) : (
            <div className="thread">
              {messages.map((msg, i) => (
                <div key={msg.id || i} className={"row " + msg.role}>
                  <div className="bubble">
                    {msg.role === "assistant" ? (
                      <>
                        {msg.content ? <Markdown text={msg.content} /> : <span className="typing"><i /><i /><i /></span>}
                        {msg.content && !(loading && i === lastIdx) && (
                          <div className="msgact">
                            <button title="Copy" onClick={() => copyText(msg.content)}><Icon name="copy" size={15} /></button>
                            <button title="Read aloud" className={speaking === i ? "on" : ""} onClick={() => speak(i, msg.content)}><Icon name="speaker" size={15} /></button>
                            {i === lastIdx && <button title="Regenerate" onClick={() => send("", true)}><Icon name="refresh" size={15} /></button>}
                          </div>
                        )}
                      </>
                    ) : (
                      <>
                        {(msg.attachments || []).length > 0 && (
                          <div className="attrow">
                            {msg.attachments.map((a, k) => a.type === "image"
                              ? <img key={k} className="attimg" src={attSrc(a)} alt={a.name} />
                              : <span key={k} className="attfile"><Icon name="file" size={14} />{a.name}</span>)}
                          </div>
                        )}
                        <p className="plain">{msg.content}</p>
                      </>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </section>

        <footer className="composer">
          {plus && <div className="popscrim" onClick={() => setPlus(false)} />}
          {plus && (
            <div className="popmenu">
              <button onClick={() => { fileRef.current?.click(); setPlus(false); }}>
                <Icon name="clip" /><span><b>Photos & files</b><small>Image, PDF, code, text</small></span>
              </button>
              {toolList.map(([k, ic, t, d]) => (
                <button key={k} className={tools[k] ? "on" : ""} onClick={() => { toggleTool(k); setPlus(false); }}>
                  <Icon name={ic} /><span><b>{t}</b><small>{d}</small></span>{tools[k] && <Icon name="check" size={16} />}
                </button>
              ))}
            </div>
          )}
          <div className="box">
            {(atts.length > 0 || Object.values(tools).some(Boolean)) && (
              <div className="chiprow">
                {atts.map((a, i) => (
                  <span key={i} className="achip">
                    {a.type === "image" ? <img src={attSrc(a)} alt="" /> : <Icon name="file" size={14} />}
                    <em>{a.name}</em>{a.type === "pdf" && !a.data && <i>...</i>}
                    <button aria-label="Remove" onClick={() => setAtts((x) => x.filter((_, j) => j !== i))}><Icon name="x" size={12} /></button>
                  </span>
                ))}
                {toolList.filter(([k]) => tools[k]).map(([k, ic, t]) => (
                  <span key={k} className="achip tool"><Icon name={ic} size={14} /><em>{t}</em>
                    <button aria-label="Remove" onClick={() => toggleTool(k)}><Icon name="x" size={12} /></button></span>
                ))}
              </div>
            )}
            <div className="inputrow">
              <button className="roundbtn" aria-label="Tools" onClick={() => setPlus(!plus)}><Icon name="plus" /></button>
              <textarea ref={taRef} rows={1} value={input} onChange={onInput} onKeyDown={onKey} onPaste={onPaste}
                placeholder={mode === "study" ? "Koi topic ya sawaal likho..." : mode === "coding" ? "Code ya error yahan paste karo..." : mode === "writing" ? "Kya likhwana hai?" : "Yetvix AI se kuch bhi poocho..."} />
              <button className={"roundbtn" + (listening ? " rec" : "")} aria-label="Voice" onClick={toggleMic}><Icon name="mic" /></button>
              {loading
                ? <button className="send" onClick={stop} aria-label="Stop"><Icon name="stop" size={16} /></button>
                : <button className="send" onClick={() => send()} disabled={!input.trim() && atts.length === 0} aria-label="Send"><Icon name="send" size={18} /></button>}
            </div>
          </div>
          <input ref={fileRef} type="file" multiple hidden accept="image/*,application/pdf,.txt,.md,.csv,.json,.js,.jsx,.ts,.tsx,.py,.java,.c,.cpp,.html,.css,.sql,.xml,.yml,.yaml,.log"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
          <p className="muted small">Enter = send, Shift+Enter = nayi line. AI galti kar sakta hai, zaroori cheezein check karo.</p>
        </footer>
      </main>

      {shareOpen && active && (
        <div className="modalwrap" onClick={() => setShareOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Chat share karo</h3>
            {active.is_shared ? (
              <>
                <p className="muted small">Jiske paas ye link hai wo is chat ko (read-only) dekh sakta hai.</p>
                <div className="linkrow"><input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                  <button className="primary" onClick={() => copyText(shareUrl)}>Copy</button></div>
                <div className="modalact">
                  {typeof navigator !== "undefined" && navigator.share && <button className="ghost" onClick={() => navigator.share({ title: active.title, url: shareUrl }).catch(() => {})}>Share via...</button>}
                  <button className="ghost danger" onClick={() => setShared(false)}>Sharing band karo</button>
                </div>
              </>
            ) : (
              <>
                <p className="muted small">Public link banega. Koi bhi link wala is chat ko padh sakta hai, edit nahi kar sakta. Kabhi bhi band kar sakte ho.</p>
                <div className="modalact"><button className="primary" onClick={() => setShared(true)}>Link banao</button></div>
              </>
            )}
            <button className="x" aria-label="Close" onClick={() => setShareOpen(false)}><Icon name="x" /></button>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="modalwrap" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Custom instructions</h3>
            <p className="muted small">Yetvix AI har chat mein ye follow karega (jaise: &quot;Mujhe short jawab do&quot;, &quot;Main B.Tech 2nd year ka student hoon&quot;).</p>
            <textarea className="instr" rows={6} maxLength={1500} value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Apni preferences likho..." />
            <div className="modalact"><button className="primary" onClick={saveSettings}>Save</button></div>
            <button className="x" aria-label="Close" onClick={() => setSettingsOpen(false)}><Icon name="x" /></button>
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
