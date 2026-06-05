import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSeedState } from "./seed.mjs";

const rootDir = dirname(fileURLToPath(import.meta.url));
const dataDir = join(rootDir, "data");
const stateFile = join(dataDir, "state.json");

let cachedState = null;

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeState(state) {
  const chat = state?.chat || {};
  return {
    meta: state?.meta || {
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    editais: Array.isArray(state?.editais) ? state.editais : [],
    artistas: Array.isArray(state?.artistas) ? state.artistas : [],
    projetos: Array.isArray(state?.projetos) ? state.projetos : [],
    documentos: Array.isArray(state?.documentos) ? state.documentos : [],
    oportunidades: Array.isArray(state?.oportunidades) ? state.oportunidades : [],
    sources: Array.isArray(state?.sources) ? state.sources : [],
    ingestions: Array.isArray(state?.ingestions) ? state.ingestions : [],
    chat: {
      edital: chat.edital || {},
      oportunidade: chat.oportunidade || {},
    },
    auditLog: Array.isArray(state?.auditLog) ? state.auditLog : [],
  };
}

export async function readState() {
  try {
    const raw = await readFile(stateFile, "utf8");
    cachedState = normalizeState(JSON.parse(raw));
  } catch {
    cachedState = normalizeState(createSeedState());
    await writeState(cachedState);
  }

  return cachedState;
}

export async function writeState(nextState) {
  await ensureDataDir();
  const state = normalizeState(nextState);
  state.meta = {
    ...state.meta,
    updatedAt: new Date().toISOString(),
  };

  cachedState = state;
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return state;
}

export async function mutateState(mutator) {
  const current = await readState();
  const draft = clone(current);
  const result = await mutator(draft);
  const nextState = result ?? draft;
  return writeState(nextState);
}

export function createId(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
