import type { APIRoute } from "astro";
import { getBlogPosts } from "../lib/blog";

const siteTitle = import.meta.env.SITE_TITLE ?? "Craft Journal";
const siteDescription = "A blog powered by Craft and Astro.";

export const GET: APIRoute = async () => {
  const posts = await getBlogPosts();
  const siteUrl = absoluteUrl("/");
  const feedUrl = absoluteUrl("/rss.xml");
  const lastBuildDate = latestDate(posts.map((post) => post.updatedAt ?? post.publishedAt));

  const items = posts
    .map((post) => {
      const url = absoluteUrl(`/posts/${post.path}/`);
      const pubDate = rssDate(post.publishedAt);
      const categories = post.tags
        .map((tag) => `    <category>${escapeXml(tag)}</category>`)
        .join("\n");

      return `  <item>
    <title>${escapeXml(post.title)}</title>
    <link>${escapeXml(url)}</link>
    <guid isPermaLink="true">${escapeXml(url)}</guid>
    <description>${cdata(post.excerpt)}</description>
${pubDate ? `    <pubDate>${pubDate}</pubDate>\n` : ""}${categories ? `${categories}\n` : ""}    <content:encoded>${cdata(makeAbsoluteHtml(post.html))}</content:encoded>
  </item>`;
    })
    .join("\n");

  return new Response(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel>
  <title>${escapeXml(siteTitle)}</title>
  <link>${escapeXml(siteUrl)}</link>
  <description>${escapeXml(siteDescription)}</description>
  <language>ja</language>
  <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
  ${lastBuildDate ? `<lastBuildDate>${lastBuildDate}</lastBuildDate>` : ""}
${items}
</channel>
</rss>
`, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
    },
  });
};

function absoluteUrl(path: string) {
  return new URL(normalizeRelativePath(path), baseUrl()).toString();
}

function baseUrl() {
  const basePath = import.meta.env.BASE_URL ?? "/";
  const pathname = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return new URL(pathname, import.meta.env.SITE ?? "http://localhost:4321");
}

function normalizeRelativePath(path: string) {
  const basePath = (import.meta.env.BASE_URL ?? "/").replace(/^\/+|\/+$/g, "");
  let relativePath = path.replace(/^\/+/, "");

  if (basePath && relativePath === basePath) {
    relativePath = "";
  } else if (basePath && relativePath.startsWith(`${basePath}/`)) {
    relativePath = relativePath.slice(basePath.length + 1);
  }

  return relativePath;
}

function makeAbsoluteHtml(html: string) {
  return html
    .replaceAll(/(href|src)="\/(?!\/)([^"]*)"/g, (_match, attribute: string, path: string) => {
      return `${attribute}="${absoluteUrl(`/${path}`)}"`;
    })
    .replaceAll(/(href|src)="(?![a-z][a-z0-9+.-]*:|#)([^"]*)"/gi, (_match, attribute: string, path: string) => {
      return `${attribute}="${absoluteUrl(path)}"`;
    });
}

function latestDate(values: Array<string | undefined>) {
  const latestTime = values.reduce((latest, value) => {
    const time = Date.parse(value ?? "");
    return Number.isNaN(time) ? latest : Math.max(latest, time);
  }, 0);

  return latestTime ? new Date(latestTime).toUTCString() : undefined;
}

function rssDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toUTCString();
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cdata(value: string) {
  return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}
