import { html, nothing, type TemplateResult } from "lit";
import { ref } from "lit/directives/ref.js";
import { icons } from "../icons.ts";
import { buildWorkspaceDownloadUrl, buildWorkspaceInlineUrl } from "./artifact-urls.ts";

export type ArtifactFocusItem = {
  kind: "image" | "html";
  fileName: string;
  workspacePath: string;
  caption?: string;
};

export function renderArtifactFocusViewer(params: {
  artifact: ArtifactFocusItem | null | undefined;
  onClose?: () => void;
}): TemplateResult | typeof nothing {
  const artifact = params.artifact;
  if (!artifact || !params.onClose) {
    return nothing;
  }
  const inlineUrl = buildWorkspaceInlineUrl(artifact.workspacePath);
  const close = params.onClose;
  return html`
    <section
      class="artifact-focus-viewer"
      role="dialog"
      aria-modal="true"
      aria-label=${`Artifact viewer: ${artifact.fileName}`}
      tabindex="-1"
      ${ref((element) => {
        const viewer = element as HTMLElement | undefined;
        if (viewer && !viewer.contains(document.activeElement)) {
          queueMicrotask(() => viewer.isConnected && viewer.focus());
        }
      })}
      @keydown=${(event: KeyboardEvent) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <header class="artifact-focus-viewer__toolbar">
        <div class="artifact-focus-viewer__identity">
          <strong class="artifact-focus-viewer__name">${artifact.fileName}</strong>
          ${artifact.caption
            ? html`<span class="artifact-focus-viewer__caption">${artifact.caption}</span>`
            : nothing}
        </div>
        <div class="artifact-focus-viewer__actions">
          <a
            class="btn btn--sm artifact-action-btn artifact-focus-viewer__action"
            href=${buildWorkspaceDownloadUrl(artifact.workspacePath)}
            title="Download"
            aria-label=${`Download ${artifact.fileName}`}
          >
            ${icons.download}
          </a>
          <button
            class="btn btn--sm artifact-action-btn artifact-focus-viewer__action artifact-focus-viewer__close"
            type="button"
            title="Back to card"
            aria-label="Close artifact viewer"
            @click=${close}
          >
            ${icons.x}
          </button>
        </div>
      </header>
      <div class="artifact-focus-viewer__content">
        ${artifact.kind === "image"
          ? html`<img
              class="artifact-focus-viewer__image"
              src=${inlineUrl}
              alt=${artifact.caption || artifact.fileName}
            />`
          : html`<iframe
              class="artifact-focus-viewer__html"
              src=${inlineUrl}
              title=${artifact.caption || artifact.fileName}
              sandbox="allow-scripts"
            ></iframe>`}
      </div>
    </section>
  `;
}
