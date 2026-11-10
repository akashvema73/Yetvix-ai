"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Markdown from "@/components/Markdown";

export default function SharedChat() {
  const { id } = useParams();
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    (async () => {
      const { data: conv } = await supabase.from("conversations").select("id,title,is_shared").eq("id", id).eq("is_shared", true).maybeSingle();
      if (!conv) return setState({ loading: false, missing: true });
      const { data: msgs } = await supabase.from("messages").select("id,role,content,attachments").eq("conversation_id", id).order("created_at");
      setState({ loading: false, conv, msgs: msgs || [] });
    })();
  }, [id]);

  if (state.loading) return <div className="boot">Load ho raha hai...</div>;
  if (state.missing)
    return (
      <div className="boot col">
        <img src="/logo.png" width="64" alt="" />
        <h2>Ye chat available nahi hai</h2>
        <p className="muted">Link galat hai ya owner ne sharing band kar di hai.</p>
        <a className="primary linkbtn" href="/">Yetvix AI kholo</a>
      </div>
    );
  return (
    <div className="sharepage">
      <header className="sharetop">
        <a className="logo" href="/"><img className="logomark" src="/logo.png" alt="" />Yetvix <b>AI</b></a>
        <a className="primary linkbtn" href="/">Khud try karo</a>
      </header>
      <div className="thread shared">
        <h1 className="sharetitle">{state.conv.title}</h1>
        <p className="muted small">Shared conversation, read-only</p>
        {state.msgs.map((m) => (
          <div key={m.id} className={"row " + m.role}>
            <div className="bubble">
              {m.role === "assistant" ? <Markdown text={m.content} /> : <p className="plain">{m.content}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
