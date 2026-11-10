"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";

const FEATURES = ["Live streaming jawab", "Photo, PDF aur file upload", "Web search & Deep research", "Chat share link", "Voice input", "Image (SVG) creation"];

export default function Login() {
  const router = useRouter();
  const [isSignup, setIsSignup] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { if (data.session) router.replace("/"); });
  }, [router]);

  async function submit(e) {
    e.preventDefault();
    setError(""); setNotice("");
    if (password.length < 6) return setError("Password kam se kam 6 characters ka hona chahiye.");
    setBusy(true);
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        if (data.session) router.replace("/");
        else setNotice("Account ban gaya. Email check karke confirm karo, phir login karo.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.replace("/");
      }
    } catch (err) {
      setError(err.message || "Kuch galat hua, dobara try karo.");
    } finally { setBusy(false); }
  }

  async function forgot() {
    setError(""); setNotice("");
    if (!email) return setError("Pehle upar email likho.");
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if (error) setError(error.message); else setNotice("Password reset link email par bhej diya.");
  }

  return (
    <main className="auth">
      <div className="authside">
        <div className="logo big"><img className="logomark" src="/logo.png" alt="" />Yetvix <b>AI</b></div>
        <h1>Build faster. <span className="grad">Learn smarter.</span> Create more.</h1>
        <p>Code, concepts aur content, sab kuch ek hi jagah. Aapka personal AI workspace.</p>
        <ul className="feat">{FEATURES.map((f) => <li key={f}>{f}</li>)}</ul>
      </div>
      <form className="authcard" onSubmit={submit}>
        <img className="authlogo" src="/logo.png" alt="Yetvix AI" />
        <h2>{isSignup ? "Account banao" : "Wapas aao"}</h2>
        <label>Email
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="aap@example.com" autoComplete="email" />
        </label>
        <label>Password
          <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Kam se kam 6 characters" autoComplete={isSignup ? "new-password" : "current-password"} />
        </label>
        {error && <div className="msg err" role="alert">{error}</div>}
        {notice && <div className="msg ok" role="status">{notice}</div>}
        <button className="primary" disabled={busy}>{busy ? "Ruko..." : isSignup ? "Sign up" : "Login"}</button>
        {!isSignup && <button type="button" className="link" onClick={forgot}>Password bhool gaye?</button>}
        <button type="button" className="link" onClick={() => { setIsSignup(!isSignup); setError(""); setNotice(""); }}>
          {isSignup ? "Pehle se account hai? Login karo" : "Naya account? Sign up karo"}
        </button>
      </form>
    </main>
  );
}
