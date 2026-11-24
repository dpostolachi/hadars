import React from "react";
import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-graphql";
import RemixIcon from "./RemixIcon";

type CodeLang = "tsx" | "typescript" | "bash" | "toml" | "graphql";
const labels: Record<CodeLang, string> = {
  tsx: "React / TSX",
  typescript: "TypeScript",
  bash: "Shell",
  toml: "TOML",
  graphql: "GraphQL",
};

const Code: React.FC<{ children: string; lang?: CodeLang }> = ({
  children,
  lang = "tsx",
}) => {
  const source = children.trim();
  const [ready, setReady] = React.useState(false);
  const [copied, setCopied] = React.useState(false);
  const [status, setStatus] = React.useState("");
  React.useEffect(() => {
    setReady(true);
  }, []);
  React.useEffect(() => {
    setCopied(false);
    setStatus("");
  }, [source]);
  const grammar = (Prism.languages[lang] ?? Prism.languages.plaintext)!;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopied(true);
      setStatus("Code copied.");
    } catch {
      setStatus("Select the code below to copy it.");
    }
  };
  return (
    <div className="docs-code-container">
      <div className="docs-codebar">
        <span>{labels[lang]}</span>
        <button
          type="button"
          className="docs-copy-button"
          disabled={!ready}
          onClick={copy}
          aria-label="Copy code example"
        >
          <RemixIcon name={copied ? "check-line" : "file-copy-line"} />
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        className={`docs-code language-${lang}`}
        tabIndex={0}
        aria-label={`${labels[lang]} code example`}
      >
        {ready ? (
          <code
            dangerouslySetInnerHTML={{
              __html: Prism.highlight(source, grammar, lang),
            }}
          />
        ) : (
          <code>{source}</code>
        )}
      </pre>
      <span className="sr-only" role="status">
        {status}
      </span>
    </div>
  );
};
export default Code;
