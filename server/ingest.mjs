import { createId } from "./store.mjs";

const EDITAL_KEYWORDS = [
  "edital",
  "chamamento",
  "chamamento publico",
  "seleção",
  "selecao",
  "concurso",
  "premio",
  "programa",
  "bolsa",
];

const AREA_KEYWORDS = [
  { area: "Música", keywords: ["musica", "música", "som", "album", "turne", "turnê", "cancao", "canção"] },
  { area: "Artes Visuais", keywords: ["artes visuais", "exposicao", "exposição", "instalacao", "instalação", "fotografia", "mural"] },
  { area: "Tecnologia", keywords: ["tecnologia", "software", "plataforma", "dados", "digital", "ia", "inteligencia artificial", "machine learning"] },
  { area: "Inovação", keywords: ["inovacao", "inovação", "inovador", "startup", "empreendedor", "criativo"] },
];

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max = 280) {
  const value = String(text || "").trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max).trim()}...`;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function extractTitleFromHtml(html) {
  return (
    firstMatch(html, [/<h1[^>]*>([^<]+)<\/h1>/i, /<title[^>]*>([^<]+)<\/title>/i]) ||
    firstMatch(html, [/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i]) ||
    null
  );
}

function extractMetaDescription(html) {
  return firstMatch(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i,
  ]);
}

function parseLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html))) {
    const href = match[1].trim();
    const text = stripHtml(match[2]);
    if (!href) continue;
    const normalized = new URL(href, baseUrl).toString();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    links.push({ href: normalized, text });
  }
  return links;
}

function looksLikeEdital(text) {
  const normalized = normalize(text);
  return EDITAL_KEYWORDS.some((keyword) => normalized.includes(normalize(keyword)));
}

function inferArea(text) {
  const normalized = normalize(text);
  for (const entry of AREA_KEYWORDS) {
    if (entry.keywords.some((keyword) => normalized.includes(normalize(keyword)))) {
      return entry.area;
    }
  }
  return "Geral";
}

function extractMoney(text) {
  const normalized = String(text || "").replace(/\s+/g, " ");
  const match = normalized.match(/r\$\s*([\d\.\,]+)/i);
  if (!match) return 0;
  const cleaned = match[1].replace(/\./g, "").replace(",", ".");
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function extractPrazo(text) {
  const normalized = String(text || "");
  const daysMatch = normalized.match(/(\d{1,3})\s*dias?/i);
  if (daysMatch) return Number(daysMatch[1]);

  const dateMatch = normalized.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (dateMatch) {
    const [day, month, year] = dateMatch[1].split("/").map(Number);
    const due = new Date(Date.UTC(year, month - 1, day));
    const diff = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (Number.isFinite(diff) && diff >= 0) return diff;
  }

  return 0;
}

function extractEligibility(text) {
  const paragraphs = String(text || "")
    .split(/[.\n]/)
    .map((part) => part.trim())
    .filter(Boolean);

  const match = paragraphs.find((part) =>
    /pode(m)? participar|eleg[ií]vel|proponente|quem pode participar/i.test(part),
  );
  return match || "Não identificado automaticamente.";
}

function buildCandidateFromText({ url, title, text, sourceName, kind }) {
  const normalizedText = String(text || "").trim();
  const combined = `${title || ""} ${normalizedText}`;
  const extractedTitle = title || firstMatch(combined, [/^(?:edital|programa|premio)[^.\n-]*/i]) || url;

  return {
    title: truncate(extractedTitle, 140),
    url,
    sourceName,
    kind,
    area: inferArea(combined),
    prazo: extractPrazo(combined),
    valor: extractMoney(combined),
    resumo: truncate(extractMetaDescription(normalizedText) || normalizedText || title || url, 220),
    quemPodeParticipar: extractEligibility(combined),
    descricaoCompleta: truncate(normalizedText || title || url, 5000),
    tags: Array.from(
      new Set(
        [inferArea(combined), sourceName, kind]
          .filter(Boolean)
          .map((item) => normalize(item))
          .filter(Boolean),
      ),
    ),
  };
}

function isDuplicateCandidate(candidate, existingEditais) {
  const candidateUrl = normalize(candidate.url);
  const candidateTitle = normalize(candidate.title);

  return existingEditais.some((item) => {
    const itemUrl = normalize(item.fonteUrl);
    const itemTitle = normalize(item.nome);
    return (candidateUrl && itemUrl && candidateUrl === itemUrl) || (candidateTitle && itemTitle && candidateTitle === itemTitle);
  });
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("timeout")), 30000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 EditalSalesBot/1.0",
        accept: "text/html,application/xml;q=0.9,application/xhtml+xml;q=0.9,text/xml;q=0.8,*/*;q=0.7",
        "accept-language": "pt-BR,pt;q=0.9,en;q=0.7",
        "cache-control": "no-cache",
        pragma: "no-cache",
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    return { response, contentType, body };
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "timeout"
        : error instanceof Error
          ? error.cause?.code
            ? `${error.message} (${error.cause.code})`
            : error.message
          : "fetch failed";
    throw new Error(message);
  } finally {
    clearTimeout(timeout);
  }
}

async function collectFromRss(source, body) {
  const items = [];
  const regex = /<item[\s\S]*?<\/item>/gi;
  let match;
  while ((match = regex.exec(body))) {
    const chunk = match[0];
    const title = firstMatch(chunk, [/<title[^>]*>([\s\S]*?)<\/title>/i]);
    const link = firstMatch(chunk, [/<link[^>]*>([\s\S]*?)<\/link>/i]);
    const description = firstMatch(chunk, [/<description[^>]*>([\s\S]*?)<\/description>/i]);
    if (!title && !link && !description) continue;
    items.push(
      buildCandidateFromText({
        url: link || source.url,
        title: stripHtml(title || link || source.name),
        text: stripHtml(description || ""),
        sourceName: source.name,
        kind: "rss",
      }),
    );
  }

  if (items.length === 0) {
    items.push(
      buildCandidateFromText({
        url: source.url,
        title: source.name,
        text: stripHtml(body),
        sourceName: source.name,
        kind: "rss",
      }),
    );
  }

  return items;
}

async function collectFromHtml(source, body) {
  const items = [];
  const htmlTitle = extractTitleFromHtml(body) || source.name;
  const htmlDescription = extractMetaDescription(body) || "";
  const rootText = stripHtml(body);

  if (looksLikeEdital(`${htmlTitle} ${htmlDescription} ${rootText}`)) {
    items.push(
      buildCandidateFromText({
        url: source.url,
        title: htmlTitle,
        text: `${htmlDescription}\n\n${rootText}`,
        sourceName: source.name,
        kind: "html",
      }),
    );
  }

  const links = parseLinks(body, source.url);
  for (const link of links.slice(0, 12)) {
    const linkText = `${link.text} ${link.href}`;
    const normalized = normalize(linkText);
    if (!EDITAL_KEYWORDS.some((keyword) => normalized.includes(normalize(keyword)))) {
      continue;
    }

    try {
      const { body: linkedBody, contentType } = await fetchText(link.href);
      const linkedText = contentType.includes("pdf") ? link.text || link.href : stripHtml(linkedBody);
      items.push(
        buildCandidateFromText({
          url: link.href,
          title: link.text || extractTitleFromHtml(linkedBody) || htmlTitle,
          text: linkedText,
          sourceName: source.name,
          kind: contentType.includes("pdf") ? "pdf" : "html-link",
        }),
      );
    } catch {
      items.push(
        buildCandidateFromText({
          url: link.href,
          title: link.text || htmlTitle,
          text: link.text || link.href,
          sourceName: source.name,
          kind: "link",
        }),
      );
    }
  }

  if (items.length === 0) {
    items.push(
      buildCandidateFromText({
        url: source.url,
        title: htmlTitle,
        text: `${htmlDescription}\n\n${rootText}`,
        sourceName: source.name,
        kind: "html",
      }),
    );
  }

  return items;
}

export async function collectSourceCandidates(source) {
  const { response, contentType, body } = await fetchText(source.url);

  if (!response.ok) {
    throw new Error(`Falha ao acessar fonte: ${response.status}`);
  }

  if (source.type === "rss" || contentType.includes("xml") || /\.xml(?:\?|$)/i.test(source.url)) {
    return collectFromRss(source, body);
  }

  if (source.type === "pdf" || contentType.includes("pdf") || /\.pdf(?:\?|$)/i.test(source.url)) {
    return [
      buildCandidateFromText({
        url: source.url,
        title: source.name,
        text: `${source.name}\nFonte PDF sem extração automatica completa.`,
        sourceName: source.name,
        kind: "pdf",
      }),
    ];
  }

  return collectFromHtml(source, body);
}

export function candidateToEdital(candidate, source) {
  const now = new Date().toISOString();
  return {
    id: createId("edital"),
    nome: candidate.title,
    fonte: source.name,
    fonteUrl: candidate.url,
    area: candidate.area || "Geral",
    prazo: candidate.prazo || 0,
    valor: candidate.valor || 0,
    status: "Novo",
    prioridade: "Media",
    compatibilidade: 0,
    matches: { artistas: 0, projetos: 0 },
    resumo: candidate.resumo || "",
    quemPodeParticipar: candidate.quemPodeParticipar || "Não identificado automaticamente.",
    riscos: [],
    proximaAcao: "Validar extração automatica e revisar manualmente.",
    descricaoCompleta: candidate.descricaoCompleta || candidate.resumo || "",
    tags: candidate.tags || [],
    sourceId: source.id,
    rawKind: candidate.kind,
    createdAt: now,
    updatedAt: now,
  };
}

export function filterNewCandidates(candidates, existingEditais) {
  return candidates.filter((candidate) => !isDuplicateCandidate(candidate, existingEditais));
}
