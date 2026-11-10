"use client";
import { useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import Icon from "./Icon";

function Pre({ children }) {
  const code = Array.isArray(children) ? children[0] : children;
  const lang = (/language-([\w+-]+)/.exec(code?.props?.className || "") || [])[1] || "";
  const text = String(code?.props?.children ?? "").replace(/\n$/, "");
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const isSvg = lang === "svg" && /<svg[\s\S]*<\/svg>\s*$/i.test(text);
  const uri = isSvg ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text) : "";

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = uri; a.download = "yetvix-image.svg"; a.click();
  };

  return (
    <div className="codewrap">
      <div className="codebar">
        <span>{isSvg ? "image" : lang || "code"}</span>
        <div className="codeact">
          {isSvg && <button type="button" onClick={() => setShowCode(!showCode)}>{showCode ? "Image" : "Code"}</button>}
          {isSvg && <button type="button" onClick={download}><Icon name="download" size={13} /> SVG</button>}
          <button type="button" onClick={copy}><Icon name={copied ? "check" : "copy"} size={13} /> {copied ? "Copied" : "Copy"}</button>
        </div>
      </div>
      {isSvg && !showCode ? (
        <div className="svgprev"><img src={uri} alt="Generated" /></div>
      ) : (
        <pre>{children}</pre>
      )}
    </div>
  );
}

export default function Markdown({ text }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: Pre, a: (p) => <a {...p} target="_blank" rel="noopener noreferrer" /> }}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
