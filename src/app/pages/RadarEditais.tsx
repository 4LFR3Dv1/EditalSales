import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, Calendar, DollarSign, Target, Plus, Archive, Sparkles, Send, Loader2, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import {
  analyzeEdital,
  createOportunidade,
  createEdital,
  getChatMessages,
  getEdital,
  importEdital,
  listEditais,
  listDocumentos,
  listMatches,
  normalizeLabel,
  formatMoney,
  sendChatMessage,
  type ChatMessage,
  type Edital,
  type EditalAnalysis,
  type Documento,
  type MatchOportunidadeProjeto,
} from "../lib/api";

const promptSuggestions = [
  "Resuma esse edital",
  "Quais documentos são obrigatórios?",
  "Esse edital aceita pessoa física?",
  "Quais artistas combinam melhor?",
  "Crie uma checklist de submissão",
  "Quais riscos de desclassificação?",
];

function renderInlineMarkdown(text: string) {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <strong key={`${match.index}-${match[1]}`} className="font-semibold text-slate-900">
        {match[1]}
      </strong>,
    );
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length ? parts : text;
}

function renderEditorialContent(text: string) {
  const lines = text.split(/\n+/);
  const blocks: ReactNode[] = [];
  let listItems: ReactNode[] = [];
  let listKey = 0;

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`ul-${listKey++}`} className="mt-2 space-y-1 pl-4 text-sm text-slate-700 list-disc">
        {listItems}
      </ul>,
    );
    listItems = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushList();
      blocks.push(<div key={`gap-${index}`} className="h-2" />);
      return;
    }

    if (line.startsWith("- ")) {
      const content = line.slice(2).trim();
      listItems.push(
        <li key={`li-${index}`} className="leading-relaxed">
          {renderInlineMarkdown(content)}
        </li>,
      );
      return;
    }

    flushList();

    if (line.startsWith("**") && line.endsWith("**")) {
      blocks.push(
        <h4 key={`h-${index}`} className="mt-3 text-sm font-semibold uppercase tracking-wide text-slate-900">
          {renderInlineMarkdown(line.replace(/^\*\*|\*\*$/g, ""))}
        </h4>,
      );
      return;
    }

    blocks.push(
      <p key={`p-${index}`} className="text-sm leading-relaxed text-slate-700">
        {renderInlineMarkdown(line)}
      </p>,
    );
  });

  flushList();
  return blocks;
}

function renderAssistantMessage(msg: ChatMessage) {
  const sections = msg.metadata?.sections;

  if (!sections || sections.length === 0) {
    return <div className="space-y-1">{renderEditorialContent(msg.content)}</div>;
  }

  return (
    <div className="space-y-3">
      {sections.map((section) => (
        <div key={section.title} className="space-y-1">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-900">
            {section.title}
          </h4>
          <ul className="space-y-1 pl-4 text-sm text-slate-700 list-disc">
            {section.bullets.map((bullet) => (
              <li key={bullet} className="leading-relaxed">
                {renderInlineMarkdown(bullet)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function RadarEditais() {
  const [editais, setEditais] = useState<Edital[]>([]);
  const [selectedEditalId, setSelectedEditalId] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<EditalAnalysis | null>(null);
  const [matches, setMatches] = useState<MatchOportunidadeProjeto[]>([]);
  const [documents, setDocuments] = useState<Documento[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [search, setSearch] = useState("");
  const [areaFilter, setAreaFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const [sendingChat, setSendingChat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [assistantActionsOpen, setAssistantActionsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"manual" | "import">("manual");
  const [createForm, setCreateForm] = useState({
    nome: "",
    fonte: "",
    fonteUrl: "",
    area: "Música",
    prazo: "",
    valor: "",
    resumo: "",
    quemPodeParticipar: "",
    descricaoCompleta: "",
    tags: "",
    content: "",
  });

  const selectedEdital = useMemo(
    () => editais.find((item) => item.id === selectedEditalId) || null,
    [editais, selectedEditalId],
  );

  useEffect(() => {
    let active = true;

    async function loadEditais() {
      try {
        setLoadingList(true);
        setError(null);
        const [editaisResponse, matchesResponse, documentsResponse] = await Promise.all([
          listEditais(),
          listMatches(),
          listDocumentos(),
        ]);
        if (!active) return;
        setEditais(editaisResponse.items);
        setMatches(matchesResponse.items);
        setDocuments(documentsResponse.items);
        setSelectedEditalId((current) => current || editaisResponse.items[0]?.id || null);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar editais");
        }
      } finally {
        if (active) setLoadingList(false);
      }
    }

    loadEditais();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedEditalId) return;

    let active = true;

    async function loadDetail() {
      try {
        setLoadingDetail(true);
        setLoadingChat(true);
        setActionMessage(null);
        const [detail, chat] = await Promise.all([
          getEdital(selectedEditalId),
          getChatMessages("edital", selectedEditalId),
        ]);

        if (!active) return;

        setAnalysis(detail.analysis);
        setMessages(chat.items);
        setEditais((current) =>
          current.map((item) => (item.id === detail.item.id ? { ...item, ...detail.item } : item)),
        );
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar o edital selecionado");
        }
      } finally {
        if (active) {
          setLoadingDetail(false);
          setLoadingChat(false);
        }
      }
    }

    loadDetail();

    return () => {
      active = false;
    };
  }, [selectedEditalId]);

  const filteredEditais = useMemo(() => {
    return editais.filter((item) => {
      const matchesSearch =
        !search ||
        item.nome.toLowerCase().includes(search.toLowerCase()) ||
        item.fonte.toLowerCase().includes(search.toLowerCase()) ||
        item.area.toLowerCase().includes(search.toLowerCase());
      const matchesArea = areaFilter === "all" || normalizeLabel(item.area) === areaFilter;
      const matchesStatus = statusFilter === "all" || normalizeLabel(item.status) === statusFilter;
      return matchesSearch && matchesArea && matchesStatus;
    });
  }, [editais, search, areaFilter, statusFilter]);

  async function handleSendMessage(message?: string) {
    if (!selectedEditalId || sendingChat) return;

    const pendingText = (message ?? inputMessage).trim();
    if (!pendingText) return;

    setInputMessage("");
    setSendingChat(true);

    const optimistic: ChatMessage = {
      id: `local_${Date.now()}`,
      role: "user",
      content: pendingText,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, optimistic]);

    try {
      const response = await sendChatMessage("edital", selectedEditalId, pendingText);
      setMessages((current) => {
        const withoutOptimistic = current.filter((msg) => msg.id !== optimistic.id);
        return [...withoutOptimistic, ...response.items];
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar mensagem");
      setMessages((current) => current.filter((msg) => msg.id !== optimistic.id));
      setInputMessage(pendingText);
    } finally {
      setSendingChat(false);
    }
  }

  async function handleQuickPrompt(prompt: string) {
    setInputMessage(prompt);
    await handleSendMessage(prompt);
  }

  async function handleCreateOpportunity(artistId: string, projectId: string | null, suggestedName: string) {
    if (!selectedEdital) return;

    try {
      setActionMessage(null);
      const response = await createOportunidade({
        editalId: selectedEdital.id,
        artistaId: artistId,
        projectId,
        nome: suggestedName || undefined,
        responsavel: "Nao atribuido",
        status: "Em fila",
        progresso: 0,
        pendencias: 0,
        risco: "Medio",
      });

      setActionMessage(`Oportunidade criada: ${response.item.nome}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar oportunidade");
    }
  }

  async function handleAnalyzeSelected() {
    if (!selectedEdital) return;

    try {
      setLoadingDetail(true);
      const response = await analyzeEdital(selectedEdital.id);
      setAnalysis((current) => current ? { ...current, ...response.analysis } : response.analysis);
      setActionMessage("Analise atualizada com sucesso");
      const detail = await getEdital(selectedEdital.id);
      setEditais((current) =>
        current.map((item) => (item.id === detail.item.id ? { ...item, ...detail.item } : item)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao analisar edital");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function handleCreateEdital() {
    try {
      setError(null);
      const response = await createEdital({
        nome: createForm.nome,
        fonte: createForm.fonte,
        fonteUrl: createForm.fonteUrl || null,
        area: createForm.area,
        prazo: Number(createForm.prazo || 0),
        valor: Number(createForm.valor || 0),
        resumo: createForm.resumo,
        quemPodeParticipar: createForm.quemPodeParticipar,
        descricaoCompleta: createForm.descricaoCompleta,
        tags: createForm.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setEditais((current) => [response.item, ...current]);
      setSelectedEditalId(response.item.id);
      setCreateOpen(false);
      setCreateForm({
        nome: "",
        fonte: "",
        fonteUrl: "",
        area: "Música",
        prazo: "",
        valor: "",
        resumo: "",
        quemPodeParticipar: "",
        descricaoCompleta: "",
        tags: "",
        content: "",
      });
      setActionMessage("Edital criado com sucesso");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar edital");
    }
  }

  async function handleImportEdital() {
    try {
      setError(null);
      const response = await importEdital({
        nome: createForm.nome || undefined,
        fonte: createForm.fonte || undefined,
        fonteUrl: createForm.fonteUrl || null,
        area: createForm.area,
        prazo: Number(createForm.prazo || 0),
        valor: Number(createForm.valor || 0),
        resumo: createForm.resumo,
        quemPodeParticipar: createForm.quemPodeParticipar,
        content: createForm.content,
        tags: createForm.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      });
      setEditais((current) => [response.item, ...current]);
      setSelectedEditalId(response.item.id);
      setCreateOpen(false);
      setCreateForm({
        nome: "",
        fonte: "",
        fonteUrl: "",
        area: "Música",
        prazo: "",
        valor: "",
        resumo: "",
        quemPodeParticipar: "",
        descricaoCompleta: "",
        tags: "",
        content: "",
      });
      setActionMessage("Edital importado com sucesso");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao importar edital");
    }
  }

  const displayEdital = selectedEdital;
  const displayAnalysis = analysis;
  const displayMatches = selectedEdital ? matches.filter((item) => item.editalId === selectedEdital.id) : [];
  const displayDocuments = selectedEdital
    ? documents.filter(
        (doc) =>
          doc.editalId === selectedEdital.id ||
          displayMatches.some((match) => match.oportunidadeId === doc.oportunidadeId),
      )
    : [];

  return (
    <div className="flex h-full bg-slate-50">
      <div className="w-96 bg-white border-r border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200 space-y-3">
          <div className="flex gap-2">
            <button className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
              <Search className="w-4 h-4" />
              Buscar editais
            </button>
            <button
              onClick={() => setCreateOpen(true)}
              className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
            >
              <Plus className="w-4 h-4" />
              Novo edital
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar..."
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex gap-2">
            <select
              value={areaFilter}
              onChange={(e) => setAreaFilter(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Todas áreas</option>
              <option value="Música">Música</option>
              <option value="Artes Visuais">Artes Visuais</option>
              <option value="Tecnologia">Tecnologia</option>
              <option value="Inovação">Inovação</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Todos status</option>
              <option value="Novo">Novo</option>
              <option value="Em análise">Em análise</option>
              <option value="Analisado">Analisado</option>
            </select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loadingList ? (
            <div className="flex h-40 items-center justify-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando editais...
            </div>
          ) : filteredEditais.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              Nenhum edital disponível.
            </div>
          ) : (
            filteredEditais.map((edital) => (
              <div
                key={edital.id}
                onClick={() => setSelectedEditalId(edital.id)}
                className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedEdital?.id === edital.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
              >
                <h3 className="font-semibold text-sm mb-2">{edital.nome}</h3>
                <p className="text-xs text-slate-600 mb-3">{edital.fonte}</p>

                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs">
                    {normalizeLabel(edital.area)}
                  </span>
                  <span
                    className={`px-2 py-1 rounded text-xs ${
                      normalizeLabel(edital.prioridade) === "Alta"
                        ? "bg-red-100 text-red-700"
                        : normalizeLabel(edital.prioridade) === "Média"
                          ? "bg-yellow-100 text-yellow-700"
                          : "bg-green-100 text-green-700"
                    }`}
                  >
                    {normalizeLabel(edital.prioridade)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1 text-slate-600">
                    <Calendar className="w-3 h-3" />
                    <span>{edital.prazo} dias</span>
                  </div>
                  <div className="flex items-center gap-1 text-slate-600">
                    <DollarSign className="w-3 h-3" />
                    <span>{formatMoney(edital.valor)}</span>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-slate-200 flex items-center justify-between text-xs">
                  <span
                    className={`px-2 py-1 rounded ${
                      normalizeLabel(edital.status) === "Analisado"
                        ? "bg-green-100 text-green-700"
                        : normalizeLabel(edital.status) === "Em análise"
                          ? "bg-blue-100 text-blue-700"
                          : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {normalizeLabel(edital.status)}
                  </span>
                  <span className="text-slate-600">
                    {edital.matches.artistas} artistas / {edital.matches.projetos} projetos
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col bg-white">
        <div className="p-6 border-b border-slate-200">
          {displayEdital ? (
            <>
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h2 className="text-2xl font-semibold mb-2">{displayEdital.nome}</h2>
                  <p className="text-slate-600">{displayEdital.fonte}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAnalyzeSelected}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Reanalisar
                  </button>
                  <button className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-2">
                    <Archive className="w-4 h-4" />
                    Arquivar
                  </button>
                </div>
              </div>

              <div className="flex gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-slate-500" />
                  <span className="font-medium">Prazo:</span>
                  <span className="text-red-600 font-semibold">{displayEdital.prazo} dias</span>
                </div>
                <div className="flex items-center gap-2">
                  <DollarSign className="w-4 h-4 text-slate-500" />
                  <span className="font-medium">Valor:</span>
                  <span>{formatMoney(displayEdital.valor)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Target className="w-4 h-4 text-slate-500" />
                  <span className="font-medium">Compatibilidade:</span>
                  <span className="text-green-600 font-semibold">{displayEdital.compatibilidade}%</span>
                </div>
              </div>
            </>
          ) : (
            <div className="h-20 flex items-center text-slate-500">
              Nenhum edital cadastrado. Crie ou importe o primeiro registro.
            </div>
          )}
        </div>

        <Tabs.Root defaultValue="resumo" className="flex-1 flex flex-col overflow-hidden">
          <Tabs.List className="flex border-b border-slate-200 px-6">
            <Tabs.Trigger
              value="resumo"
              className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900"
            >
              Resumo
            </Tabs.Trigger>
            <Tabs.Trigger
              value="requisitos"
              className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900"
            >
              Requisitos
            </Tabs.Trigger>
            <Tabs.Trigger
              value="criterios"
              className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900"
            >
              Critérios
            </Tabs.Trigger>
            <Tabs.Trigger
              value="documentos"
              className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900"
            >
              Documentos
            </Tabs.Trigger>
            <Tabs.Trigger
              value="artistas"
              className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900"
            >
              Artistas/Projetos
            </Tabs.Trigger>
            <Tabs.Trigger
              value="matches"
              className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900"
            >
              Matches
            </Tabs.Trigger>
            <Tabs.Trigger
              value="descricao"
              className="px-4 py-3 text-sm font-medium text-slate-600 border-b-2 border-transparent data-[state=active]:text-blue-600 data-[state=active]:border-blue-600 hover:text-slate-900"
            >
              Descrição completa
            </Tabs.Trigger>
          </Tabs.List>

          <div className="flex-1 overflow-y-auto">
            <Tabs.Content value="resumo" className="p-6">
              {displayEdital ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h4 className="font-semibold mb-2 text-blue-900">Objetivo</h4>
                    <p className="text-sm text-blue-800">{displayAnalysis?.resumoExecutivo || displayEdital.resumo}</p>
                  </div>
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h4 className="font-semibold mb-2 text-green-900">Quem pode participar</h4>
                    <p className="text-sm text-green-800">{displayEdital.quemPodeParticipar}</p>
                  </div>
                  <div className="p-4 bg-purple-50 border border-purple-200 rounded-lg">
                    <h4 className="font-semibold mb-2 text-purple-900">Valor disponível</h4>
                    <p className="text-2xl font-bold text-purple-800">{formatMoney(displayEdital.valor)}</p>
                  </div>
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <h4 className="font-semibold mb-2 text-yellow-900">Prazo de inscrição</h4>
                    <p className="text-2xl font-bold text-yellow-800">{displayEdital.prazo} dias</p>
                  </div>
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <h4 className="font-semibold mb-2 text-green-900">Compatibilidade</h4>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-green-200 rounded-full h-2">
                        <div
                          className="bg-green-600 h-2 rounded-full"
                          style={{ width: `${displayEdital.compatibilidade}%` }}
                        />
                      </div>
                      <span className="text-xl font-bold text-green-800">{displayEdital.compatibilidade}%</span>
                    </div>
                  </div>
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <h4 className="font-semibold mb-2 text-red-900">Principais riscos</h4>
                    <ul className="text-sm text-red-800 space-y-1">
                      {(displayAnalysis?.riscos || displayEdital.riscos).map((risco) => (
                        <li key={risco} className="flex items-start gap-2">
                          <span className="text-red-600 mt-0.5">•</span>
                          <span>{risco}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="col-span-2 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <h4 className="font-semibold mb-2 text-slate-900">Próxima ação recomendada</h4>
                    <p className="text-sm text-slate-700">{displayEdital.proximaAcao}</p>
                  </div>
                  {actionMessage && (
                    <div className="col-span-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                      {actionMessage}
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Não há edital selecionado.
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="requisitos" className="p-6">
              {(displayAnalysis?.requisitos || []).length > 0 ? (
                <div className="space-y-4">
                  {(displayAnalysis?.requisitos || []).map((req) => (
                    <div key={req} className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                      <p className="text-sm text-slate-700">{req}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Sem requisitos extraídos.
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="criterios" className="p-6">
              {(displayAnalysis?.criterios || []).length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="text-left py-3 px-4 font-semibold">Critério</th>
                        <th className="text-left py-3 px-4 font-semibold">Peso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(displayAnalysis?.criterios || []).map((crit) => (
                        <tr key={crit.criterio} className="border-b border-slate-100">
                          <td className="py-3 px-4">{crit.criterio}</td>
                          <td className="py-3 px-4 font-semibold text-blue-600">{crit.peso}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Sem critérios carregados.
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="documentos" className="p-6">
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-900 mb-3">
                    Documentos obrigatórios extraídos
                  </h4>
                  {(displayAnalysis?.documentosObrigatorios || []).length > 0 ? (
                    <div className="space-y-3">
                      {(displayAnalysis?.documentosObrigatorios || []).map((doc) => (
                        <div key={doc} className="p-4 bg-white border border-slate-200 rounded-lg">
                          <h4 className="font-semibold mb-1">{doc}</h4>
                          <p className="text-sm text-slate-600">Documento obrigatório extraído do edital.</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                      Sem documentos obrigatórios.
                    </div>
                  )}
                </div>

                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-900 mb-3">
                    Documentos vinculados
                  </h4>
                  {displayDocuments.length > 0 ? (
                    <div className="space-y-3">
                      {displayDocuments.map((doc) => (
                        <div key={doc.id} className="p-4 bg-white border border-slate-200 rounded-lg">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h4 className="font-semibold mb-1">{doc.nome}</h4>
                              <p className="text-sm text-slate-600">
                                {doc.tipo} • {doc.status} • {doc.ownerType}
                              </p>
                            </div>
                            <span className="px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-700">
                              {doc.versao || "v1"}
                            </span>
                          </div>
                          {doc.resumoIa ? <p className="mt-3 text-sm text-slate-700">{doc.resumoIa}</p> : null}
                          <div className="mt-3 grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                            <p>Vínculo: {doc.editalId || doc.oportunidadeId || "não informado"}</p>
                            <p>Checklist gerado: {doc.checklistGerado ? "Sim" : "Não"}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                      Nenhum documento vinculado encontrado para este edital.
                    </div>
                  )}
                </div>
              </div>
            </Tabs.Content>

            <Tabs.Content value="artistas" className="p-6">
              {(displayAnalysis?.sugestoes || []).length > 0 ? (
                <div className="space-y-3">
                  {(displayAnalysis?.sugestoes || []).map((match) => (
                    <div key={`${match.artistaId}-${match.projetoId || "no-project"}`} className="p-4 bg-white border border-slate-200 rounded-lg">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <h4 className="font-semibold mb-1">{match.artista}</h4>
                          <p className="text-sm text-slate-600 mb-2">{match.motivo}</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 max-w-xs bg-slate-200 rounded-full h-2">
                              <div
                                className="bg-green-600 h-2 rounded-full"
                                style={{ width: `${match.compatibilidade}%` }}
                              />
                            </div>
                            <span className="text-sm font-semibold text-green-600">{match.compatibilidade}%</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handleCreateOpportunity(match.artistaId, match.projetoId, `${displayEdital?.nome || "Oportunidade"} - ${match.artista}`)}
                            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                          >
                            Criar oportunidade
                          </button>
                        </div>
                      </div>
                      {match.pendencias > 0 && (
                        <div className="text-sm text-yellow-700 bg-yellow-50 border border-yellow-200 rounded px-3 py-2">
                          {match.pendencias} pendência(s) documental(is)
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Sem artistas ou projetos sugeridos.
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="matches" className="p-6">
              {displayMatches.length > 0 ? (
                <div className="space-y-3">
                  {displayMatches.map((match) => (
                    <div key={match.id} className="p-4 bg-white border border-slate-200 rounded-lg">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h4 className="font-semibold">Nota de match {match.notaMatch}%</h4>
                          <p className="text-sm text-slate-600">{match.motivoMatch}</p>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium border ${
                          match.recomendacao === "inscrever"
                            ? "bg-green-100 text-green-700 border-green-200"
                            : match.recomendacao === "avaliar"
                              ? "bg-yellow-100 text-yellow-700 border-yellow-200"
                              : "bg-slate-100 text-slate-700 border-slate-200"
                        }`}>
                          {match.recomendacao}
                        </span>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-slate-500 mb-1">Prazo de ação</p>
                          <p className="font-medium capitalize">{match.prazoDeAcao}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3">
                          <p className="text-slate-500 mb-1">Riscos</p>
                          <p className="font-medium">{match.riscos.length ? match.riscos.join(", ") : "Nenhum"}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 p-3 col-span-2">
                          <p className="text-slate-500 mb-1">Documentos faltantes</p>
                          <p className="font-medium">{match.documentosFaltantes.length ? match.documentosFaltantes.join(", ") : "Nenhum"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Sem matches registrados para este edital.
                </div>
              )}
            </Tabs.Content>

            <Tabs.Content value="descricao" className="p-6">
              {displayEdital ? (
                <div className="prose max-w-none">
                  <p className="text-slate-700 leading-relaxed">{displayEdital.descricaoCompleta}</p>
                  {displayEdital.fonteUrl ? (
                    <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <h4 className="font-semibold mb-2 text-blue-900">Link oficial</h4>
                      <a href={displayEdital.fonteUrl} className="text-blue-600 hover:underline text-sm" target="_blank" rel="noreferrer">
                        {displayEdital.fonteUrl}
                      </a>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  Não há descrição para exibir.
                </div>
              )}
            </Tabs.Content>
          </div>
        </Tabs.Root>
      </div>

      <div className="w-96 bg-white border-l border-slate-200 flex flex-col">
        <div className="p-4 border-b border-slate-200">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-5 h-5 text-blue-600" />
            <h3 className="font-semibold">Assistente do edital</h3>
          </div>
          <p className="text-xs text-slate-600">Pergunte sobre requisitos, documentos e estratégias</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {loadingChat ? (
            <div className="flex h-24 items-center justify-center text-slate-500">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Carregando chat...
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[80%] rounded-lg p-3 ${
                    msg.role === "user" ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-900"
                  }`}
                >
                  <div className={msg.role === "assistant" ? "space-y-1" : "text-sm leading-relaxed"}>
                    {msg.role === "assistant" ? renderAssistantMessage(msg) : <p className="text-sm">{msg.content}</p>}
                  </div>
                  {msg.role === "assistant" && msg.metadata?.highlights?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {msg.metadata.highlights.map((item) => (
                        <span
                          key={item}
                          className="inline-flex items-center rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-medium text-slate-700"
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {msg.role === "assistant" && typeof msg.metadata?.confidence === "number" ? (
                    <p className="mt-2 text-[10px] uppercase tracking-wide text-slate-500">
                      Confiança {msg.metadata.confidence}%
                    </p>
                  ) : null}
                  {msg.role === "assistant" && msg.metadata?.actions?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {msg.metadata.actions.map((action) => (
                        <button
                          key={`${msg.id}-${action.label}`}
                          onClick={() => handleQuickPrompt(action.prompt)}
                          className="rounded-full border border-slate-300 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              placeholder="Pergunte sobre o edital..."
              className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
            onClick={() => handleSendMessage()}
              disabled={sendingChat}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
            >
              {sendingChat ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setAssistantActionsOpen(true)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs hover:bg-slate-50 flex items-center justify-center gap-2"
          >
            <Sparkles className="w-3 h-3" />
            Abrir atalhos do assistente
          </button>
          {error ? <p className="text-xs text-red-600">{error}</p> : null}
          {actionMessage ? <p className="text-xs text-green-700">{actionMessage}</p> : null}
          {loadingDetail ? (
            <p className="text-xs text-slate-500 flex items-center gap-2">
              <Loader2 className="w-3 h-3 animate-spin" />
              Atualizando detalhes...
            </p>
          ) : null}
        </div>
      </div>

      <Dialog.Root open={assistantActionsOpen} onOpenChange={setAssistantActionsOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(920px,92vw)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 p-6">
              <div>
                <Dialog.Title className="text-xl font-semibold">Atalhos do assistente</Dialog.Title>
                <Dialog.Description className="text-sm text-slate-600">
                  Escolha uma pergunta pronta ou envie uma consulta mais longa.
                </Dialog.Description>
              </div>
              <Dialog.Close className="rounded-lg p-2 hover:bg-slate-100">
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>

            <div className="grid gap-6 p-6 md:grid-cols-[1.1fr_0.9fr]">
              <div className="space-y-4">
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Perguntas rápidas</h4>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {promptSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        onClick={() => handleQuickPrompt(suggestion)}
                        className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Atalhos operacionais</h4>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={() => handleQuickPrompt("Crie uma checklist de submissão")}
                      className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm hover:bg-slate-50"
                    >
                      <Sparkles className="w-4 h-4" />
                      Gerar checklist
                    </button>
                    <button
                      onClick={() => handleQuickPrompt("Quais artistas combinam melhor?")}
                      className="flex items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-3 text-sm hover:bg-slate-50"
                    >
                      <Target className="w-4 h-4" />
                      Sugerir artistas
                    </button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-slate-900">Escrever consulta</h4>
                <p className="mt-1 text-xs text-slate-600">
                  Use perguntas mais longas quando quiser comparar critérios, validar documentos ou pedir estratégia.
                </p>
                <textarea
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  placeholder="Ex.: Resuma esse edital e destaque riscos, documentos obrigatórios e próximos passos."
                  className="mt-4 min-h-40 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                />
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setAssistantActionsOpen(false)}
                    className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm hover:bg-white"
                  >
                    Fechar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAssistantActionsOpen(false);
                      handleSendMessage(inputMessage);
                    }}
                    className="flex-1 rounded-xl bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
                  >
                    Enviar
                  </button>
                </div>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[760px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-semibold">Novo edital</Dialog.Title>
                <Dialog.Description className="text-sm text-slate-600">
                  Cadastre manualmente ou importe texto bruto para criar um edital no Radar.
                </Dialog.Description>
              </div>
              <Dialog.Close className="p-2 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCreateMode("manual")}
                  className={`px-3 py-2 rounded-lg text-sm border ${
                    createMode === "manual" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300"
                  }`}
                >
                  Cadastro manual
                </button>
                <button
                  type="button"
                  onClick={() => setCreateMode("import")}
                  className={`px-3 py-2 rounded-lg text-sm border ${
                    createMode === "import" ? "bg-blue-600 text-white border-blue-600" : "bg-white text-slate-700 border-slate-300"
                  }`}
                >
                  Importar texto
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium">Nome</span>
                  <input
                    value={createForm.nome}
                    onChange={(e) => setCreateForm((current) => ({ ...current, nome: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Edital Natura Musical 2026"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Fonte</span>
                  <input
                    value={createForm.fonte}
                    onChange={(e) => setCreateForm((current) => ({ ...current, fonte: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Secretaria de Cultura"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Link da fonte</span>
                  <input
                    value={createForm.fonteUrl}
                    onChange={(e) => setCreateForm((current) => ({ ...current, fonteUrl: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="https://..."
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Área</span>
                  <select
                    value={createForm.area}
                    onChange={(e) => setCreateForm((current) => ({ ...current, area: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option>Música</option>
                    <option>Artes Visuais</option>
                    <option>Tecnologia</option>
                    <option>Inovação</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Prazo (dias)</span>
                  <input
                    value={createForm.prazo}
                    onChange={(e) => setCreateForm((current) => ({ ...current, prazo: e.target.value }))}
                    type="number"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Valor</span>
                  <input
                    value={createForm.valor}
                    onChange={(e) => setCreateForm((current) => ({ ...current, valor: e.target.value }))}
                    type="number"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <label className="space-y-2 block">
                <span className="text-sm font-medium">Resumo</span>
                <textarea
                  value={createForm.resumo}
                  onChange={(e) => setCreateForm((current) => ({ ...current, resumo: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-24"
                />
              </label>

              <label className="space-y-2 block">
                <span className="text-sm font-medium">Quem pode participar</span>
                <textarea
                  value={createForm.quemPodeParticipar}
                  onChange={(e) => setCreateForm((current) => ({ ...current, quemPodeParticipar: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-20"
                />
              </label>

              {createMode === "manual" ? (
                <label className="space-y-2 block">
                  <span className="text-sm font-medium">Descrição completa</span>
                  <textarea
                    value={createForm.descricaoCompleta}
                    onChange={(e) => setCreateForm((current) => ({ ...current, descricaoCompleta: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-28"
                    placeholder="Texto integral do edital"
                  />
                </label>
              ) : (
                <label className="space-y-2 block">
                  <span className="text-sm font-medium">Texto bruto / conteúdo importado</span>
                  <textarea
                    value={createForm.content}
                    onChange={(e) => setCreateForm((current) => ({ ...current, content: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm min-h-28"
                    placeholder="Cole o texto do PDF, link ou extração OCR aqui"
                  />
                </label>
              )}

              <label className="space-y-2 block">
                <span className="text-sm font-medium">Tags separadas por vírgula</span>
                <input
                  value={createForm.tags}
                  onChange={(e) => setCreateForm((current) => ({ ...current, tags: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="musica, circulacao, cultura"
                />
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Dialog.Close className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">
                  Cancelar
                </Dialog.Close>
                {createMode === "manual" ? (
                  <button
                    type="button"
                    onClick={handleCreateEdital}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                  >
                    Salvar edital
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleImportEdital}
                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                  >
                    Importar conteúdo
                  </button>
                )}
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
