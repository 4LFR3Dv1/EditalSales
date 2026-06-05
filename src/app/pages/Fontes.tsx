import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Loader2, Globe, RefreshCw, Plus, Clock3, AlertTriangle, CheckCircle2, X, PencilLine, Power } from "lucide-react";
import {
  createSource,
  listIngestions,
  listSources,
  patchSource,
  syncAllSources,
  syncSource,
  type Ingestion,
  type Source,
} from "../lib/api";

type SourceFormState = {
  name: string;
  type: string;
  url: string;
  active: boolean;
  frequencyMinutes: string;
  notes: string;
  esfera: string;
  confiabilidade: string;
  metodoCaptura: string;
  precisaValidacaoHumana: boolean;
  classificacao: string;
};

const emptyForm: SourceFormState = {
  name: "",
  type: "html",
  url: "",
  active: true,
  frequencyMinutes: "720",
  notes: "",
  esfera: "nacional",
  confiabilidade: "media",
  metodoCaptura: "scraping",
  precisaValidacaoHumana: true,
  classificacao: "edital",
};

function formatDateTime(value: string | null) {
  if (!value) return "Nunca";
  return new Date(value).toLocaleString("pt-BR");
}

function statusTone(status: string) {
  return status === "error"
    ? "bg-red-100 text-red-700 border-red-200"
    : "bg-green-100 text-green-700 border-green-200";
}

export default function Fontes() {
  const [sources, setSources] = useState<Source[]>([]);
  const [ingestions, setIngestions] = useState<Ingestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSourceId, setEditingSourceId] = useState<string | null>(null);
  const [form, setForm] = useState<SourceFormState>(emptyForm);

  const editingSource = useMemo(
    () => sources.find((item) => item.id === editingSourceId) || null,
    [sources, editingSourceId],
  );

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [sourcesResponse, ingestionsResponse] = await Promise.all([listSources(), listIngestions()]);
        if (!active) return;
        setSources(sourcesResponse.items);
        setIngestions(ingestionsResponse.items);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar fontes");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    load();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!editingSource) {
      setForm(emptyForm);
      return;
    }

    setForm({
      name: editingSource.name,
      type: editingSource.type,
      url: editingSource.url,
      active: editingSource.active,
      frequencyMinutes: String(editingSource.frequencyMinutes),
      notes: editingSource.notes || "",
      esfera: editingSource.esfera || "nacional",
      confiabilidade: editingSource.confiabilidade || "media",
      metodoCaptura: editingSource.metodoCaptura || "scraping",
      precisaValidacaoHumana: editingSource.precisaValidacaoHumana ?? true,
      classificacao: editingSource.classificacao || "edital",
    });
  }, [editingSource]);

  const stats = useMemo(() => {
    const activeSources = sources.filter((item) => item.active).length;
    const errored = sources.filter((item) => Boolean(item.lastError)).length;
    const successSyncs = ingestions.filter((item) => item.status === "success").length;
    const recentSyncs = ingestions.slice(0, 5).length;

    return [
      { label: "Fontes cadastradas", value: sources.length },
      { label: "Fontes ativas", value: activeSources },
      { label: "Com erro", value: errored },
      { label: "Ingestões recentes", value: recentSyncs || successSyncs },
    ];
  }, [sources, ingestions]);

  async function reload() {
    const [sourcesResponse, ingestionsResponse] = await Promise.all([listSources(), listIngestions()]);
    setSources(sourcesResponse.items);
    setIngestions(ingestionsResponse.items);
  }

  function openCreateDialog() {
    setEditingSourceId(null);
    setForm(emptyForm);
    setDialogOpen(true);
  }

  function openEditDialog(source: Source) {
    setEditingSourceId(source.id);
    setDialogOpen(true);
  }

  function closeDialog() {
    setDialogOpen(false);
    setEditingSourceId(null);
    setForm(emptyForm);
  }

  async function handleSaveSource() {
    try {
      setSaving(true);
      setError(null);
      const payload = {
        name: form.name.trim(),
        type: form.type.trim() || "html",
        url: form.url.trim(),
        active: form.active,
        frequencyMinutes: Number(form.frequencyMinutes || 0) || 60,
        notes: form.notes.trim(),
        esfera: form.esfera,
        confiabilidade: form.confiabilidade,
        metodoCaptura: form.metodoCaptura,
        precisaValidacaoHumana: form.precisaValidacaoHumana,
        classificacao: form.classificacao,
      };

      if (!payload.name || !payload.url) {
        throw new Error("Informe nome e URL da fonte");
      }

      if (editingSource) {
        const response = await patchSource(editingSource.id, payload);
        setSources((current) => current.map((item) => (item.id === response.item.id ? response.item : item)));
      } else {
        const response = await createSource(payload);
        setSources((current) => [response.item, ...current]);
      }

      closeDialog();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar fonte");
    } finally {
      setSaving(false);
    }
  }

  async function handleSyncSource(id: string) {
    try {
      setSyncingId(id);
      setError(null);
      const response = await syncSource(id);
      setSources((current) =>
        current.map((item) => (item.id === response.source.id ? response.source : item)),
      );
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao sincronizar fonte");
    } finally {
      setSyncingId(null);
    }
  }

  async function handleToggleActive(source: Source) {
    try {
      setError(null);
      const response = await patchSource(source.id, { active: !source.active });
      setSources((current) => current.map((item) => (item.id === response.item.id ? response.item : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar fonte");
    }
  }

  async function handleSyncAll() {
    try {
      setSyncingAll(true);
      setError(null);
      await syncAllSources();
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao sincronizar todas as fontes");
    } finally {
      setSyncingAll(false);
    }
  }

  const recentIngestions = ingestions.slice(0, 8);

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="p-6 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold mb-1">Fontes de Editais</h2>
            <p className="text-slate-600">Gerencie as origens monitoradas pelo polling automático</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSyncAll}
              disabled={syncingAll}
              className="px-4 py-2 border border-slate-300 rounded-lg text-sm hover:bg-slate-50 flex items-center gap-2 disabled:opacity-60"
            >
              {syncingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sincronizar tudo
            </button>
            <button
              onClick={openCreateDialog}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nova fonte
            </button>
          </div>
        </div>
      </div>

      <div className="p-6 grid grid-cols-4 gap-4">
        {stats.map((item) => (
          <div key={item.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-sm text-slate-600">{item.label}</p>
            <p className="text-2xl font-semibold">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-hidden px-6 pb-6">
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(320px,0.9fr)] gap-6 h-full">
          <div className="overflow-y-auto space-y-4 pr-1">
            {loading ? (
              <div className="flex h-40 items-center justify-center text-slate-500 bg-white rounded-xl border border-slate-200">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Carregando fontes...
              </div>
            ) : sources.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">
                <Globe className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                Nenhuma fonte cadastrada.
                <div className="mt-4">
                  <button
                    onClick={openCreateDialog}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
                  >
                    Criar primeira fonte
                  </button>
                </div>
              </div>
            ) : (
              sources.map((source) => (
                <div key={source.id} className="bg-white border border-slate-200 rounded-xl p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-lg">{source.name}</h3>
                        <span className="px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-700 capitalize">
                          {source.type}
                        </span>
                        {source.esfera ? (
                          <span className="px-2 py-1 rounded-full text-xs bg-indigo-100 text-indigo-700 capitalize">
                            {source.esfera}
                          </span>
                        ) : null}
                        {source.confiabilidade ? (
                          <span
                            className={`px-2 py-1 rounded-full text-xs capitalize ${
                              source.confiabilidade === "alta"
                                ? "bg-green-100 text-green-700"
                                : source.confiabilidade === "media"
                                  ? "bg-yellow-100 text-yellow-700"
                                  : "bg-slate-100 text-slate-700"
                            }`}
                          >
                            {source.confiabilidade}
                          </span>
                        ) : null}
                        <span
                          className={`px-2 py-1 rounded-full text-xs border ${
                            source.active ? "bg-green-100 text-green-700 border-green-200" : "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          {source.active ? "Ativa" : "Inativa"}
                        </span>
                        {source.lastError ? (
                          <span className="px-2 py-1 rounded-full text-xs border bg-red-100 text-red-700 border-red-200">
                            Com erro
                          </span>
                        ) : null}
                      </div>
                      <p className="text-sm text-slate-600 break-all">{source.url}</p>
                      {source.notes ? <p className="text-sm text-slate-700 mt-3">{source.notes}</p> : null}

                      <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <p className="text-slate-500 mb-1">Frequência</p>
                          <p className="font-medium">{source.frequencyMinutes} min</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <p className="text-slate-500 mb-1">Última sincronização</p>
                          <p className="font-medium">{formatDateTime(source.lastSyncAt)}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <p className="text-slate-500 mb-1">Atualizada em</p>
                          <p className="font-medium">{formatDateTime(source.updatedAt)}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <p className="text-slate-500 mb-1">Último erro</p>
                          <p className="font-medium truncate">{source.lastError || "Nenhum"}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <p className="text-slate-500 mb-1">Método de captura</p>
                          <p className="font-medium capitalize">{source.metodoCaptura || "scraping"}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <p className="text-slate-500 mb-1">Validação humana</p>
                          <p className="font-medium">{source.precisaValidacaoHumana ? "Sim" : "Não"}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 min-w-40">
                      <button
                        onClick={() => handleSyncSource(source.id)}
                        disabled={syncingId === source.id}
                        className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2"
                      >
                        {syncingId === source.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                        Sincronizar
                      </button>
                      <button
                        onClick={() => handleToggleActive(source)}
                        className="px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50 flex items-center justify-center gap-2"
                      >
                        <Power className="w-4 h-4" />
                        {source.active ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        onClick={() => openEditDialog(source)}
                        className="px-3 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50 flex items-center justify-center gap-2"
                      >
                        <PencilLine className="w-4 h-4" />
                        Editar
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="overflow-y-auto space-y-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock3 className="w-5 h-5 text-blue-600" />
                <h3 className="font-semibold">Ingestões recentes</h3>
              </div>

              {recentIngestions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Nenhuma ingestão registrada ainda.
                </div>
              ) : (
                <div className="space-y-3">
                  {recentIngestions.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-sm">{item.sourceName}</p>
                          <p className="text-xs text-slate-500">{formatDateTime(item.finishedAt)}</p>
                        </div>
                        <span className={`px-2 py-1 rounded-full text-xs border ${statusTone(item.status)}`}>
                          {item.status === "success" ? "Sucesso" : "Erro"}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                        <div className="rounded bg-slate-50 p-2">Descobertos: {item.discoveredCount}</div>
                        <div className="rounded bg-slate-50 p-2">Criados: {item.createdCount}</div>
                      </div>
                      {item.error ? (
                        <p className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                          {item.error}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                <h3 className="font-semibold">Observações</h3>
              </div>
              <ul className="space-y-3 text-sm text-slate-700">
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                  O polling automático roda no backend de acordo com a frequência de cada fonte.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                  Fontes ativas aparecem no ciclo de ingestão sem intervenção manual.
                </li>
                <li className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5" />
                  Se uma fonte falhar, o último erro fica registrado para revisão.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <Dialog.Root open={dialogOpen} onOpenChange={(open) => (open ? setDialogOpen(true) : closeDialog())}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[720px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-semibold">
                  {editingSource ? "Editar fonte" : "Nova fonte"}
                </Dialog.Title>
                <Dialog.Description className="text-sm text-slate-600">
                  Configure uma fonte oficial para ingestão automática de editais.
                </Dialog.Description>
              </div>
              <Dialog.Close className="p-2 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium">Nome</span>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="MinC - Editais"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Tipo</span>
                  <select
                    value={form.type}
                    onChange={(e) => setForm((current) => ({ ...current, type: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="html">HTML</option>
                    <option value="rss">RSS</option>
                    <option value="pdf">PDF</option>
                    <option value="api">API</option>
                    <option value="email">Email</option>
                  </select>
                </label>
                <label className="space-y-2 col-span-2">
                  <span className="text-sm font-medium">URL</span>
                  <input
                    value={form.url}
                    onChange={(e) => setForm((current) => ({ ...current, url: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="https://..."
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Frequência (min)</span>
                  <input
                    value={form.frequencyMinutes}
                    onChange={(e) => setForm((current) => ({ ...current, frequencyMinutes: e.target.value }))}
                    type="number"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Status</span>
                  <select
                    value={form.active ? "active" : "inactive"}
                    onChange={(e) => setForm((current) => ({ ...current, active: e.target.value === "active" }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="active">Ativa</option>
                    <option value="inactive">Inativa</option>
                  </select>
                </label>
                <label className="space-y-2 col-span-2">
                  <span className="text-sm font-medium">Notas</span>
                  <textarea
                    value={form.notes}
                    onChange={(e) => setForm((current) => ({ ...current, notes: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-24"
                    placeholder="Observações sobre a fonte e estratégia de coleta"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Esfera</span>
                  <select
                    value={form.esfera}
                    onChange={(e) => setForm((current) => ({ ...current, esfera: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="federal">Federal</option>
                    <option value="estadual">Estadual</option>
                    <option value="municipal">Municipal</option>
                    <option value="privada">Privada</option>
                    <option value="nacional">Nacional</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Confiabilidade</span>
                  <select
                    value={form.confiabilidade}
                    onChange={(e) => setForm((current) => ({ ...current, confiabilidade: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="alta">Alta</option>
                    <option value="media">Média</option>
                    <option value="baixa">Baixa</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Método de captura</span>
                  <select
                    value={form.metodoCaptura}
                    onChange={(e) => setForm((current) => ({ ...current, metodoCaptura: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="scraping">Scraping</option>
                    <option value="rss">RSS</option>
                    <option value="api">API</option>
                    <option value="manual">Manual</option>
                    <option value="newsletter">Newsletter</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Classificação</span>
                  <select
                    value={form.classificacao}
                    onChange={(e) => setForm((current) => ({ ...current, classificacao: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="edital">Edital</option>
                    <option value="plataforma">Plataforma</option>
                    <option value="agregador">Agregador</option>
                    <option value="patrocinio">Patrocínio</option>
                    <option value="programacao">Programação</option>
                    <option value="inteligencia">Inteligência</option>
                    <option value="chamada">Chamada</option>
                  </select>
                </label>
                <label className="flex items-center gap-3 rounded-lg border border-slate-300 px-3 py-3 text-sm">
                  <input
                    type="checkbox"
                    checked={form.precisaValidacaoHumana}
                    onChange={(e) => setForm((current) => ({ ...current, precisaValidacaoHumana: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Precisa validação humana
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Dialog.Close className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">
                  Cancelar
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleSaveSource}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  {editingSource ? "Salvar alterações" : "Criar fonte"}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {error ? (
        <div className="fixed bottom-4 right-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700 shadow-lg">
          {error}
        </div>
      ) : null}
    </div>
  );
}
