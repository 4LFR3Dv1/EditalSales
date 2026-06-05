import { useEffect, useMemo, useState } from "react";
import { Search, Plus, User, Building2, Users as UsersIcon, Music, Edit, FileText, Briefcase, FolderOpen, Clock, Loader2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  createArtista,
  createProjeto,
  getArtista,
  listArtistas,
  normalizeLabel,
  formatMoney,
  type Artista,
  type ArtistaDetailResponse,
} from "../lib/api";

export default function BaseArtistas() {
  const [items, setItems] = useState<Artista[]>([]);
  const [selectedArtistaId, setSelectedArtistaId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ArtistaDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createArtistOpen, setCreateArtistOpen] = useState(false);
  const [createProjectOpen, setCreateProjectOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [artistForm, setArtistForm] = useState({
    nome: "",
    tipo: "Artista",
    area: "",
    cidade: "",
    bio: "",
    links: "",
    contatos: "",
    tags: "",
  });
  const [projectForm, setProjectForm] = useState({
    artistaId: "",
    nome: "",
    descricao: "",
    status: "Planejamento",
    orcamento: "",
    tags: "",
  });

  const selectedArtista = useMemo(
    () => items.find((item) => item.id === selectedArtistaId) || null,
    [items, selectedArtistaId],
  );

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const response = await listArtistas();
        if (!active) return;
        setItems(response.items);
        setSelectedArtistaId((current) => current || response.items[0]?.id || null);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar artistas");
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
    if (!selectedArtistaId) return;

    let active = true;

    async function loadDetail() {
      try {
        setLoadingDetail(true);
        const response = await getArtista(selectedArtistaId);
        if (!active) return;
        setDetail(response);
        setItems((current) =>
          current.map((item) => (item.id === response.item.id ? { ...item, ...response.item } : item)),
        );
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar detalhes do artista");
        }
      } finally {
        if (active) setLoadingDetail(false);
      }
    }

    loadDetail();

    return () => {
      active = false;
    };
  }, [selectedArtistaId]);

  async function handleCreateArtist() {
    try {
      setSaving(true);
      setError(null);
      const response = await createArtista({
        nome: artistForm.nome,
        tipo: artistForm.tipo,
        area: artistForm.area,
        cidade: artistForm.cidade,
        bio: artistForm.bio,
        links: artistForm.links
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        contatos: artistForm.contatos
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        tags: artistForm.tags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setItems((current) => [response.item, ...current]);
      setSelectedArtistaId(response.item.id);
      setCreateArtistOpen(false);
      setArtistForm({
        nome: "",
        tipo: "Artista",
        area: "",
        cidade: "",
        bio: "",
        links: "",
        contatos: "",
        tags: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar artista");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateProject() {
    if (!projectForm.artistaId) return;
    try {
      setSaving(true);
      setError(null);
      await createProjeto({
        artistaId: projectForm.artistaId,
        nome: projectForm.nome,
        descricao: projectForm.descricao,
        status: projectForm.status,
        orcamento: Number(projectForm.orcamento || 0),
        tags: projectForm.tags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      });

      setCreateProjectOpen(false);
      setProjectForm({
        artistaId: selectedArtista?.id || "",
        nome: "",
        descricao: "",
        status: "Planejamento",
        orcamento: "",
        tags: "",
      });

      if (selectedArtistaId) {
        const refreshed = await getArtista(selectedArtistaId);
        setDetail(refreshed);
        setItems((current) =>
          current.map((item) => (item.id === refreshed.item.id ? { ...item, ...refreshed.item } : item)),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar projeto");
    } finally {
      setSaving(false);
    }
  }

  const getStatusColor = (status: string) => {
    switch (normalizeLabel(status)) {
      case "Completo":
        return "bg-green-100 text-green-700";
      case "Pendente":
        return "bg-yellow-100 text-yellow-700";
      default:
        return "bg-slate-100 text-slate-700";
    }
  };

  const getTypeIcon = (tipo: string) => {
    switch (normalizeLabel(tipo)) {
      case "Artista":
        return <User className="w-4 h-4" />;
      case "Banda":
        return <Music className="w-4 h-4" />;
      case "Coletivo":
        return <UsersIcon className="w-4 h-4" />;
      case "Startup":
      case "Empresa":
        return <Building2 className="w-4 h-4" />;
      case "Produtor":
        return <Briefcase className="w-4 h-4" />;
      default:
        return <User className="w-4 h-4" />;
    }
  };

  const opportunities = detail?.oportunidades || [];
  const projects = detail?.projetos || [];
  const documents = detail?.documentos || [];

  return (
    <div className="flex h-full bg-slate-50">
      <div className="w-96 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex gap-2">
            <button
              onClick={() => setCreateArtistOpen(true)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
            >
              <Plus className="w-4 h-4" />
              Novo perfil
            </button>
            <button
              onClick={() => {
                setProjectForm((current) => ({
                  ...current,
                  artistaId: selectedArtista?.id || current.artistaId,
                }));
                setCreateProjectOpen(true);
              }}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
            >
              <Plus className="w-4 h-4" />
              Novo projeto
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar perfil ou projeto..."
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <select className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option>Todos os tipos</option>
            <option>Artista</option>
            <option>Banda</option>
            <option>Coletivo</option>
            <option>Startup</option>
            <option>Empresa</option>
            <option>Produtor</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando artistas...
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Nenhum perfil cadastrado.
            </div>
          ) : (
            items.map((artista) => (
              <div
                key={artista.id}
                onClick={() => setSelectedArtistaId(artista.id)}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedArtista?.id === artista.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-semibold">
                    {artista.nome.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-sm mb-1 truncate">{artista.nome}</h3>
                    <p className="text-xs text-slate-600 mb-2">{artista.area}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs flex items-center gap-1">
                    {getTypeIcon(artista.tipo)}
                    {normalizeLabel(artista.tipo)}
                  </span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(artista.statusDocumental)}`}>
                    {normalizeLabel(artista.statusDocumental)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                  <div>{artista.projetos} projetos</div>
                  <div>{artista.oportunidadesAtivas} oportunidades</div>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-200">
                  <p className="text-xs text-slate-500">{artista.cidade}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-white overflow-hidden">
        <div className="p-6 border-b border-slate-200">
          {selectedArtista ? (
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold text-xl">
                  {selectedArtista.nome.substring(0, 2).toUpperCase()}
                </div>
                <div>
                  <h2 className="text-2xl font-semibold mb-1">{selectedArtista.nome}</h2>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium flex items-center gap-2">
                      {getTypeIcon(selectedArtista.tipo)}
                      {normalizeLabel(selectedArtista.tipo)}
                    </span>
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                      {selectedArtista.area}
                    </span>
                    <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(selectedArtista.statusDocumental)}`}>
                      Docs: {normalizeLabel(selectedArtista.statusDocumental)}
                    </span>
                  </div>
                  <p className="text-slate-600">{selectedArtista.cidade}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-2">
                  <Edit className="w-4 h-4" />
                  Editar
                </button>
                <button className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2">
                  <Plus className="w-4 h-4" />
                  Novo projeto
                </button>
              </div>
            </div>
          ) : (
            <div className="text-slate-500">Nenhum perfil disponível.</div>
          )}
        </div>

        <Tabs.Root defaultValue="visao-geral" className="flex-1 flex flex-col overflow-hidden">
          <Tabs.List className="flex border-b border-slate-200 px-6">
            <Tabs.Trigger value="visao-geral" className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900">
              Visão geral
            </Tabs.Trigger>
            <Tabs.Trigger value="projetos" className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900">
              Projetos
            </Tabs.Trigger>
            <Tabs.Trigger value="oportunidades" className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900">
              Oportunidades
            </Tabs.Trigger>
            <Tabs.Trigger value="documentos" className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900">
              Documentos
            </Tabs.Trigger>
            <Tabs.Trigger value="portfolio" className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900">
              Portfólio
            </Tabs.Trigger>
            <Tabs.Trigger value="historico" className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900">
              Histórico
            </Tabs.Trigger>
          </Tabs.List>

          <div className="flex-1 overflow-y-auto">
            <Tabs.Content value="visao-geral" className="p-6">
              {selectedArtista ? (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-semibold mb-3">Bio / Release</h3>
                    <p className="text-slate-700 leading-relaxed bg-slate-50 p-4 rounded-lg">{selectedArtista.bio}</p>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3">Contatos</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {selectedArtista.contatos.map((contato) => (
                        <div key={contato} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                          <p className="text-sm text-slate-700">{contato}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3">Links</h3>
                    <div className="space-y-2">
                      {selectedArtista.links.map((link) => (
                        <a
                          key={link}
                          href={`https://${link}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block p-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
                        >
                          <p className="text-sm text-blue-700">{link}</p>
                        </a>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3">Estatísticas</h3>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg text-center">
                        <p className="text-3xl font-bold text-blue-700">{selectedArtista.projetos}</p>
                        <p className="text-sm text-blue-600 mt-1">Projetos</p>
                      </div>
                      <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                        <p className="text-3xl font-bold text-green-700">{selectedArtista.oportunidadesAtivas}</p>
                        <p className="text-sm text-green-600 mt-1">Oportunidades ativas</p>
                      </div>
                      <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg text-center">
                        <p className="text-3xl font-bold text-purple-700">
                          {opportunities.filter((op) => normalizeLabel(op.status) === "Concluídos").length}
                        </p>
                        <p className="text-sm text-purple-600 mt-1">Submissões concluídas</p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Sem perfil selecionado.
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="projetos" className="p-6">
              {projects.length > 0 ? (
                <div className="space-y-4">
                  {projects.map((projeto) => (
                    <div key={projeto.id} className="p-4 bg-white border-2 border-slate-200 rounded-lg hover:border-blue-400 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <h4 className="font-semibold mb-1">{projeto.nome}</h4>
                          <p className="text-sm text-slate-600 mb-3">{projeto.descricao}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          normalizeLabel(projeto.status) === "Ativo"
                            ? "bg-green-100 text-green-700"
                            : normalizeLabel(projeto.status) === "Em desenvolvimento"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-yellow-100 text-yellow-700"
                        }`}>
                          {normalizeLabel(projeto.status)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-slate-600">Orçamento estimado:</span>
                        <span className="font-semibold">{formatMoney(projeto.orcamento)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Nenhum projeto disponível.
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="oportunidades" className="p-6">
              {opportunities.length > 0 ? (
                <div className="space-y-4">
                  {opportunities.map((oportunidade) => (
                    <div key={oportunidade.id} className="p-4 bg-white border-2 border-slate-200 rounded-lg hover:border-blue-400 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="font-semibold mb-1">{oportunidade.nome}</h4>
                          <p className="text-sm text-slate-600">{oportunidade.edital}</p>
                        </div>
                        <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                          normalizeLabel(oportunidade.status) === "Concluídos"
                            ? "bg-green-100 text-green-700"
                            : normalizeLabel(oportunidade.status) === "Em revisão"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-yellow-100 text-yellow-700"
                        }`}>
                          {normalizeLabel(oportunidade.status)}
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <span className="text-slate-600">Prazo:</span>
                          <p className="font-semibold">{oportunidade.prazo} dias</p>
                        </div>
                        <div>
                          <span className="text-slate-600">Responsável:</span>
                          <p className="font-semibold">{oportunidade.responsavel}</p>
                        </div>
                        <div>
                          <span className="text-slate-600">Progresso:</span>
                          <p className="font-semibold">{oportunidade.progresso}%</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Nenhuma oportunidade vinculada.
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="documentos" className="p-6">
              {documents.length > 0 ? (
                <div className="space-y-4">
                  {documents.map((doc) => (
                    <div key={doc.id} className="p-4 bg-white border-2 border-slate-200 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileText className="w-10 h-10 text-blue-600" />
                        <div>
                          <h4 className="font-semibold">{doc.nome}</h4>
                          <p className="text-sm text-slate-600">{doc.tipo}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className={`text-sm font-medium ${doc.validade === "Vencido" ? "text-red-600" : "text-slate-700"}`}>
                            {doc.validade || "Sem validade"}
                          </p>
                          <span className={`inline-block px-2 py-1 rounded text-xs font-medium ${
                            normalizeLabel(doc.status) === "Encontrado"
                              ? "bg-green-100 text-green-700"
                              : "bg-yellow-100 text-yellow-700"
                          }`}>
                            {normalizeLabel(doc.status)}
                          </span>
                        </div>
                        <button className="px-3 py-1 border border-slate-300 rounded text-sm hover:bg-slate-50">
                          {normalizeLabel(doc.status) === "Pendente" ? "Upload" : "Ver"}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Nenhum documento disponível.
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="portfolio" className="p-6">
              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-3">Materiais públicos</h3>
                  <div className="grid grid-cols-2 gap-4">
                    {documents.slice(0, 4).map((material) => (
                      <div key={material.id} className="p-4 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors">
                        <div className="flex items-center gap-3">
                          <FolderOpen className="w-8 h-8 text-blue-600" />
                          <div className="flex-1 min-w-0">
                            <h4 className="font-semibold text-sm truncate">{material.nome}</h4>
                            <p className="text-xs text-slate-600">{material.tipo}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="historico" className="p-6">
              <div className="space-y-4">
                {[
                  ...opportunities.slice(0, 3).map((item) => ({
                    data: item.updatedAt,
                    evento: "Oportunidade atualizada",
                    descricao: item.nome,
                    tipo: "oportunidade",
                  })),
                  ...documents.slice(0, 2).map((item) => ({
                    data: item.updatedAt,
                    evento: "Documento atualizado",
                    descricao: item.nome,
                    tipo: "documento",
                  })),
                ].map((item, idx) => (
                  <div key={`${item.evento}-${idx}`} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        item.tipo === "oportunidade"
                          ? "bg-blue-100 text-blue-600"
                          : "bg-slate-100 text-slate-600"
                      }`}>
                        <Clock className="w-5 h-5" />
                      </div>
                      {idx < 4 && <div className="w-0.5 h-16 bg-slate-200" />}
                    </div>
                    <div className="flex-1 pb-8">
                      <p className="text-xs text-slate-500 mb-1">{new Date(item.data).toLocaleDateString("pt-BR")}</p>
                      <h4 className="font-semibold mb-1">{item.evento}</h4>
                      <p className="text-sm text-slate-600">{item.descricao}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Tabs.Content>
          </div>
        </Tabs.Root>
      </div>

      {loadingDetail ? (
        <div className="fixed bottom-4 right-4 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Atualizando artista...
        </div>
      ) : null}

      <Dialog.Root open={createArtistOpen} onOpenChange={setCreateArtistOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[720px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-semibold">Novo perfil</Dialog.Title>
                <Dialog.Description className="text-sm text-slate-600">
                  Cadastre um novo artista, banda, coletivo, empresa ou produtor.
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
                    value={artistForm.nome}
                    onChange={(e) => setArtistForm((current) => ({ ...current, nome: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Tipo</span>
                  <select
                    value={artistForm.tipo}
                    onChange={(e) => setArtistForm((current) => ({ ...current, tipo: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option>Artista</option>
                    <option>Banda</option>
                    <option>Coletivo</option>
                    <option>Startup</option>
                    <option>Empresa</option>
                    <option>Produtor</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Área</span>
                  <input
                    value={artistForm.area}
                    onChange={(e) => setArtistForm((current) => ({ ...current, area: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Cidade</span>
                  <input
                    value={artistForm.cidade}
                    onChange={(e) => setArtistForm((current) => ({ ...current, cidade: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="space-y-2 block">
                <span className="text-sm font-medium">Bio</span>
                <textarea
                  value={artistForm.bio}
                  onChange={(e) => setArtistForm((current) => ({ ...current, bio: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-24"
                />
              </label>

              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-2 block">
                  <span className="text-sm font-medium">Links separados por vírgula</span>
                  <textarea
                    value={artistForm.links}
                    onChange={(e) => setArtistForm((current) => ({ ...current, links: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-20"
                  />
                </label>
                <label className="space-y-2 block">
                  <span className="text-sm font-medium">Contatos separados por vírgula</span>
                  <textarea
                    value={artistForm.contatos}
                    onChange={(e) => setArtistForm((current) => ({ ...current, contatos: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-20"
                  />
                </label>
              </div>

              <label className="space-y-2 block">
                <span className="text-sm font-medium">Tags separadas por vírgula</span>
                <input
                  value={artistForm.tags}
                  onChange={(e) => setArtistForm((current) => ({ ...current, tags: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Dialog.Close className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">
                  Cancelar
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleCreateArtist}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                >
                  Criar perfil
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={createProjectOpen} onOpenChange={setCreateProjectOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[720px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-semibold">Novo projeto</Dialog.Title>
                <Dialog.Description className="text-sm text-slate-600">
                  Crie um projeto vinculado ao perfil selecionado.
                </Dialog.Description>
              </div>
              <Dialog.Close className="p-2 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium">Artista</span>
                  <select
                    value={projectForm.artistaId}
                    onChange={(e) => setProjectForm((current) => ({ ...current, artistaId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {items.map((artista) => (
                      <option key={artista.id} value={artista.id}>
                        {artista.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Nome</span>
                  <input
                    value={projectForm.nome}
                    onChange={(e) => setProjectForm((current) => ({ ...current, nome: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Status</span>
                  <select
                    value={projectForm.status}
                    onChange={(e) => setProjectForm((current) => ({ ...current, status: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option>Planejamento</option>
                    <option>Em desenvolvimento</option>
                    <option>Ativo</option>
                    <option>Concluido</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Orçamento</span>
                  <input
                    value={projectForm.orcamento}
                    onChange={(e) => setProjectForm((current) => ({ ...current, orcamento: e.target.value }))}
                    type="number"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="space-y-2 block">
                <span className="text-sm font-medium">Descrição</span>
                <textarea
                  value={projectForm.descricao}
                  onChange={(e) => setProjectForm((current) => ({ ...current, descricao: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-24"
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-sm font-medium">Tags separadas por vírgula</span>
                <input
                  value={projectForm.tags}
                  onChange={(e) => setProjectForm((current) => ({ ...current, tags: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Dialog.Close className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">
                  Cancelar
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleCreateProject}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                >
                  Criar projeto
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {error ? <div className="fixed bottom-4 left-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div> : null}
    </div>
  );
}
