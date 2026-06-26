import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { slugify, type Heading } from './headings';

/**
 * Render pasted Markdown to safe HTML and build a contents list from its
 * headings. The TOC is derived from the rendered DOM (so it covers both `#`
 * and underline-style headings) and the same slugs are written back as element
 * ids, guaranteeing the contents links always resolve.
 */

marked.setOptions({ gfm: true, breaks: false, async: false });

export interface RenderedPlan {
  html: string;
  toc: Heading[];
}

export function renderPlan(markdown: string): RenderedPlan {
  const rawHtml = marked.parse(markdown) as string;
  const safeHtml = DOMPurify.sanitize(rawHtml);
  return addHeadingIds(safeHtml);
}

function addHeadingIds(html: string): RenderedPlan {
  // Guard for non-DOM environments (e.g. unit tests); the app always has a DOM.
  if (typeof document === 'undefined') return { html, toc: [] };

  const template = document.createElement('template');
  template.innerHTML = html;

  const used = new Set<string>();
  const toc: Heading[] = [];

  template.content.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((el) => {
    const text = el.textContent?.trim() ?? '';
    const depth = Number(el.tagName.slice(1));
    const slug = slugify(text, used);
    el.id = slug;
    toc.push({ depth, text, slug });
  });

  return { html: template.innerHTML, toc };
}
