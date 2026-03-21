import React from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-bash';

type CodeLang = 'tsx' | 'typescript' | 'bash';

const Code: React.FC<{ children: string; lang?: CodeLang }> = ({ children, lang = 'tsx' }) => {
    const grammar = (Prism.languages[lang] ?? Prism.languages.plaintext)!;
    const highlighted = Prism.highlight(children.trim(), grammar, lang);
    const [ready, setReady] = React.useState(false);

    React.useEffect(() => { setReady(true); }, []);

    const style: React.CSSProperties = {
        background: 'oklch(0.08 0.025 280)',
        border: '1px solid oklch(0.68 0.28 285 / 0.18)',
        boxShadow: '0 0 20px oklch(0.68 0.28 285 / 0.04)',
    };

    if (!ready) {
        return (
            <pre className="rounded-xl p-4 overflow-x-auto text-sm font-mono leading-relaxed my-4" style={style}>
                <code className="text-foreground/80">{children.trim()}</code>
            </pre>
        );
    }

    return (
        <pre className={`rounded-xl p-4 overflow-x-auto text-sm font-mono leading-relaxed my-4 language-${lang}`} style={style}>
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
        </pre>
    );
};

export default Code;
