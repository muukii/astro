import { Buffer } from "node:buffer";
import { marked } from "marked";
import { renderMermaidSVG } from "beautiful-mermaid";
import sanitizeHtml from "sanitize-html";
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

export type BlogPost = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  publishedAt?: string;
  updatedAt?: string;
  tags: string[];
  html: string;
};

let cachedPosts: Promise<BlogPost[]> | undefined;

export function getBlogPosts() {
  cachedPosts ??= loadBlogPosts();
  return cachedPosts;
}

export async function getBlogPost(slug: string) {
  const posts = await getBlogPosts();
  return posts.find((post) => post.slug === slug);
}

async function loadBlogPosts(): Promise<BlogPost[]> {
  const collectionItems = await loadCollectionItems();

  if (collectionItems.length) {
    return sortPosts(collectionItems.map(collectionItemToPost));
  }

  const documents = await listCraftDocuments();
  const posts = await Promise.all(documents.map(documentToPost));

  return sortPosts(posts);
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

async function documentToPost(document: CraftDocument): Promise<BlogPost> {
  const blocks = await fetchCraftBlocks(document.id);
  const markdown = blocksToMarkdown(blocks);
  const html = sanitize(await marked.parse(markdown));
  const title = firstHeading(blocks) ?? document.title;

  return {
    id: document.id,
    slug: `${slugify(title)}-${document.id.slice(0, 8)}`,
    title,
    excerpt: firstParagraph(blocks) ?? "",
    publishedAt: firstDate(document.createdAt),
    updatedAt: firstDate(document.lastModifiedAt),
    tags: [],
    html,
  };
}

function collectionItemToPost(item: CraftCollectionItem): BlogPost {
  const blocks = item.content ?? [];
  const markdown = blocksToMarkdown(blocks);
  const title = item.title || item.markdown || "Untitled";

  return {
    id: item.id,
    slug: `${slugify(title)}-${item.id.slice(0, 8)}`,
    title,
    excerpt: firstParagraph(blocks) ?? "",
    publishedAt: firstDate(propertyString(item.properties.date)),
    updatedAt: firstDate(item.metadata?.lastModifiedAt),
    tags: propertyStrings(item.properties.tags),
    html: sanitize(marked.parse(markdown, { async: false }) as string),
  };
}

function blocksToMarkdown(blocks: CraftBlock[], depth = 0): string {
  return blocks
    .map((block) => blockToMarkdown(block, depth))
    .filter(Boolean)
    .join("\n\n");
}

function blockToMarkdown(block: CraftBlock, depth: number): string {
  const childMarkdown = Array.isArray(block.content) ? blocksToMarkdown(block.content, depth + 1) : "";

  if (block.type === "image" && block.url) {
    return `![${block.altText ?? ""}](${block.url})`;
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

    return `\`\`\`${language}\n${block.rawCode ?? block.markdown ?? ""}\n\`\`\``;
  }

  if (block.type === "page" || block.type === "collectionItem") {
    const title = textFromTitle(block) ?? block.markdown;
    return [`${"#".repeat(Math.min(depth + 2, 6))} ${title}`, childMarkdown]
      .filter(Boolean)
      .join("\n\n");
  }

  const markdown = block.markdown ?? "";
  const styledMarkdown = applyBlockStyle(markdown, block);

  return [styledMarkdown, childMarkdown].filter(Boolean).join("\n\n");
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
  <span class="link-preview__content">
    <span class="link-preview__label">${escapeHtml(domain)}</span>
    <strong>${escapeHtml(stripMarkdown(title))}</strong>
    ${description ? `<span>${escapeHtml(description)}</span>` : ""}
  </span>
  <span class="link-preview__arrow" aria-hidden="true">↗</span>
</a>`;
}

function renderMermaid(code: string) {
  try {
    const svg = renderMermaidSVG(code, {
      bg: "#ffffff",
      fg: "#171717",
      accent: "#171717",
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

function firstDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
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
  return sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "figcaption",
      "figure",
      "img",
      "span",
      "strong",
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
      img: ["src", "alt", "title", "width", "height", "loading"],
    },
    allowedSchemesByTag: {
      img: ["http", "https", "data"],
    },
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { rel: "noreferrer", target: "_blank" }),
      img: sanitizeHtml.simpleTransform("img", { loading: "lazy" }),
    },
  });
}
