from __future__ import annotations

import re
import socket
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from html import unescape
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from .store import create_id


EDITAL_KEYWORDS = [
    "edital",
    "chamamento",
    "chamamento publico",
    "seleção",
    "selecao",
    "concurso",
    "premio",
    "programa",
    "bolsa",
]

AREA_KEYWORDS = [
    {"area": "Música", "keywords": ["musica", "música", "som", "album", "turne", "turnê", "cancao", "canção"]},
    {"area": "Artes Visuais", "keywords": ["artes visuais", "exposicao", "exposição", "instalacao", "instalação", "fotografia", "mural"]},
    {"area": "Tecnologia", "keywords": ["tecnologia", "software", "plataforma", "dados", "digital", "ia", "inteligencia artificial", "machine learning"]},
    {"area": "Inovação", "keywords": ["inovacao", "inovação", "inovador", "startup", "empreendedor", "criativo"]},
]


@dataclass
class FetchResult:
    status: int
    content_type: str
    body: str


def normalize(text: Any) -> str:
    import unicodedata

    value = str(text or "").lower()
    value = unicodedata.normalize("NFD", value)
    return "".join(ch for ch in value if unicodedata.category(ch) != "Mn")


def strip_html(html: str) -> str:
    value = str(html or "")
    value = re.sub(r"<script[\s\S]*?<\/script>", " ", value, flags=re.I)
    value = re.sub(r"<style[\s\S]*?<\/style>", " ", value, flags=re.I)
    value = re.sub(r"<!--[\s\S]*?-->", " ", value)
    value = re.sub(r"<[^>]+>", " ", value)
    value = unescape(re.sub(r"\s+", " ", value).strip())
    return value


def truncate(text: str, max_length: int = 280) -> str:
    value = str(text or "").strip()
    if len(value) <= max_length:
        return value
    return f"{value[:max_length].strip()}..."


def first_match(text: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, text, flags=re.I | re.S)
        if match:
            return match.group(1)
    return None


def extract_title_from_html(html: str) -> str | None:
    return (
        first_match(html, [r"<h1[^>]*>([^<]+)<\/h1>", r"<title[^>]*>([^<]+)<\/title>"])
        or first_match(html, [r"<meta[^>]+property=[\"']og:title[\"'][^>]+content=[\"']([^\"']+)[\"']"])
        or None
    )


def extract_meta_description(html: str) -> str | None:
    return first_match(
        html,
        [
            r"<meta[^>]+name=[\"']description[\"'][^>]+content=[\"']([^\"']+)[\"']",
            r"<meta[^>]+property=[\"']og:description[\"'][^>]+content=[\"']([^\"']+)[\"']",
        ],
    )


def parse_links(html: str, base_url: str) -> list[dict]:
    links: list[dict] = []
    seen: set[str] = set()
    for match in re.finditer(r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>([\s\S]*?)<\/a>", html, flags=re.I):
        href = match.group(1).strip()
        text = strip_html(match.group(2))
        if not href:
            continue
        absolute = urljoin(base_url, href)
        if absolute in seen:
            continue
        seen.add(absolute)
        links.append({"href": absolute, "text": text})
    return links


def looks_like_edital(text: str) -> bool:
    normalized = normalize(text)
    return any(normalize(keyword) in normalized for keyword in EDITAL_KEYWORDS)


def infer_area(text: str) -> str:
    normalized = normalize(text)
    for entry in AREA_KEYWORDS:
        if any(normalize(keyword) in normalized for keyword in entry["keywords"]):
            return entry["area"]
    return "Geral"


def extract_money(text: str) -> int:
    normalized = re.sub(r"\s+", " ", str(text or ""))
    match = re.search(r"r\$\s*([\d\.\,]+)", normalized, flags=re.I)
    if not match:
        return 0
    cleaned = match.group(1).replace(".", "").replace(",", ".")
    try:
        return round(float(cleaned))
    except ValueError:
        return 0


def extract_prazo(text: str) -> int:
    days_match = re.search(r"(\d{1,3})\s*dias?", str(text or ""), flags=re.I)
    if days_match:
        return int(days_match.group(1))

    date_match = re.search(r"(\d{2}\/\d{2}\/\d{4})", str(text or ""))
    if date_match:
        day, month, year = [int(part) for part in date_match.group(1).split("/")]
        from datetime import datetime, timezone

        due = datetime(year, month, day, tzinfo=timezone.utc)
        diff = (due - datetime.now(timezone.utc)).days
        return diff if diff >= 0 else 0

    return 0


def extract_eligibility(text: str) -> str:
    parts = [part.strip() for part in re.split(r"[.\n]", str(text or "")) if part.strip()]
    for part in parts:
      if re.search(r"pode(m)? participar|eleg[ií]vel|proponente|quem pode participar", part, flags=re.I):
          return part
    return "Não identificado automaticamente."


def build_candidate_from_text(*, url: str, title: str | None, text: str, source_name: str, kind: str) -> dict:
    normalized_text = str(text or "").strip()
    combined = f"{title or ''} {normalized_text}"
    extracted_title = title or first_match(combined, [r"^(?:edital|programa|premio)[^.\n-]*"]) or url
    return {
        "title": truncate(extracted_title, 140),
        "url": url,
        "sourceName": source_name,
        "kind": kind,
        "area": infer_area(combined),
        "prazo": extract_prazo(combined),
        "valor": extract_money(combined),
        "resumo": truncate(extract_meta_description(normalized_text) or normalized_text or title or url, 220),
        "quemPodeParticipar": extract_eligibility(combined),
        "descricaoCompleta": truncate(normalized_text or title or url, 5000),
        "tags": list(
            dict.fromkeys(
                [
                    normalize(infer_area(combined)),
                    normalize(source_name),
                    normalize(kind),
                ]
            ).keys()
        ),
    }


def is_duplicate_candidate(candidate: dict, existing_editais: list[dict]) -> bool:
    candidate_url = normalize(candidate.get("url"))
    candidate_title = normalize(candidate.get("title"))
    for item in existing_editais:
        if candidate_url and normalize(item.get("fonteUrl")) == candidate_url:
            return True
        if candidate_title and normalize(item.get("nome")) == candidate_title:
            return True
    return False


def _decode_body(response) -> str:
    content_type = response.headers.get("content-type", "")
    charset = "utf-8"
    if hasattr(response.headers, "get_content_charset"):
        charset = response.headers.get_content_charset() or "utf-8"
    body = response.read()
    return content_type, body.decode(charset, errors="replace")


def fetch_text(url: str) -> FetchResult:
    request = Request(
        url,
        headers={
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 EditalSalesBot/1.0",
            "accept": "text/html,application/xml;q=0.9,application/xhtml+xml;q=0.9,text/xml;q=0.8,*/*;q=0.7",
            "accept-language": "pt-BR,pt;q=0.9,en;q=0.7",
            "cache-control": "no-cache",
            "pragma": "no-cache",
        },
    )

    try:
        with urlopen(request, timeout=30) as response:
            status = getattr(response, "status", 200)
            content_type, body = _decode_body(response)
            return FetchResult(status=status, content_type=content_type, body=body)
    except HTTPError as exc:
        try:
            content_type, body = _decode_body(exc)
        except Exception:
            content_type, body = "", ""
        return FetchResult(status=exc.code, content_type=content_type, body=body)
    except (URLError, TimeoutError, socket.timeout) as exc:
        reason = getattr(exc, "reason", exc)
        raise RuntimeError(f"fetch failed: {reason}") from exc


def collect_from_rss(source: dict, body: str) -> list[dict]:
    items: list[dict] = []
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        root = None

    if root is not None:
        for item in root.findall(".//item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            description = (item.findtext("description") or "").strip()
            if not title and not link and not description:
                continue
            items.append(
                build_candidate_from_text(
                    url=link or source["url"],
                    title=strip_html(title or link or source["name"]),
                    text=strip_html(description or ""),
                    source_name=source["name"],
                    kind="rss",
                )
            )

    if not items:
        items.append(
            build_candidate_from_text(
                url=source["url"],
                title=source["name"],
                text=strip_html(body),
                source_name=source["name"],
                kind="rss",
            )
        )

    return items


def collect_from_html(source: dict, body: str) -> list[dict]:
    items: list[dict] = []
    html_title = extract_title_from_html(body) or source["name"]
    html_description = extract_meta_description(body) or ""
    root_text = strip_html(body)

    if looks_like_edital(f"{html_title} {html_description} {root_text}"):
        items.append(
            build_candidate_from_text(
                url=source["url"],
                title=html_title,
                text=f"{html_description}\n\n{root_text}",
                source_name=source["name"],
                kind="html",
            )
        )

    links = parse_links(body, source["url"])
    for link in links[:12]:
        link_text = f"{link['text']} {link['href']}"
        normalized = normalize(link_text)
        if not any(normalize(keyword) in normalized for keyword in EDITAL_KEYWORDS):
            continue

        try:
            linked = fetch_text(link["href"])
            linked_text = link["text"] or link["href"] if "pdf" in linked.content_type else strip_html(linked.body)
            items.append(
                build_candidate_from_text(
                    url=link["href"],
                    title=link["text"] or extract_title_from_html(linked.body) or html_title,
                    text=linked_text,
                    source_name=source["name"],
                    kind="pdf" if "pdf" in linked.content_type else "html-link",
                )
            )
        except Exception:
            items.append(
                build_candidate_from_text(
                    url=link["href"],
                    title=link["text"] or html_title,
                    text=link["text"] or link["href"],
                    source_name=source["name"],
                    kind="link",
                )
            )

    if not items:
        items.append(
            build_candidate_from_text(
                url=source["url"],
                title=html_title,
                text=f"{html_description}\n\n{root_text}",
                source_name=source["name"],
                kind="html",
            )
        )

    return items


def collect_source_candidates(source: dict) -> list[dict]:
    fetched = fetch_text(source["url"])
    if fetched.status >= 400:
        raise RuntimeError(f"Falha ao acessar fonte: {fetched.status}")

    if source.get("type") == "rss" or "xml" in fetched.content_type or re.search(r"\.xml(?:\?|$)", source["url"], flags=re.I):
        return collect_from_rss(source, fetched.body)

    if source.get("type") == "pdf" or "pdf" in fetched.content_type or re.search(r"\.pdf(?:\?|$)", source["url"], flags=re.I):
        return [
            build_candidate_from_text(
                url=source["url"],
                title=source["name"],
                text=f"{source['name']}\nFonte PDF sem extração automatica completa.",
                source_name=source["name"],
                kind="pdf",
            )
        ]

    return collect_from_html(source, fetched.body)


def candidate_to_edital(candidate: dict, source: dict) -> dict:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {
        "id": create_id("edital"),
        "nome": candidate.get("title"),
        "fonte": source["name"],
        "fonteUrl": candidate.get("url"),
        "area": candidate.get("area") or "Geral",
        "prazo": candidate.get("prazo") or 0,
        "valor": candidate.get("valor") or 0,
        "status": "Novo",
        "prioridade": "Media",
        "compatibilidade": 0,
        "matches": {"artistas": 0, "projetos": 0},
        "resumo": candidate.get("resumo") or "",
        "quemPodeParticipar": candidate.get("quemPodeParticipar") or "Não identificado automaticamente.",
        "riscos": [],
        "proximaAcao": "Validar extração automatica e revisar manualmente.",
        "descricaoCompleta": candidate.get("descricaoCompleta") or candidate.get("resumo") or "",
        "tags": candidate.get("tags") or [],
        "sourceId": source["id"],
        "rawKind": candidate.get("kind"),
        "createdAt": now,
        "updatedAt": now,
    }


def filter_new_candidates(candidates: list[dict], existing_editais: list[dict]) -> list[dict]:
    return [candidate for candidate in candidates if not is_duplicate_candidate(candidate, existing_editais)]
