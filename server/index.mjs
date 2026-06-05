import { createServer } from "node:http";
import { readState, mutateState, createId } from "./store.mjs";
import { candidateToEdital, collectSourceCandidates, filterNewCandidates } from "./ingest.mjs";

const PORT = Number(process.env.PORT || 8787);
const SOURCE_POLL_INTERVAL_MS = Number(process.env.SOURCE_POLL_INTERVAL_MS || 60_000);
const SOURCE_POLL_JITTER_MS = Number(process.env.SOURCE_POLL_JITTER_MS || 0);

const syncingSourceIds = new Set();
let sourcePollTimer = null;
let sourcePollInFlight = false;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  });
  res.end(`${body}\n`);
}

function notFound(res, message = "Not found") {
  sendJson(res, 404, { error: message });
}

function badRequest(res, message = "Invalid request") {
  sendJson(res, 400, { error: message });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return null;
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : null;
}

function matchesQuery(text, query) {
  if (!query) return true;
  return String(text || "").toLowerCase().includes(String(query).toLowerCase());
}

function scoreMatch(edital, artist, project) {
  const tags = new Set([
    ...(edital.tags || []),
    ...(artist.tags || []),
    ...(project?.tags || []),
  ]);
  const areaText = `${edital.area} ${artist.area} ${project?.descricao || ""}`.toLowerCase();
  let score = edital.compatibilidade || 50;
  if (areaText.includes("musica")) score += 5;
  if (areaText.includes("artes visuais")) score += 5;
  score += Math.min(tags.size * 2, 10);
  return Math.max(0, Math.min(100, score));
}

function buildEdictInsight(edital, state) {
  const relatedArtists = state.artistas
    .map((artist) => {
      const project = state.projetos.find((item) => item.artistaId === artist.id && (item.editaisRelacionados || []).includes(edital.id));
      return {
        artistaId: artist.id,
        artista: artist.nome,
        projetoId: project?.id || null,
        projeto: project?.nome || null,
        compatibilidade: scoreMatch(edital, artist, project),
        motivo: project
          ? `Projeto ${project.nome} aderente a area ${edital.area}.`
          : `Perfil do artista relacionado a area ${edital.area}.`,
        pendencias: Math.max(0, 3 - artist.projetos),
      };
    })
    .sort((a, b) => b.compatibilidade - a.compatibilidade)
    .slice(0, 3);

  return {
    editalId: edital.id,
    resumoExecutivo: edital.resumo,
    requisitos: [
      `Quem pode participar: ${edital.quemPodeParticipar}`,
      `Prazo final em ${edital.prazo} dias`,
      `Valor disponivel: R$ ${Number(edital.valor).toLocaleString("pt-BR")}`,
    ],
    criterios: [
      { criterio: "Qualidade artistica", peso: "30%" },
      { criterio: "Impacto cultural", peso: "25%" },
      { criterio: "Viabilidade tecnica", peso: "20%" },
    ],
    documentosObrigatorios: [
      "RG/CPF ou CNPJ",
      "Portfolio artistico",
      "Cronograma",
      "Orcamento detalhado",
    ],
    riscos: edital.riscos || [],
    sugestoes: relatedArtists,
    proximasAcoes: [
      "Criar oportunidade",
      "Gerar checklist",
      "Enviar para revisao humana",
    ],
    updatedAt: new Date().toISOString(),
  };
}

function parsePath(pathname) {
  return pathname.split("/").filter(Boolean);
}

function isSourceDue(source, now = Date.now()) {
  if (!source || source.active === false) return false;
  const frequencyMinutes = Number(source.frequencyMinutes || 60);
  const lastSyncAt = source.lastSyncAt ? Date.parse(source.lastSyncAt) : NaN;
  if (!Number.isFinite(lastSyncAt)) return true;
  const elapsedMs = now - lastSyncAt;
  return elapsedMs >= frequencyMinutes * 60_000;
}

function buildSourceResponse(state, sourceId) {
  const item = state.sources.find((source) => source.id === sourceId);
  if (!item) return null;
  const ingestions = state.ingestions.filter((entry) => entry.sourceId === sourceId);
  return { item, ingestions };
}

async function syncSourceById(sourceId) {
  if (syncingSourceIds.has(sourceId)) {
    return { ok: false, status: 409, error: "Fonte ja esta sendo sincronizada" };
  }

  syncingSourceIds.add(sourceId);
  const startedAt = new Date().toISOString();
  let sourceName = sourceId;
  let sourceRecord = null;
  try {
    const state = await readState();
    const source = state.sources.find((entry) => entry.id === sourceId);
    if (!source) {
      return { ok: false, status: 404, error: "Fonte nao encontrada" };
    }

    sourceRecord = source;
    sourceName = source.name;

    const candidates = await collectSourceCandidates(source);
    const uniqueCandidates = filterNewCandidates(candidates, state.editais);
    const newEditais = uniqueCandidates.map((candidate) => candidateToEdital(candidate, source));
    const finishedAt = new Date().toISOString();

    const next = await mutateState((draft) => {
      const targetSource = draft.sources.find((entry) => entry.id === sourceId);
      if (targetSource) {
        targetSource.lastSyncAt = finishedAt;
        targetSource.lastError = null;
        targetSource.updatedAt = finishedAt;
      }

      draft.ingestions.unshift({
        id: createId("ing"),
        sourceId,
        sourceName,
        status: "success",
        discoveredCount: candidates.length,
        createdCount: newEditais.length,
        startedAt,
        finishedAt,
        error: null,
      });

      for (const edital of newEditais) {
        draft.editais.unshift(edital);
        draft.auditLog.unshift({
          id: createId("audit"),
          type: "edital.ingested",
          entityId: edital.id,
          createdAt: finishedAt,
        });
      }
    });

    return {
      ok: true,
      status: 200,
      result: {
        source: next.sources.find((entry) => entry.id === sourceId) || sourceRecord,
        discoveredCount: candidates.length,
        createdCount: newEditais.length,
        editais: newEditais,
      },
    };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const message = error instanceof Error ? error.message : "Falha ao sincronizar fonte";

    await mutateState((draft) => {
      const targetSource = draft.sources.find((entry) => entry.id === sourceId);
      if (targetSource) {
        targetSource.lastSyncAt = finishedAt;
        targetSource.lastError = message;
        targetSource.updatedAt = finishedAt;
      }

      draft.ingestions.unshift({
        id: createId("ing"),
        sourceId,
        sourceName: targetSource?.name || sourceName,
        status: "error",
        discoveredCount: 0,
        createdCount: 0,
        startedAt,
        finishedAt,
        error: message,
      });
    });

    return { ok: false, status: 500, error: message };
  } finally {
    syncingSourceIds.delete(sourceId);
  }
}

async function pollDueSources(reason = "interval") {
  if (sourcePollInFlight) {
    return { ok: false, skipped: true, reason: "poll_in_flight" };
  }

  sourcePollInFlight = true;
  try {
    const state = await readState();
    const now = Date.now();
    const dueSources = state.sources.filter((source) => isSourceDue(source, now));
    const results = [];

    for (const source of dueSources) {
      // Sequential execution avoids network bursts and keeps writes deterministic.
      // The scheduler is intentionally conservative because sources can be slow.
      // eslint-disable-next-line no-await-in-loop
      const result = await syncSourceById(source.id);
      results.push({ sourceId: source.id, ...result });
    }

    return { ok: true, reason, polled: dueSources.length, results };
  } finally {
    sourcePollInFlight = false;
  }
}

async function handleEditais(req, res, segments, url) {
  const state = await readState();

  if (req.method === "GET" && segments.length === 3) {
    const q = url.searchParams.get("q");
    const status = url.searchParams.get("status");
    const area = url.searchParams.get("area");
    const sourceId = url.searchParams.get("sourceId");

    const items = state.editais.filter((item) => {
      return (
        matchesQuery(item.nome, q) &&
        (!status || item.status === status) &&
        (!area || item.area === area) &&
        (!sourceId || item.sourceId === sourceId)
      );
    });

    return sendJson(res, 200, { items });
  }

  if (req.method === "POST" && segments.length === 3) {
    let body;
    try {
      body = (await readBody(req)) || {};
    } catch {
      return badRequest(res, "Body JSON invalido");
    }

    if (!body.nome || !body.fonte) {
      return badRequest(res, "Campos obrigatorios: nome e fonte");
    }

    const now = new Date().toISOString();
    const item = {
      id: createId("edital"),
      nome: body.nome,
      fonte: body.fonte,
      fonteUrl: body.fonteUrl || null,
      area: body.area || "Nao informado",
      prazo: Number(body.prazo || 0),
      valor: Number(body.valor || 0),
      status: body.status || "Novo",
      prioridade: body.prioridade || "Media",
      compatibilidade: Number(body.compatibilidade || 0),
      matches: body.matches || { artistas: 0, projetos: 0 },
      resumo: body.resumo || "",
      quemPodeParticipar: body.quemPodeParticipar || "",
      riscos: Array.isArray(body.riscos) ? body.riscos : [],
      proximaAcao: body.proximaAcao || "",
      descricaoCompleta: body.descricaoCompleta || "",
      tags: Array.isArray(body.tags) ? body.tags : [],
      createdAt: now,
      updatedAt: now,
    };

    const next = await mutateState((draft) => {
      draft.editais.unshift(item);
      draft.auditLog.unshift({
        id: createId("audit"),
        type: "edital.created",
        entityId: item.id,
        createdAt: now,
      });
    });

    return sendJson(res, 201, { item, meta: next.meta });
  }

  if (req.method === "POST" && segments.length === 4 && segments[3] === "import") {
    let body;
    try {
      body = (await readBody(req)) || {};
    } catch {
      return badRequest(res, "Body JSON invalido");
    }

    const now = new Date().toISOString();
    const item = {
      id: createId("edital"),
      nome: body.nome || "Edital importado",
      fonte: body.fonte || "Importacao manual",
      fonteUrl: body.fonteUrl || null,
      area: body.area || "Nao informado",
      prazo: Number(body.prazo || 0),
      valor: Number(body.valor || 0),
      status: "Novo",
      prioridade: body.prioridade || "Media",
      compatibilidade: 0,
      matches: { artistas: 0, projetos: 0 },
      resumo: body.resumo || "Importado a partir de conteudo bruto.",
      quemPodeParticipar: body.quemPodeParticipar || "",
      riscos: [],
      proximaAcao: "Executar analise inicial.",
      descricaoCompleta: body.content || body.text || "",
      tags: Array.isArray(body.tags) ? body.tags : [],
      createdAt: now,
      updatedAt: now,
    };

    await mutateState((draft) => {
      draft.editais.unshift(item);
      draft.auditLog.unshift({
        id: createId("audit"),
        type: "edital.imported",
        entityId: item.id,
        createdAt: now,
      });
    });

    return sendJson(res, 201, { item });
  }

  if (segments.length === 4) {
    const edital = state.editais.find((item) => item.id === segments[3]);
    if (!edital) return notFound(res, "Edital nao encontrado");

    if (req.method === "GET") {
      return sendJson(res, 200, {
        item: edital,
        analysis: buildEdictInsight(edital, state),
      });
    }

    if (req.method === "PATCH") {
      let body;
      try {
        body = (await readBody(req)) || {};
      } catch {
        return badRequest(res, "Body JSON invalido");
      }

      const updated = await mutateState((draft) => {
        const target = draft.editais.find((item) => item.id === edital.id);
        if (!target) return draft;
        Object.assign(target, body, { updatedAt: new Date().toISOString() });
      });

      const item = updated.editais.find((entry) => entry.id === edital.id);
      return sendJson(res, 200, { item });
    }
  }

  if (segments.length === 5 && segments[4] === "analyze") {
    const edital = state.editais.find((item) => item.id === segments[3]);
    if (!edital) return notFound(res, "Edital nao encontrado");

    if (req.method === "POST") {
      const analysis = buildEdictInsight(edital, state);
      await mutateState((draft) => {
        const target = draft.editais.find((item) => item.id === edital.id);
        if (target) {
          target.analysis = analysis;
          target.status = "Analisado";
          target.updatedAt = new Date().toISOString();
        }
      });
      return sendJson(res, 200, { analysis });
    }
  }
}

async function handleArtistas(req, res, segments, url) {
  const state = await readState();

  if (req.method === "GET" && segments.length === 3) {
    const q = url.searchParams.get("q");
    const tipo = url.searchParams.get("tipo");
    const items = state.artistas.filter((item) => {
      return matchesQuery(item.nome, q) && (!tipo || item.tipo === tipo);
    });
    return sendJson(res, 200, { items });
  }

  if (req.method === "POST" && segments.length === 3) {
    let body;
    try {
      body = (await readBody(req)) || {};
    } catch {
      return badRequest(res, "Body JSON invalido");
    }

    if (!body.nome) {
      return badRequest(res, "Campo obrigatorio: nome");
    }

    const now = new Date().toISOString();
    const item = {
      id: createId("artist"),
      nome: body.nome,
      tipo: body.tipo || "Artista",
      area: body.area || "Nao informado",
      cidade: body.cidade || "Nao informado",
      projetos: Number(body.projetos || 0),
      oportunidadesAtivas: Number(body.oportunidadesAtivas || 0),
      statusDocumental: body.statusDocumental || "Pendente",
      bio: body.bio || "",
      links: Array.isArray(body.links) ? body.links : [],
      contatos: Array.isArray(body.contatos) ? body.contatos : [],
      tags: Array.isArray(body.tags) ? body.tags : [],
      createdAt: now,
      updatedAt: now,
    };

    const next = await mutateState((draft) => {
      draft.artistas.unshift(item);
      draft.auditLog.unshift({
        id: createId("audit"),
        type: "artista.created",
        entityId: item.id,
        createdAt: now,
      });
    });

    return sendJson(res, 201, { item, meta: next.meta });
  }

  if (segments.length === 4) {
    const item = state.artistas.find((entry) => entry.id === segments[3]);
    if (!item) return notFound(res, "Artista nao encontrado");

    if (req.method === "GET") {
      const projetos = state.projetos.filter((project) => project.artistaId === item.id);
      const oportunidades = state.oportunidades.filter((opp) => opp.artistaId === item.id);
      const documentos = state.documentos.filter((doc) => doc.ownerId === item.id);
      return sendJson(res, 200, { item, projetos, oportunidades, documentos });
    }
  }
}

async function handleProjetos(req, res, segments, url) {
  const state = await readState();

  if (req.method === "GET" && segments.length === 3) {
    const q = url.searchParams.get("q");
    const items = state.projetos.filter((item) => matchesQuery(item.nome, q));
    return sendJson(res, 200, { items });
  }

  if (req.method === "POST" && segments.length === 3) {
    let body;
    try {
      body = (await readBody(req)) || {};
    } catch {
      return badRequest(res, "Body JSON invalido");
    }

    if (!body.artistaId || !body.nome) {
      return badRequest(res, "Campos obrigatorios: artistaId e nome");
    }

    const artist = state.artistas.find((item) => item.id === body.artistaId);
    if (!artist) {
      return badRequest(res, "Artista invalido");
    }

    const now = new Date().toISOString();
    const item = {
      id: createId("project"),
      artistaId: artist.id,
      nome: body.nome,
      descricao: body.descricao || "",
      status: body.status || "Planejamento",
      orcamento: Number(body.orcamento || 0),
      editaisRelacionados: Array.isArray(body.editaisRelacionados) ? body.editaisRelacionados : [],
      tags: Array.isArray(body.tags) ? body.tags : [],
      createdAt: now,
      updatedAt: now,
    };

    const next = await mutateState((draft) => {
      draft.projetos.unshift(item);
      const targetArtist = draft.artistas.find((entry) => entry.id === artist.id);
      if (targetArtist) {
        targetArtist.projetos += 1;
        targetArtist.updatedAt = now;
      }
      draft.auditLog.unshift({
        id: createId("audit"),
        type: "projeto.created",
        entityId: item.id,
        createdAt: now,
      });
    });

    return sendJson(res, 201, { item, meta: next.meta });
  }

  if (segments.length === 4) {
    const item = state.projetos.find((entry) => entry.id === segments[3]);
    if (!item) return notFound(res, "Projeto nao encontrado");
    if (req.method === "GET") {
      return sendJson(res, 200, { item });
    }
  }
}

async function handleDocumentos(req, res, segments, url) {
  const state = await readState();

  if (req.method === "GET" && segments.length === 3) {
    const ownerType = url.searchParams.get("ownerType");
    const ownerId = url.searchParams.get("ownerId");
    const items = state.documentos.filter((item) => {
      return (
        (!ownerType || item.ownerType === ownerType) &&
        (!ownerId || item.ownerId === ownerId)
      );
    });
    return sendJson(res, 200, { items });
  }

  if (req.method === "POST" && segments.length === 3) {
    let body;
    try {
      body = (await readBody(req)) || {};
    } catch {
      return badRequest(res, "Body JSON invalido");
    }

    if (!body.nome || !body.ownerType || !body.ownerId) {
      return badRequest(res, "Campos obrigatorios: nome, ownerType e ownerId");
    }

    const allowedOwners = new Set(["artist", "project", "opportunity"]);
    if (!allowedOwners.has(body.ownerType)) {
      return badRequest(res, "ownerType invalido");
    }

    const now = new Date().toISOString();
    const item = {
      id: createId("doc"),
      nome: body.nome,
      status: body.status || "Pendente",
      responsavel: body.responsavel || "Nao atribuido",
      arquivo: body.arquivo || null,
      ownerType: body.ownerType,
      ownerId: body.ownerId,
      tipo: body.tipo || "Documento",
      validade: body.validade || null,
      updatedAt: now,
    };

    const next = await mutateState((draft) => {
      draft.documentos.unshift(item);
      draft.auditLog.unshift({
        id: createId("audit"),
        type: "documento.created",
        entityId: item.id,
        createdAt: now,
      });
    });

    return sendJson(res, 201, { item, meta: next.meta });
  }
}

async function handleSources(req, res, segments) {
  const state = await readState();

  if (req.method === "GET" && segments.length === 3) {
    return sendJson(res, 200, { items: state.sources });
  }

  if (req.method === "POST" && segments.length === 3) {
    let body;
    try {
      body = (await readBody(req)) || {};
    } catch {
      return badRequest(res, "Body JSON invalido");
    }

    if (!body.name || !body.url) {
      return badRequest(res, "Campos obrigatorios: name e url");
    }

    const now = new Date().toISOString();
    const item = {
      id: createId("source"),
      name: body.name,
      type: body.type || "html",
      url: body.url,
      active: body.active ?? true,
      frequencyMinutes: Number(body.frequencyMinutes || 60),
      notes: body.notes || "",
      lastSyncAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    const next = await mutateState((draft) => {
      draft.sources.unshift(item);
      draft.auditLog.unshift({
        id: createId("audit"),
        type: "source.created",
        entityId: item.id,
        createdAt: now,
      });
    });

    return sendJson(res, 201, { item, meta: next.meta });
  }

  if (segments.length === 4 && segments[3] === "sync") {
    if (req.method !== "POST") return notFound(res);

    const stateBefore = await readState();
    const results = [];
    for (const source of stateBefore.sources.filter((entry) => entry.active !== false)) {
      // eslint-disable-next-line no-await-in-loop
      const result = await syncSourceById(source.id);
      results.push({ sourceId: source.id, ...result });
    }
    return sendJson(res, 200, { items: results });
  }

  if (segments.length === 4) {
    const item = state.sources.find((entry) => entry.id === segments[3]);
    if (!item) return notFound(res, "Fonte nao encontrada");

    if (req.method === "GET") {
      return sendJson(res, 200, buildSourceResponse(state, item.id));
    }

    if (req.method === "PATCH") {
      let body;
      try {
        body = (await readBody(req)) || {};
      } catch {
        return badRequest(res, "Body JSON invalido");
      }

      const updated = await mutateState((draft) => {
        const target = draft.sources.find((entry) => entry.id === item.id);
        if (!target) return draft;
        Object.assign(target, {
          ...body,
          updatedAt: new Date().toISOString(),
        });
      });

      const nextItem = updated.sources.find((entry) => entry.id === item.id);
      return sendJson(res, 200, { item: nextItem });
    }
  }

  if (segments.length === 5 && segments[4] === "sync") {
    if (req.method !== "POST") return notFound(res);
    const result = await syncSourceById(segments[3]);
    return sendJson(res, result.status, result.ok ? result.result : { error: result.error });
  }
}

async function handleIngestions(req, res, segments, url) {
  const state = await readState();

  if (req.method === "GET" && segments.length === 3) {
    const sourceId = url.searchParams.get("sourceId");
    const status = url.searchParams.get("status");
    const limit = Number(url.searchParams.get("limit") || 50);

    const items = state.ingestions
      .filter((item) => (!sourceId || item.sourceId === sourceId) && (!status || item.status === status))
      .slice(0, Number.isFinite(limit) ? limit : 50);

    return sendJson(res, 200, { items });
  }
}

async function handleOportunidades(req, res, segments) {
  const state = await readState();

  if (req.method === "GET" && segments.length === 3) {
    return sendJson(res, 200, { items: state.oportunidades });
  }

  if (req.method === "POST" && segments.length === 3) {
    let body;
    try {
      body = (await readBody(req)) || {};
    } catch {
      return badRequest(res, "Body JSON invalido");
    }

    if (!body.editalId || !body.artistaId) {
      return badRequest(res, "Campos obrigatorios: editalId e artistaId");
    }

    const edital = state.editais.find((item) => item.id === body.editalId);
    const artista = state.artistas.find((item) => item.id === body.artistaId);
    const projeto = body.projectId ? state.projetos.find((item) => item.id === body.projectId) : null;

    if (!edital || !artista) {
      return badRequest(res, "Edital ou artista invalido");
    }

    const now = new Date().toISOString();
    const item = {
      id: createId("opp"),
      nome: body.nome || `${edital.nome} - ${artista.nome}`,
      editalId: edital.id,
      edital: edital.nome,
      artistaId: artista.id,
      artista: artista.nome,
      projectId: projeto?.id || null,
      projeto: projeto?.nome || null,
      prazo: Number(body.prazo ?? edital.prazo ?? 0),
      responsavel: body.responsavel || "Nao atribuido",
      status: body.status || "Em fila",
      progresso: Number(body.progresso ?? 0),
      pendencias: Number(body.pendencias ?? 0),
      risco: body.risco || "Medio",
      documentosFaltantes: Array.isArray(body.documentosFaltantes) ? body.documentosFaltantes : [],
      checklist: Array.isArray(body.checklist) ? body.checklist : [],
      comentarios: [],
      protocolo: body.protocolo || null,
      resultado: body.resultado || null,
      createdAt: now,
      updatedAt: now,
    };

    const next = await mutateState((draft) => {
      draft.oportunidades.unshift(item);
      const artist = draft.artistas.find((entry) => entry.id === artista.id);
      if (artist) artist.oportunidadesAtivas += 1;
      draft.auditLog.unshift({
        id: createId("audit"),
        type: "oportunidade.created",
        entityId: item.id,
        createdAt: now,
      });
    });

    return sendJson(res, 201, { item, meta: next.meta });
  }

  if (segments.length === 4) {
    const item = state.oportunidades.find((entry) => entry.id === segments[3]);
    if (!item) return notFound(res, "Oportunidade nao encontrada");

    if (req.method === "GET") {
      return sendJson(res, 200, { item });
    }

    if (req.method === "PATCH") {
      let body;
      try {
        body = (await readBody(req)) || {};
      } catch {
        return badRequest(res, "Body JSON invalido");
      }

      const updated = await mutateState((draft) => {
        const target = draft.oportunidades.find((entry) => entry.id === item.id);
        if (!target) return draft;
        Object.assign(target, body, { updatedAt: new Date().toISOString() });
      });

      const nextItem = updated.oportunidades.find((entry) => entry.id === item.id);
      return sendJson(res, 200, { item: nextItem });
    }
  }
}

async function handleChat(req, res, segments) {
  const state = await readState();
  const scope = segments[3];
  const entityId = segments[4];

  if (!["edital", "oportunidade"].includes(scope)) {
    return notFound(res, "Escopo de chat invalido");
  }

  const bucket = state.chat[scope] || {};
  const messages = bucket[entityId] || [];

  if (req.method === "GET" && segments.length === 6 && segments[5] === "messages") {
    return sendJson(res, 200, { items: messages });
  }

  if (req.method === "POST" && segments.length === 6 && segments[5] === "messages") {
    let body;
    try {
      body = (await readBody(req)) || {};
    } catch {
      return badRequest(res, "Body JSON invalido");
    }

    if (!body.content) return badRequest(res, "Campo obrigatorio: content");

    const now = new Date().toISOString();
    const userMessage = {
      id: createId("msg"),
      role: "user",
      content: body.content,
      createdAt: now,
    };
    const assistantMessage = {
      id: createId("msg"),
      role: "assistant",
      content:
        scope === "edital"
          ? "Entendi. Posso extrair requisitos, riscos e sugerir oportunidades a partir desse edital."
          : "Entendi. Posso revisar pendencias, propor proxima acao e gerar checklist para a oportunidade.",
      createdAt: new Date(Date.now() + 500).toISOString(),
    };

    await mutateState((draft) => {
      if (!draft.chat[scope]) draft.chat[scope] = {};
      if (!draft.chat[scope][entityId]) draft.chat[scope][entityId] = [];
      draft.chat[scope][entityId].push(userMessage, assistantMessage);
    });

    return sendJson(res, 201, { items: [userMessage, assistantMessage] });
  }
}

async function handleSummary(req, res) {
  const state = await readState();
  return sendJson(res, 200, {
    editais: state.editais.length,
    artistas: state.artistas.length,
    projetos: state.projetos.length,
    documentos: state.documentos.length,
    oportunidades: state.oportunidades.length,
    sources: state.sources.length,
    ingestions: state.ingestions.length,
    byStatus: {
      oportunidades: state.oportunidades.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {}),
      editais: state.editais.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {}),
      ingestions: state.ingestions.reduce((acc, item) => {
        acc[item.status] = (acc[item.status] || 0) + 1;
        return acc;
      }, {}),
    },
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const segments = parsePath(url.pathname);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  if (segments[0] === "health") {
    return sendJson(res, 200, { ok: true });
  }

  if (segments[0] !== "api" || segments[1] !== "v1") {
    return notFound(res);
  }

  if (segments.length === 2) {
    return sendJson(res, 200, {
      name: "Edital Sales API",
      version: "1.0.0",
      endpoints: [
        "/api/v1/summary",
        "/api/v1/editais",
        "/api/v1/oportunidades",
        "/api/v1/artistas",
        "/api/v1/projetos",
        "/api/v1/documentos",
        "/api/v1/sources",
        "/api/v1/ingestions",
      ],
    });
  }

  if (segments[2] === "summary" && req.method === "GET") {
    return handleSummary(req, res);
  }

  if (segments[2] === "editais") {
    return handleEditais(req, res, segments, url);
  }

  if (segments[2] === "oportunidades") {
    return handleOportunidades(req, res, segments);
  }

  if (segments[2] === "artistas") {
    return handleArtistas(req, res, segments, url);
  }

  if (segments[2] === "projetos") {
    return handleProjetos(req, res, segments, url);
  }

  if (segments[2] === "documentos") {
    return handleDocumentos(req, res, segments, url);
  }

  if (segments[2] === "sources") {
    return handleSources(req, res, segments, url);
  }

  if (segments[2] === "ingestions") {
    return handleIngestions(req, res, segments, url);
  }

  if (segments[2] === "chat") {
    return handleChat(req, res, segments);
  }

  return notFound(res);
});

server.listen(PORT, () => {
  console.log(`Edital Sales API running on http://localhost:${PORT}`);
  const runPoll = () => {
    const delay = SOURCE_POLL_JITTER_MS > 0 ? Math.floor(Math.random() * SOURCE_POLL_JITTER_MS) : 0;
    setTimeout(() => {
      void pollDueSources("startup");
    }, delay);
  };

  runPoll();
  sourcePollTimer = setInterval(() => {
    void pollDueSources("interval");
  }, SOURCE_POLL_INTERVAL_MS);
});
