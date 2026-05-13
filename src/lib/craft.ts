export type CraftDocument = {
  id: string;
  title: string;
  createdAt?: string;
  lastModifiedAt?: string;
  raw: Record<string, unknown>;
};

export type CraftBlock = Record<string, unknown> & {
  id?: string;
  type?: string;
  markdown?: string;
  rawCode?: string;
  language?: string;
  textStyle?: string;
  listStyle?: string;
  url?: string;
  description?: string;
  altText?: string;
  title?: string | {
    markdown?: string;
  };
  properties?: Record<string, unknown>;
  content?: CraftBlock[];
  metadata?: {
    createdAt?: string;
    lastModifiedAt?: string;
  };
};

export type CraftCollection = {
  id: string;
  name: string;
  itemCount?: number;
  documentId?: string;
};

export type CraftCollectionItem = CraftBlock & {
  id: string;
  title: string;
  properties: Record<string, unknown>;
  content?: CraftBlock[];
};

export type CraftConfig = {
  apiBaseUrl: string;
  token?: string;
  location?: string;
  folderId?: string;
  documentIds?: string[];
  collectionId?: string;
  collectionName?: string;
};

type CraftListResponse<T> = {
  items?: T[];
};

export function getCraftConfig(): CraftConfig | undefined {
  const apiBaseUrl = import.meta.env.CRAFT_API_BASE_URL?.trim();

  if (!apiBaseUrl) {
    return undefined;
  }

  return {
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ""),
    token: import.meta.env.CRAFT_API_TOKEN?.trim() || undefined,
    location: import.meta.env.CRAFT_LOCATION?.trim() || undefined,
    folderId: import.meta.env.CRAFT_FOLDER_ID?.trim() || undefined,
    documentIds: parseDocumentIds(import.meta.env.CRAFT_DOCUMENT_IDS),
    collectionId: import.meta.env.CRAFT_COLLECTION_ID?.trim() || undefined,
    collectionName: import.meta.env.CRAFT_COLLECTION_NAME?.trim() || undefined,
  };
}

export function isCraftConfigured() {
  return Boolean(getCraftConfig());
}

export async function listCraftDocuments(config = getCraftConfig()): Promise<CraftDocument[]> {
  if (!config) {
    return [];
  }

  if (config.documentIds?.length) {
    return config.documentIds.map((id) => ({
      id,
      title: id,
      raw: { id },
    }));
  }

  const params = new URLSearchParams({ fetchMetadata: "true" });

  if (config.folderId) {
    params.set("folderId", config.folderId);
  } else if (config.location) {
    params.set("location", config.location);
  }

  const response = await craftFetch<CraftListResponse<Record<string, unknown>>>(
    config,
    `/documents?${params.toString()}`,
  );

  return (response.items ?? [])
    .map(normalizeDocument)
    .filter((document): document is CraftDocument => Boolean(document));
}

export async function fetchCraftBlocks(
  documentId: string,
  config = getCraftConfig(),
): Promise<CraftBlock[]> {
  if (!config) {
    return [];
  }

  const params = new URLSearchParams({
    id: documentId,
    fetchMetadata: "true",
  });

  const block = await craftFetch<CraftBlock>(config, `/blocks?${params.toString()}`);
  return Array.isArray(block.content) ? block.content : [block];
}

export async function listCraftCollections(config = getCraftConfig()): Promise<CraftCollection[]> {
  if (!config) {
    return [];
  }

  const params = new URLSearchParams();
  for (const documentId of config.documentIds ?? []) {
    params.append("documentIds", documentId);
  }

  const query = params.size ? `?${params.toString()}` : "";
  const response = await craftFetch<CraftListResponse<Record<string, unknown>>>(
    config,
    `/collections${query}`,
  );

  return (response.items ?? [])
    .map(normalizeCollection)
    .filter((collection): collection is CraftCollection => Boolean(collection));
}

export async function fetchCraftCollectionItems(
  collectionId: string,
  config = getCraftConfig(),
): Promise<CraftCollectionItem[]> {
  if (!config) {
    return [];
  }

  const response = await craftFetch<CraftListResponse<CraftCollectionItem>>(
    config,
    `/collections/${encodeURIComponent(collectionId)}/items?maxDepth=-1`,
  );

  return response.items ?? [];
}

async function craftFetch<T>(config: CraftConfig, path: string): Promise<T> {
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    headers: {
      Accept: "application/json",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Craft API ${response.status}: ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

function normalizeDocument(raw: Record<string, unknown>): CraftDocument | undefined {
  const id = stringValue(raw.id) ?? stringValue(raw.documentId) ?? stringValue(raw.blockId);
  const title =
    stringValue(raw.title) ??
    stringValue(raw.name) ??
    markdownTitle(raw.title) ??
    id;

  if (!id || !title) {
    return undefined;
  }

  const metadata = objectValue(raw.metadata);

  return {
    id,
    title,
    createdAt: stringValue(raw.createdAt) ?? stringValue(metadata?.createdAt),
    lastModifiedAt: stringValue(raw.lastModifiedAt) ?? stringValue(metadata?.lastModifiedAt),
    raw,
  };
}

function normalizeCollection(raw: Record<string, unknown>): CraftCollection | undefined {
  const id = stringValue(raw.id);
  const name = stringValue(raw.name);

  if (!id || !name) {
    return undefined;
  }

  return {
    id,
    name,
    itemCount: numberValue(raw.itemCount),
    documentId: stringValue(raw.documentId),
  };
}

function parseDocumentIds(value: string | undefined): string[] | undefined {
  const ids = value
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return ids?.length ? ids : undefined;
}

function markdownTitle(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return stringValue((value as { markdown?: unknown }).markdown);
}

function objectValue(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : undefined;
}
