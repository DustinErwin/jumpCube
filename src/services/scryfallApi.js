const SCRYFALL_API_BASE_URL = "https://api.scryfall.com";
const SCRYFALL_COLLECTION_BATCH_SIZE = 75;
const SCRYFALL_REQUEST_INTERVAL_MS = 175;
const SCRYFALL_MAX_RETRIES = 3;
const SCRYFALL_429_COOLDOWN_MS = 15000;
const SCRYFALL_CACHE_PREFIX = "jumpCube:scryfall:";
const SCRYFALL_CACHE_INDEX_KEY = `${SCRYFALL_CACHE_PREFIX}index`;
const SCRYFALL_MAX_PERSISTED_CACHE_ENTRIES = 250;
const CACHE_TTL = {
  card: 1000 * 60 * 60 * 24 * 14,
  collection: 1000 * 60 * 60 * 24 * 7,
  prints: 1000 * 60 * 60 * 24,
  search: 1000 * 60 * 10,
};

const memoryCache = new Map();
const pendingRequests = new Map();
let queueTail = Promise.resolve();
let lastRequestStartedAt = 0;
let globalCooldownUntil = 0;

function getScryfallError(payload, fallbackMessage) {
  return new Error(
    payload?.details ||
      payload?.message ||
      payload?.warnings?.join(" ") ||
      fallbackMessage,
  );
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function getStableHash(value) {
  let hash = 0;
  const text = String(value);

  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(31, hash) + text.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}

function getCacheStorageKey(cacheKey) {
  return `${SCRYFALL_CACHE_PREFIX}${getStableHash(cacheKey)}`;
}

function readPersistedCache(cacheKey) {
  if (!canUseLocalStorage()) return null;

  try {
    const rawValue = window.localStorage.getItem(getCacheStorageKey(cacheKey));

    return rawValue ? JSON.parse(rawValue) : null;
  } catch {
    return null;
  }
}

function getCacheIndex() {
  if (!canUseLocalStorage()) return [];

  try {
    return JSON.parse(
      window.localStorage.getItem(SCRYFALL_CACHE_INDEX_KEY) || "[]",
    );
  } catch {
    return [];
  }
}

function writeCacheIndex(entries) {
  if (!canUseLocalStorage()) return;

  try {
    window.localStorage.setItem(
      SCRYFALL_CACHE_INDEX_KEY,
      JSON.stringify(entries),
    );
  } catch {
    // Cache persistence is best-effort only.
  }
}

function prunePersistedCache(nextStorageKey) {
  const now = Date.now();
  const entries = getCacheIndex()
    .filter((entry) => entry.storageKey !== nextStorageKey)
    .filter((entry) => entry.expiresAt > now)
    .sort((entryA, entryB) => entryB.updatedAt - entryA.updatedAt);

  entries.unshift({
    storageKey: nextStorageKey,
    expiresAt: now + CACHE_TTL.card,
    updatedAt: now,
  });

  entries
    .slice(SCRYFALL_MAX_PERSISTED_CACHE_ENTRIES)
    .forEach((entry) => {
      window.localStorage.removeItem(entry.storageKey);
    });

  writeCacheIndex(entries.slice(0, SCRYFALL_MAX_PERSISTED_CACHE_ENTRIES));
}

function writePersistedCache(cacheKey, entry) {
  if (!canUseLocalStorage()) return;

  const storageKey = getCacheStorageKey(cacheKey);

  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entry));
    prunePersistedCache(storageKey);
  } catch {
    // If localStorage is full or blocked, memory cache still protects session.
  }
}

function getCachedPayload(cacheKey) {
  const now = Date.now();
  const memoryEntry = memoryCache.get(cacheKey);

  if (memoryEntry?.expiresAt > now) {
    return memoryEntry.payload;
  }

  if (memoryEntry) {
    memoryCache.delete(cacheKey);
  }

  const persistedEntry = readPersistedCache(cacheKey);

  if (persistedEntry?.expiresAt > now) {
    memoryCache.set(cacheKey, persistedEntry);
    return persistedEntry.payload;
  }

  return null;
}

function setCachedPayload(cacheKey, payload, ttlMs) {
  if (!ttlMs) return;

  const entry = {
    expiresAt: Date.now() + ttlMs,
    payload,
  };

  memoryCache.set(cacheKey, entry);
  writePersistedCache(cacheKey, entry);
}

function getAbsoluteUrl(pathOrUrl) {
  return pathOrUrl.startsWith("http")
    ? pathOrUrl
    : `${SCRYFALL_API_BASE_URL}${pathOrUrl}`;
}

function getRequestBody(options) {
  return typeof options.body === "string"
    ? options.body
    : options.body
      ? JSON.stringify(options.body)
      : "";
}

function getCacheKey(url, method, body) {
  return `${method}:${url}:${body}`;
}

function getDefaultCacheTtl(url, method) {
  if (method === "POST" && url.includes("/cards/collection")) {
    return CACHE_TTL.collection;
  }

  if (method !== "GET") return 0;
  if (url.includes("/cards/named")) return CACHE_TTL.card;
  if (url.includes("unique=prints")) return CACHE_TTL.prints;
  if (url.includes("/cards/search")) return CACHE_TTL.search;
  if (/\/cards\/[0-9a-f-]+/i.test(url)) return CACHE_TTL.card;

  return 0;
}

function getRetryDelay(response, attempt) {
  const retryAfter = response.headers.get("Retry-After");
  const retryAfterSeconds = Number(retryAfter);

  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }

  return Math.min(8000, 1500 * (attempt + 1));
}

function noteRateLimit(response, attempt) {
  const cooldownUntil =
    Date.now() +
    Math.max(SCRYFALL_429_COOLDOWN_MS, getRetryDelay(response, attempt));

  globalCooldownUntil = Math.max(globalCooldownUntil, cooldownUntil);
}

async function runQueued(task) {
  const queuedTask = queueTail.then(async () => {
    const cooldownDelay = Math.max(0, globalCooldownUntil - Date.now());

    if (cooldownDelay > 0) {
      await wait(cooldownDelay);
    }

    const elapsed = Date.now() - lastRequestStartedAt;
    const delay = Math.max(0, SCRYFALL_REQUEST_INTERVAL_MS - elapsed);

    if (delay > 0) {
      await wait(delay);
    }

    lastRequestStartedAt = Date.now();
    return task();
  });

  queueTail = queuedTask.catch(() => {});
  return queuedTask;
}

async function performFetch(url, options, body) {
  for (let attempt = 0; attempt <= SCRYFALL_MAX_RETRIES; attempt += 1) {
    const response = await fetch(url, {
      ...options,
      body: body || undefined,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => null);

    if (response.ok) {
      return payload;
    }

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < SCRYFALL_MAX_RETRIES
    ) {
      if (response.status === 429) {
        noteRateLimit(response, attempt);
      }

      await wait(getRetryDelay(response, attempt));
      continue;
    }

    const error = getScryfallError(payload, `Scryfall request failed: ${url}`);

    error.status = response.status;
    if (response.status === 429) {
      noteRateLimit(response, attempt);
    }
    throw error;
  }

  throw new Error(`Scryfall request failed: ${url}`);
}

export async function fetchScryfallJson(pathOrUrl, options = {}) {
  const {
    cacheTtlMs,
    skipCache = false,
    ...fetchOptions
  } = options;
  const url = getAbsoluteUrl(pathOrUrl);
  const method = String(fetchOptions.method || "GET").toUpperCase();
  const body = getRequestBody(fetchOptions);
  const cacheKey = getCacheKey(url, method, body);
  const ttlMs = cacheTtlMs ?? getDefaultCacheTtl(url, method);

  if (!skipCache) {
    const cachedPayload = getCachedPayload(cacheKey);

    if (cachedPayload) return cachedPayload;
  }

  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }

  const requestPromise = runQueued(async () => {
    const payload = await performFetch(url, fetchOptions, body);

    setCachedPayload(cacheKey, payload, ttlMs);
    return payload;
  }).finally(() => {
    pendingRequests.delete(cacheKey);
  });

  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function searchScryfallCards(query, {
  pageUrl = "",
  unique = "cards",
  order = "name",
  cacheTtlMs,
} = {}) {
  if (pageUrl) {
    return fetchScryfallJson(pageUrl, {
      cacheTtlMs: cacheTtlMs ?? (pageUrl.includes("unique=prints")
        ? CACHE_TTL.prints
        : CACHE_TTL.search),
    });
  }

  const params = new URLSearchParams({
    q: query,
    unique,
    order,
    include_extras: "false",
    include_multilingual: "false",
    include_variations: "false",
  });

  return fetchScryfallJson(`/cards/search?${params}`, {
    cacheTtlMs: cacheTtlMs ?? (unique === "prints"
      ? CACHE_TTL.prints
      : CACHE_TTL.search),
  });
}

export async function getScryfallCardByName(name, { fuzzy = false } = {}) {
  const params = new URLSearchParams({
    [fuzzy ? "fuzzy" : "exact"]: name,
  });

  return fetchScryfallJson(`/cards/named?${params}`, {
    cacheTtlMs: CACHE_TTL.card,
  });
}

export async function getScryfallCardById(id) {
  return fetchScryfallJson(`/cards/${id}`, {
    cacheTtlMs: CACHE_TTL.card,
  });
}

function getIdentifierKey(identifier) {
  return [
    identifier.id ? `id:${identifier.id}` : "",
    identifier.oracle_id ? `oracle:${identifier.oracle_id}` : "",
    identifier.name ? `name:${identifier.name}` : "",
  ]
    .filter(Boolean)
    .join("|");
}

export async function getScryfallCardCollection(identifiers) {
  const cards = [];
  const missing = [];
  const uniqueIdentifiers = [
    ...new Map(
      (identifiers || [])
        .filter(Boolean)
        .map((identifier) => [getIdentifierKey(identifier), identifier]),
    ).values(),
  ];

  for (
    let index = 0;
    index < uniqueIdentifiers.length;
    index += SCRYFALL_COLLECTION_BATCH_SIZE
  ) {
    const payload = await fetchScryfallJson("/cards/collection", {
      method: "POST",
      cacheTtlMs: CACHE_TTL.collection,
      body: JSON.stringify({
        identifiers: uniqueIdentifiers.slice(
          index,
          index + SCRYFALL_COLLECTION_BATCH_SIZE,
        ),
      }),
    });

    cards.push(...(payload.data || []));
    missing.push(...(payload.not_found || []));
  }

  return { cards, missing };
}
