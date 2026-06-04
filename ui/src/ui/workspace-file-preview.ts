import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core.js";
import bash from "highlight.js/lib/languages/bash.js";
import c from "highlight.js/lib/languages/c.js";
import cpp from "highlight.js/lib/languages/cpp.js";
import csharp from "highlight.js/lib/languages/csharp.js";
import css from "highlight.js/lib/languages/css.js";
import diff from "highlight.js/lib/languages/diff.js";
import go from "highlight.js/lib/languages/go.js";
import ini from "highlight.js/lib/languages/ini.js";
import java from "highlight.js/lib/languages/java.js";
import javascript from "highlight.js/lib/languages/javascript.js";
import json from "highlight.js/lib/languages/json.js";
import lua from "highlight.js/lib/languages/lua.js";
import makefile from "highlight.js/lib/languages/makefile.js";
import php from "highlight.js/lib/languages/php.js";
import plaintext from "highlight.js/lib/languages/plaintext.js";
import python from "highlight.js/lib/languages/python.js";
import ruby from "highlight.js/lib/languages/ruby.js";
import rust from "highlight.js/lib/languages/rust.js";
import scss from "highlight.js/lib/languages/scss.js";
import sql from "highlight.js/lib/languages/sql.js";
import typescript from "highlight.js/lib/languages/typescript.js";
import html from "highlight.js/lib/languages/xml.js";
import xml from "highlight.js/lib/languages/xml.js";
import yaml from "highlight.js/lib/languages/yaml.js";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("dockerfile", bash);
hljs.registerLanguage("go", go);
hljs.registerLanguage("html", html);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("lua", lua);
hljs.registerLanguage("makefile", makefile);
hljs.registerLanguage("php", php);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("python", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildCopyButtonHtml(content: string): string {
  const attrSafe = content
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<button type="button" class="code-block-copy" data-code="${attrSafe}" aria-label="Copy code"><span class="code-block-copy__idle">Copy</span><span class="code-block-copy__done">Copied!</span></button>`;
}

function renderPreformattedHtml(
  content: string,
  languageLabel: string | null,
  codeHtml: string,
): string {
  const header = `<div class="code-block-header"><span class="code-block-lang">${escapeHtml(languageLabel ?? "text")}</span>${buildCopyButtonHtml(content)}</div>`;
  return `<div class="code-block-wrapper">${header}<pre class="code-block"><code class="hljs">${codeHtml}</code></pre></div>`;
}

export function renderWorkspaceCodePreviewHtml(content: string, language: string | null): string {
  const normalized = content.replace(/\r\n?/g, "\n");
  const highlighted =
    language && language !== "plaintext"
      ? hljs.highlight(normalized, { language, ignoreIllegals: true }).value
      : escapeHtml(normalized);
  return DOMPurify.sanitize(renderPreformattedHtml(normalized, language, highlighted), {
    ALLOWED_TAGS: ["div", "span", "button", "pre", "code"],
    ALLOWED_ATTR: ["class", "data-code", "type", "aria-label"],
  });
}

export function renderWorkspacePlainTextHtml(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n");
  return DOMPurify.sanitize(renderPreformattedHtml(normalized, "text", escapeHtml(normalized)), {
    ALLOWED_TAGS: ["div", "span", "button", "pre", "code"],
    ALLOWED_ATTR: ["class", "data-code", "type", "aria-label"],
  });
}
