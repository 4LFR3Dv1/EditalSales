import { useEffect, useMemo, useState } from "react";
import { FileText, Upload, Loader2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  createDocumento,
  getSummary,
  listArtistas,
  listDocumentos,
  listOportunidades,
  listProjetos,
  normalizeLabel,
  type Documento,
  type ApiSummary,
  type Artista,
  type Projeto,
  type Oportunidade,
} from "../lib/api";

export default function Documentos() {
  const [documents, setDocuments] = useState<Documento[]>([]);
  const [summary, setSummary] = useState<ApiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [artistas, setArtistas] = useState<Artista[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [oportunidades, setOportunidades] = useState<Oportunidade[]>([]);
  const [form, setForm] = useState({
    nome: "",
    tipo: "Documento",
    responsavel: "",
    arquivo: "",
    ownerType: "artist" as "artist" | "project" | "opportunity",
    ownerId: "",
    validade: "",
    status: "Pendente",
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [docsResponse, summaryResponse, artistsResponse, projectsResponse, opportunitiesResponse] = await Promise.all([
          listDocumentos(),
          getSummary(),
          listArtistas(),
          listProjetos(),
          listOportunidades(),
        ]);
        if (!active) return;
        setDocuments(docsResponse.items);
        setSummary(summaryResponse);
        setArtistas(artistsResponse.items);
        setProjetos(projectsResponse.items);
        setOportunidades(opportunitiesResponse.items);
        setForm((current) => ({
          ...current,
          ownerId:
            current.ownerId ||
            artistsResponse.items[0]?.id ||
            projectsResponse.items[0]?.id ||
            opportunitiesResponse.items[0]?.id ||
            "",
        }));
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar documentos");
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

  const grouped = useMemo(() => {
    return documents.reduce<Record<string, number>>((acc, doc) => {
      const key = normalizeLabel(doc.status);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
  }, [documents]);

  async function handleUpload() {
    try {
      setSaving(true);
      setError(null);
      const response = await createDocumento({
        nome: form.nome,
        tipo: form.tipo,
        responsavel: form.responsavel,
        arquivo: form.arquivo || null,
        ownerType: form.ownerType,
        ownerId: form.ownerId,
        validade: form.validade || null,
        status: form.status,
      });
      setDocuments((current) => [response.item, ...current]);
      setUploadOpen(false);
      setForm({
        nome: "",
        tipo: "Documento",
        responsavel: "",
        arquivo: "",
        ownerType: "artist",
        ownerId: artistas[0]?.id || projetos[0]?.id || oportunidades[0]?.id || "",
        validade: "",
        status: "Pendente",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar documento");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="p-6 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold mb-1">Biblioteca de Documentos</h2>
            <p className="text-slate-600">Gerencie todos os documentos da produtora</p>
          </div>
          <button
            onClick={() => setUploadOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <Upload className="w-4 h-4" />
            Upload documento
          </button>
        </div>
      </div>

      <div className="p-6 grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: summary?.documentos ?? documents.length },
          { label: "Matches", value: summary?.matches ?? 0 },
          { label: "Encontrados", value: grouped["Encontrado"] || 0 },
          { label: "Pendentes", value: grouped["Pendente"] || 0 },
          { label: "Revisar", value: grouped["Revisar"] || 0 },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-slate-200 rounded-lg p-4">
            <p className="text-sm text-slate-600">{item.label}</p>
            <p className="text-2xl font-semibold">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Carregando documentos...
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div key={doc.id} className="p-4 bg-white border border-slate-200 rounded-lg flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="w-10 h-10 text-blue-600" />
                  <div>
                    <h4 className="font-semibold">{doc.nome}</h4>
                    <p className="text-sm text-slate-600">
                      {doc.tipo} • {doc.responsavel} • {doc.ownerType}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {doc.editalId ? `Edital: ${doc.editalId}` : "Sem edital vinculado"}
                      {" • "}
                      {doc.oportunidadeId ? `Oportunidade: ${doc.oportunidadeId}` : "Sem oportunidade vinculada"}
                    </p>
                    {doc.resumoIa ? <p className="text-sm text-slate-700 mt-2">{doc.resumoIa}</p> : null}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-sm font-medium text-slate-700">{doc.validade || "Sem validade"}</p>
                    <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                      normalizeLabel(doc.status) === "Encontrado"
                        ? "bg-green-100 text-green-700"
                        : normalizeLabel(doc.status) === "Pendente"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-blue-100 text-blue-700"
                    }`}>
                      {normalizeLabel(doc.status)}
                    </span>
                  </div>
                  <button className="px-3 py-1 border border-slate-300 rounded text-sm hover:bg-slate-50">
                    {doc.arquivo ? "Ver" : "Upload"}
                  </button>
                </div>
              </div>
            ))}

            {documents.length === 0 ? (
              <div className="text-center py-20 text-slate-500">
                <FileText className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                Nenhum documento encontrado.
              </div>
            ) : null}
          </div>
        )}
      </div>

      <Dialog.Root open={uploadOpen} onOpenChange={setUploadOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[720px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-semibold">Upload de documento</Dialog.Title>
                <Dialog.Description className="text-sm text-slate-600">
                  Vincule o arquivo a um artista, projeto ou oportunidade.
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
                    value={form.nome}
                    onChange={(e) => setForm((current) => ({ ...current, nome: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Tipo</span>
                  <input
                    value={form.tipo}
                    onChange={(e) => setForm((current) => ({ ...current, tipo: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Responsável</span>
                  <input
                    value={form.responsavel}
                    onChange={(e) => setForm((current) => ({ ...current, responsavel: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Arquivo</span>
                  <input
                    value={form.arquivo}
                    onChange={(e) => setForm((current) => ({ ...current, arquivo: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="nome-do-arquivo.pdf"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Validade</span>
                  <input
                    value={form.validade}
                    onChange={(e) => setForm((current) => ({ ...current, validade: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="2027-12-31"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Status</span>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((current) => ({ ...current, status: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option>Encontrado</option>
                    <option>Pendente</option>
                    <option>Revisar</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium">Vincular a</span>
                  <select
                    value={form.ownerType}
                    onChange={(e) =>
                      setForm((current) => ({
                        ...current,
                        ownerType: e.target.value as "artist" | "project" | "opportunity",
                        ownerId: "",
                      }))
                    }
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="artist">Artista</option>
                    <option value="project">Projeto</option>
                    <option value="opportunity">Oportunidade</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Destino</span>
                  <select
                    value={form.ownerId}
                    onChange={(e) => setForm((current) => ({ ...current, ownerId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Selecione...</option>
                    {(form.ownerType === "artist" ? artistas : form.ownerType === "project" ? projetos : oportunidades).map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.nome}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Dialog.Close className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">
                  Cancelar
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={saving}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-60"
                >
                  Enviar documento
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {error ? <div className="fixed bottom-4 right-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
