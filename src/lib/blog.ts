import { Buffer } from "node:buffer";
import { marked } from "marked";
import { renderMermaidSVG } from "beautiful-mermaid";
import sanitizeHtml from "sanitize-html";
import { codeToHtml } from "shiki";
import xcodeDarkTheme from "../themes/xcode-dark.json";
import xcodeLightTheme from "../themes/xcode-light.json";
import {
  fetchCraftBlocks,
  fetchCraftCollectionItems,
  getCraftConfig,
  listCraftCollections,
  listCraftDocuments,
  type CraftBlock,
  type CraftCollectionItem,
  type CraftDocument,
} from "./craft";

const MERMAID_ARROW_COLOR = "#7aa2ff";

export type BlogPost = {
  id: string;
  slug: string;
  path: string;
  title: string;
  excerpt: string;
  publishedAt?: string;
  updatedAt?: string;
  tags: string[];
  html: string;
  breadcrumbs: BlogBreadcrumb[];
};

export type BlogBreadcrumb = {
  title: string;
  path: string;
};

type BlogContent = {
  posts: BlogPost[];
  pages: BlogPost[];
};

type BlogPostResult = {
  post: BlogPost;
  pages: BlogPost[];
};

type RenderContext = {
  pages: BlogPost[];
  path: string;
  breadcrumbs: BlogBreadcrumb[];
  publishedAt?: string;
  updatedAt?: string;
  tags: string[];
};

let cachedContent: Promise<BlogContent> | undefined;

function getBlogContent() {
  cachedContent ??= loadBlogContent();
  return cachedContent;
}

export async function getBlogPosts() {
  return (await getBlogContent()).posts;
}

export async function getBlogPages() {
  return (await getBlogContent()).pages;
}

export async function getBlogPost(path: string | undefined) {
  const routePath = normalizeRoutePath(path);
  const pages = await getBlogPages();
  return pages.find((post) => post.path === routePath);
}

async function loadBlogContent(): Promise<BlogContent> {
  const collectionItems = await loadCollectionItems();

  if (collectionItems.length) {
    const results = await Promise.all(collectionItems.map(collectionItemToPost));
    const posts = sortPosts(results.map((result) => result.post));

    return {
      posts,
      pages: results.flatMap((result) => [result.post, ...result.pages]),
    };
  }

  const documents = await listCraftDocuments();
  const results = await Promise.all(documents.map(documentToPost));
  const posts = sortPosts(results.map((result) => result.post));

  return {
    posts,
    pages: results.flatMap((result) => [result.post, ...result.pages]),
  };
}

async function loadCollectionItems(): Promise<CraftCollectionItem[]> {
  const config = getCraftConfig();

  if (!config) {
    return [];
  }

  const collectionId =
    config.collectionId ??
    (await listCraftCollections(config)).find(
      (collection) => collection.name === (config.collectionName ?? "Posts"),
    )?.id;

  if (!collectionId) {
    return [];
  }

  const items = await fetchCraftCollectionItems(collectionId, config);
  return items.filter((item) => item.properties.hidden !== true);
}

function sortPosts(posts: BlogPost[]) {
  return posts.sort((a, b) => {
    const aTime = Date.parse(a.publishedAt ?? a.updatedAt ?? "");
    const bTime = Date.parse(b.publishedAt ?? b.updatedAt ?? "");
    return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
  });
}

async function documentToPost(document: CraftDocument): Promise<BlogPostResult> {
  const blocks = await fetchCraftBlocks(document.id);
  const title = firstHeading(blocks) ?? document.title;
  const slug = pathSlug(title, document.id);
  const pages: BlogPost[] = [];
  const publishedAt = firstDate(document.createdAt);
  const updatedAt = firstDate(document.lastModifiedAt);
  const breadcrumbs = [{ title, path: slug }];
  const markdown = await blocksToMarkdown(blocks, {
    pages,
    path: slug,
    breadcrumbs,
    publishedAt,
    updatedAt,
    tags: [],
  });

  return {
    post: {
      id: document.id,
      slug,
      path: slug,
      title,
      excerpt: firstParagraph(blocks) ?? "",
      publishedAt,
      updatedAt,
      tags: [],
      html: sanitize(await marked.parse(markdown)),
      breadcrumbs,
    },
    pages,
  };
}

async function collectionItemToPost(item: CraftCollectionItem): Promise<BlogPostResult> {
  const blocks = item.content ?? [];
  const title = item.title || item.markdown || "Untitled";
  const slug = pathSlug(title, item.id);
  const pages: BlogPost[] = [];
  const publishedAt = firstDate(propertyString(item.properties.date));
  const updatedAt = firstDate(item.metadata?.lastModifiedAt);
  const tags = propertyStrings(item.properties.tags);
  const breadcrumbs = [{ title, path: slug }];
  const markdown = await blocksToMarkdown(blocks, {
    pages,
    path: slug,
    breadcrumbs,
    publishedAt,
    updatedAt,
    tags,
  });

  return {
    post: {
      id: item.id,
      slug,
      path: slug,
      title,
      excerpt: firstParagraph(blocks) ?? "",
      publishedAt,
      updatedAt,
      tags,
      html: sanitize(marked.parse(markdown, { async: false }) as string),
      breadcrumbs,
    },
    pages,
  };
}

async function blocksToMarkdown(
  blocks: CraftBlock[],
  context: RenderContext,
  depth = 0,
): Promise<string> {
  const markdown = await Promise.all(blocks.map((block) => blockToMarkdown(block, context, depth)));
  return markdown.filter(Boolean).join("\n\n");
}

async function blockToMarkdown(
  block: CraftBlock,
  context: RenderContext,
  depth: number,
): Promise<string> {
  if (block.type === "image" && block.url) {
    return `![${block.altText ?? ""}](${block.url})`;
  }

  if (block.type === "video" && block.url) {
    return renderVideo(block);
  }

  if (block.type === "richUrl" && block.url) {
    return renderLinkPreview(block);
  }

  if (block.type === "line") {
    return "---";
  }

  if (block.type === "code") {
    const language = block.language ?? "";

    if (language.toLowerCase() === "mermaid") {
      return renderMermaid(block.rawCode ?? block.markdown ?? "");
    }

    return renderCodeBlock(block.rawCode ?? block.markdown ?? "", language);
  }

  if (block.type === "page" || block.type === "collectionItem") {
    return renderNestedPage(block, context);
  }

  const childMarkdown = Array.isArray(block.content)
    ? await blocksToMarkdown(block.content, context, depth + 1)
    : "";
  const markdown = block.markdown ?? "";
  const styledMarkdown = applyBlockStyle(markdown, block);

  return [styledMarkdown, childMarkdown].filter(Boolean).join("\n\n");
}

async function renderNestedPage(block: CraftBlock, parentContext: RenderContext) {
  if (block.properties?.hidden === true) {
    return "";
  }

  const title = stripMarkdown(textFromTitle(block) ?? block.markdown ?? "Untitled");
  const id = block.id ?? title;
  const slug = pathSlug(title, id);
  const path = `${parentContext.path}/${slug}`;
  const content = block.content ?? [];
  const excerpt = firstParagraph(content) ?? "";
  const updatedAt = firstDate(block.metadata?.lastModifiedAt) ?? parentContext.updatedAt;
  const breadcrumbs = [...parentContext.breadcrumbs, { title, path }];
  const context: RenderContext = {
    ...parentContext,
    path,
    breadcrumbs,
    updatedAt,
  };
  const markdown = await blocksToMarkdown(content, context);

  parentContext.pages.push({
    id,
    slug,
    path,
    title,
    excerpt,
    publishedAt: parentContext.publishedAt,
    updatedAt,
    tags: parentContext.tags,
    html: sanitize(marked.parse(markdown, { async: false }) as string),
    breadcrumbs,
  });

  return renderPagePreview({ title, excerpt, path });
}

async function renderCodeBlock(code: string, language: string) {
  const normalizedLanguage = normalizeLanguage(language);
  const highlightedHtml = await highlightCode(code, normalizedLanguage);
  const languageLabel = language ? `<figcaption>${escapeHtml(language)}</figcaption>` : "";

  return `<figure class="code-card">
  ${languageLabel}
  ${highlightedHtml}
</figure>`;
}

async function highlightCode(code: string, language: string) {
  const options = {
    lang: language,
    themes: {
      light: xcodeLightTheme,
      dark: xcodeDarkTheme,
    },
    defaultColor: false,
  } as const;

  try {
    return await codeToHtml(code, options);
  } catch {
    if (language !== "text") {
      return codeToHtml(code, { ...options, lang: "text" });
    }

    return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`;
  }
}

function normalizeLanguage(language: string) {
  const normalized = language.trim().toLowerCase();

  if (!normalized || normalized === "plain" || normalized === "plaintext") {
    return "text";
  }

  return normalized;
}

function applyBlockStyle(markdown: string, block: CraftBlock) {
  if (!markdown) {
    return "";
  }

  if (block.textStyle?.match(/^h[1-4]$/)) {
    if (markdown.trimStart().startsWith("#")) {
      return markdown;
    }

    const level = Number(block.textStyle.slice(1));
    return `${"#".repeat(level)} ${markdown}`;
  }

  if (block.listStyle === "bullet") {
    if (markdown.trimStart().startsWith("- ")) {
      return markdown;
    }

    return `- ${markdown}`;
  }

  if (block.listStyle === "numbered") {
    if (/^\s*\d+\.\s/.test(markdown)) {
      return markdown;
    }

    return `1. ${markdown}`;
  }

  if (block.listStyle === "task") {
    if (/^\s*-\s\[[ xX]\]\s/.test(markdown)) {
      return markdown;
    }

    return `- [ ] ${markdown}`;
  }

  return markdown;
}

function firstHeading(blocks: CraftBlock[]): string | undefined {
  for (const block of blocks) {
    if (block.textStyle === "h1" && block.markdown) {
      return stripMarkdown(block.markdown);
    }

    if ((block.type === "page" || block.type === "collectionItem") && textFromTitle(block)) {
      return stripMarkdown(textFromTitle(block)!);
    }
  }

  return undefined;
}

function firstParagraph(blocks: CraftBlock[]): string | undefined {
  for (const block of blocks) {
    if (block.type === "text" && block.textStyle !== "h1" && block.markdown) {
      return stripMarkdown(block.markdown);
    }
  }

  return undefined;
}

function textFromTitle(block: CraftBlock) {
  if (typeof block.title === "string") {
    return block.title;
  }

  return typeof block.title?.markdown === "string" ? block.title.markdown : undefined;
}

function renderLinkPreview(block: CraftBlock) {
  const title = textFromTitle(block) ?? block.markdown ?? block.url ?? "Link";
  const description = block.description ?? "";
  const url = block.url ?? "";
  const domain = domainForUrl(url);

  return `<a class="link-preview" href="${escapeHtml(url)}">
  <span class="link-preview__icon" aria-hidden="true">↗</span>
  <span class="link-preview__content">
    <span class="link-preview__label">${escapeHtml(domain)}</span>
    <strong>${escapeHtml(stripMarkdown(title))}</strong>
    ${description ? `<span>${escapeHtml(description)}</span>` : ""}
  </span>
</a>`;
}

function renderVideo(block: CraftBlock) {
  const url = block.url ?? "";
  const caption = stripMarkdown(block.altText ?? block.description ?? "");
  const fallbackLabel = caption || "Open video";

  return `<figure class="video-card">
  <video class="video-card__player" src="${escapeHtml(url)}" controls autoplay muted loop playsinline>
    <a href="${escapeHtml(url)}">${escapeHtml(fallbackLabel)}</a>
  </video>
  ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}
</figure>`;
}

function renderPagePreview(page: Pick<BlogPost, "title" | "excerpt" | "path">) {
  return `<a class="page-preview" href="${escapeHtml(postHref(page.path))}">
  <span class="page-preview__icon" aria-hidden="true"></span>
  <span class="page-preview__content">
    <strong>${escapeHtml(page.title)}</strong>
    ${page.excerpt ? `<span>${escapeHtml(page.excerpt)}</span>` : ""}
  </span>
</a>`;
}

function renderMermaid(code: string) {
  try {
    const svg = renderMermaidSVG(withDefaultMermaidArrowStyle(code), {
      bg: "#ffffff",
      fg: "#171717",
      line: MERMAID_ARROW_COLOR,
      accent: MERMAID_ARROW_COLOR,
      muted: "#737373",
      border: "#e5e5e5",
      surface: "#f5f5f5",
      transparent: true,
    });

    const encodedSvg = Buffer.from(svg).toString("base64");

    return `<figure class="mermaid-card">
  <div class="mermaid-card__canvas">
    <img class="mermaid-card__image" alt="Mermaid diagram" src="data:image/svg+xml;base64,${encodedSvg}">
  </div>
</figure>`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `\`\`\`mermaid\n${code}\n\n${message}\n\`\`\``;
  }
}

function withDefaultMermaidArrowStyle(code: string) {
  const source = code.trimEnd();
  const isFlowchart = /^\s*(graph|flowchart)\b/im.test(source);
  const hasArrow = /(?:-->|==>|-.->|<-->|<--|<==|<-\.->|<-.--)/.test(source);
  const hasDefaultLinkStyle = /^\s*linkStyle\s+default\b/im.test(source);

  if (!isFlowchart || !hasArrow || hasDefaultLinkStyle) {
    return source;
  }

  return `${source}\nlinkStyle default stroke:${MERMAID_ARROW_COLOR},stroke-width:2px`;
}

function firstDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function pathSlug(title: string, id: string) {
  return `${slugify(title)}-${id.slice(0, 8)}`;
}

function postHref(path: string) {
  const basePath = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  return `${basePath}posts/${path.replace(/^\/+|\/+$/g, "")}/`;
}

function normalizeRoutePath(value: string | undefined) {
  return (value ?? "")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .join("/");
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "post";
}

function stripMarkdown(value: string) {
  return value
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/#/g, "")
    .replace(/[*_`>~]/g, "")
    .trim();
}

function propertyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function propertyStrings(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function domainForUrl(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitize(html: string) {
  const basePath = import.meta.env.BASE_URL.endsWith("/")
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;

  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "figcaption",
      "figure",
      "img",
      "source",
      "span",
      "strong",
      "video",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      "*": [
        "aria-hidden",
        "aria-label",
        "class",
        "data-arrow-end",
        "data-arrow-start",
        "data-from",
        "data-id",
        "data-label",
        "data-shape",
        "data-style",
        "data-to",
        "id",
        "role",
      ],
      a: ["href", "name", "target", "rel"],
      code: ["class"],
      figcaption: ["class"],
      img: ["src", "alt", "title", "width", "height", "loading"],
      pre: ["class", "style", "tabindex"],
      span: ["class", "style"],
      video: [
        "src",
        "class",
        "controls",
        "autoplay",
        "playsinline",
        "preload",
        "muted",
        "loop",
        "poster",
        "width",
        "height",
      ],
      source: ["src", "type"],
    },
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
      video: ["http", "https"],
      source: ["http", "https"],
    },
    transformTags: {
      a: (tagName, attribs) => {
        const classNames = (attribs.class ?? "").split(/\s+/);
        const href = attribs.href ?? "";
        const isInternalPageLink =
          classNames.includes("page-preview") || href.startsWith(`${basePath}posts/`);

        if (isInternalPageLink) {
          const { rel: _rel, target: _target, ...internalAttribs } = attribs;
          return { tagName, attribs: internalAttribs };
        }

        return {
          tagName,
          attribs: {
            ...attribs,
            rel: "noreferrer",
            target: "_blank",
          },
        };
      },
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }),
    },
  });
}
