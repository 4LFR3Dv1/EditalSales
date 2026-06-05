import { useEffect, useMemo, useState } from "react";
import { Calendar, User, AlertCircle, FileText, X, Plus, MessageSquare, Clock, CheckCircle2, Loader2 } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { DndProvider, useDrag, useDrop } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  createOportunidade,
  listArtistas,
  listEditais,
  listProjetos,
  getOportunidade,
  listOportunidades,
  normalizeLabel,
  patchOportunidade,
  riskBadgeClass,
  type Oportunidade,
  type Artista,
  type Edital,
  type Projeto,
} from "../lib/api";

const columns = [
  { id: "Em fila", title: "Em fila", color: "slate" },
  { id: "Em revisão", title: "Em revisão", color: "blue" },
  { id: "Concluídos", title: "Concluídos", color: "green" },
];

const columnBadgeClasses: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700",
  blue: "bg-blue-100 text-blue-700",
  green: "bg-green-100 text-green-700",
};

const DND_ITEM_TYPE = "OPPORTUNITY_CARD";

type DragItem = {
  id: string;
  status: string;
};

function nextStatus(status: string) {
  const current = normalizeLabel(status);
  if (current === "Em fila") return "Em revisão";
  if (current === "Em revisão") return "Concluídos";
  return "Em fila";
}

function OpportunityCard({
  oportunidade,
  onSelect,
}: {
  oportunidade: Oportunidade;
  onSelect: (id: string) => void;
}) {
  const [{ isDragging }, dragRef] = useDrag(
    () => ({
      type: DND_ITEM_TYPE,
      item: { id: oportunidade.id, status: oportunidade.status } satisfies DragItem,
      collect: (monitor) => ({
        isDragging: monitor.isDragging(),
      }),
    }),
    [oportunidade.id, oportunidade.status],
  );

  return (
    <div
      ref={dragRef}
      onClick={() => onSelect(oportunidade.id)}
      className={`bg-white border-2 border-slate-200 rounded-lg p-4 cursor-grab hover:border-blue-400 hover:shadow-md transition-all ${
        isDragging ? "opacity-50" : ""
      }`}
    >
      <h4 className="font-semibold mb-2">{oportunidade.nome}</h4>
      <p className="text-sm text-slate-600 mb-3">{oportunidade.edital}</p>

      <div className="space-y-2 mb-3">
        <div className="flex items-center gap-2 text-sm">
          <User className="w-4 h-4 text-slate-500" />
          <span className="text-slate-700">{oportunidade.artista}</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-slate-500" />
          <span className="text-slate-700">Prazo: {oportunidade.prazo} dias</span>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <User className="w-4 h-4 text-slate-500" />
          <span className="text-slate-700">Resp: {oportunidade.responsavel}</span>
        </div>
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between text-sm mb-1">
          <span className="text-slate-600">Progresso</span>
          <span className="font-semibold">{oportunidade.progresso}%</span>
        </div>
        <div className="w-full bg-slate-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full ${
              oportunidade.progresso === 100
                ? "bg-green-600"
                : oportunidade.progresso >= 60
                  ? "bg-blue-600"
                  : "bg-yellow-600"
            }`}
            style={{ width: `${oportunidade.progresso}%` }}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {oportunidade.pendencias > 0 && (
            <span className="px-2 py-1 bg-yellow-100 text-yellow-700 rounded text-xs font-medium flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              {oportunidade.pendencias} pendências
            </span>
          )}
        </div>
        <span className={`px-2 py-1 rounded text-xs font-medium border ${riskBadgeClass(oportunidade.risco)}`}>
          Risco {normalizeLabel(oportunidade.risco)}
        </span>
      </div>
    </div>
  );
}

function OpportunityColumn({
  column,
  onSelect,
  onMove,
}: {
  column: { id: string; title: string; color: string; items: Oportunidade[] };
  onSelect: (id: string) => void;
  onMove: (id: string, status: string) => void;
}) {
  const [{ isOver, canDrop }, dropRef] = useDrop(
    () => ({
      accept: DND_ITEM_TYPE,
      drop: (item: DragItem) => {
        if (normalizeLabel(item.status) !== column.id) {
          onMove(item.id, column.id);
        }
      },
      canDrop: (item: DragItem) => normalizeLabel(item.status) !== column.id,
      collect: (monitor) => ({
        isOver: monitor.isOver({ shallow: true }),
        canDrop: monitor.canDrop(),
      }),
    }),
    [column.id, onMove],
  );

  return (
    <div className="flex-1 min-w-[380px] flex flex-col">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2">
          {column.title}
          <span className={`px-2 py-0.5 rounded-full text-xs ${columnBadgeClasses[column.color]}`}>
            {column.items.length}
          </span>
        </h3>
      </div>

      <div
        ref={dropRef}
        className={`flex-1 space-y-3 overflow-y-auto rounded-2xl transition-colors ${
          isOver && canDrop ? "bg-blue-50/70 ring-2 ring-inset ring-blue-200" : ""
        }`}
      >
        {column.items.map((oportunidade) => (
          <OpportunityCard key={oportunidade.id} oportunidade={oportunidade} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

export default function CRMOportunidades() {
  const [items, setItems] = useState<Oportunidade[]>([]);
  const [selectedOportunidadeId, setSelectedOportunidadeId] = useState<string | null>(null);
  const [selectedOportunidade, setSelectedOportunidade] = useState<Oportunidade | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editais, setEditais] = useState<Edital[]>([]);
  const [artistas, setArtistas] = useState<Artista[]>([]);
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [createForm, setCreateForm] = useState({
    editalId: "",
    artistaId: "",
    projectId: "",
    nome: "",
    responsavel: "",
    status: "Em fila",
    progresso: "0",
    pendencias: "0",
    risco: "Médio",
    prazo: "",
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const [response, editaisResponse, artistasResponse, projetosResponse] = await Promise.all([
          listOportunidades(),
          listEditais(),
          listArtistas(),
          listProjetos(),
        ]);
        if (!active) return;
        setItems(response.items);
        setSelectedOportunidadeId((current) => current || response.items[0]?.id || null);
        setEditais(editaisResponse.items);
        setArtistas(artistasResponse.items);
        setProjetos(projetosResponse.items);
        setCreateForm((current) => ({
          ...current,
          editalId: current.editalId || editaisResponse.items[0]?.id || "",
          artistaId: current.artistaId || artistasResponse.items[0]?.id || "",
          projectId: current.projectId || projetosResponse.items[0]?.id || "",
          responsavel: current.responsavel || "Nao atribuido",
        }));
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar oportunidades");
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
    if (!selectedOportunidadeId) return;

    let active = true;

    async function loadDetail() {
      try {
        setLoadingDetail(true);
        const response = await getOportunidade(selectedOportunidadeId);
        if (!active) return;
        setSelectedOportunidade(response.item);
        setItems((current) =>
          current.map((item) => (item.id === response.item.id ? { ...item, ...response.item } : item)),
        );
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Falha ao carregar oportunidade");
        }
      } finally {
        if (active) setLoadingDetail(false);
      }
    }

    loadDetail();

    return () => {
      active = false;
    };
  }, [selectedOportunidadeId]);

  const grouped = useMemo(() => {
    return columns.map((column) => ({
      ...column,
      items: items.filter((item) => normalizeLabel(item.status) === column.id),
    }));
  }, [items]);

  async function updateOpportunity(id: string, payload: Partial<Oportunidade>) {
    setSaving(true);
    try {
      const response = await patchOportunidade(id, payload);
      setItems((current) => current.map((item) => (item.id === id ? { ...item, ...response.item } : item)));
      setSelectedOportunidade((current) => (current?.id === id ? { ...current, ...response.item } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao atualizar oportunidade");
    } finally {
      setSaving(false);
    }
  }

  async function handleMoveStatus() {
    if (!selectedOportunidade) return;
    await updateOpportunity(selectedOportunidade.id, {
      status: nextStatus(selectedOportunidade.status),
    });
  }

  async function handleAddComment() {
    if (!selectedOportunidade || !comment.trim()) return;
    const nextComments = [
      ...(selectedOportunidade.comentarios || []),
      {
        autor: "Equipe interna",
        texto: comment.trim(),
        createdAt: new Date().toISOString(),
      },
    ];
    setComment("");
    await updateOpportunity(selectedOportunidade.id, { comentarios: nextComments });
  }

  function handleCloseDetail() {
    setSelectedOportunidadeId(null);
    setSelectedOportunidade(null);
    setComment("");
    setLoadingDetail(false);
  }

  async function handleCreateOpportunity() {
    try {
      setSaving(true);
      setError(null);
      const response = await createOportunidade({
        editalId: createForm.editalId,
        artistaId: createForm.artistaId,
        projectId: createForm.projectId || null,
        nome: createForm.nome || undefined,
        responsavel: createForm.responsavel || undefined,
        status: createForm.status,
        progresso: Number(createForm.progresso || 0),
        pendencias: Number(createForm.pendencias || 0),
        risco: createForm.risco,
        prazo: Number(createForm.prazo || 0),
      });
      setItems((current) => [response.item, ...current]);
      setSelectedOportunidadeId(response.item.id);
      setCreateOpen(false);
      setCreateForm({
        editalId: editais[0]?.id || "",
        artistaId: artistas[0]?.id || "",
        projectId: projetos[0]?.id || "",
        nome: "",
        responsavel: "Nao atribuido",
        status: "Em fila",
        progresso: "0",
        pendencias: "0",
        risco: "Médio",
        prazo: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao criar oportunidade");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DndProvider backend={HTML5Backend}>
      <div className="h-full flex flex-col bg-slate-50">
      <div className="p-6 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold mb-1">CRM de Oportunidades</h2>
            <p className="text-slate-600">Acompanhe todas as submissões em andamento</p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setCreateOpen(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Nova oportunidade
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-x-auto p-6">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-slate-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Carregando oportunidades...
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <div className="max-w-md rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
              <h3 className="text-lg font-semibold mb-2">Nenhuma oportunidade cadastrada</h3>
              <p className="text-sm text-slate-600">
                Crie uma oportunidade a partir de um edital para começar o pipeline.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex gap-6 h-full min-w-max">
            {grouped.map((column) => (
              <OpportunityColumn
                key={column.id}
                column={column}
                onSelect={setSelectedOportunidadeId}
                onMove={(id, status) => {
                  void updateOpportunity(id, { status });
                }}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog.Root open={selectedOportunidadeId !== null} onOpenChange={(open) => !open && handleCloseDetail()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed right-0 top-0 h-full w-[600px] bg-white shadow-2xl overflow-y-auto">
            {selectedOportunidade && (
              <div>
                <div className="p-6 border-b border-slate-200 sticky top-0 bg-white z-10">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <Dialog.Title className="text-2xl font-semibold mb-2">
                        {selectedOportunidade.nome}
                      </Dialog.Title>
                      <p className="text-slate-600">{selectedOportunidade.edital}</p>
                    </div>
                    <Dialog.Close onClick={handleCloseDetail} className="p-2 hover:bg-slate-100 rounded-lg">
                      <X className="w-5 h-5" />
                    </Dialog.Close>
                  </div>

                  <div className="flex gap-3">
                    <button
                      onClick={handleMoveStatus}
                      disabled={saving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm disabled:opacity-60"
                    >
                      Mover status
                    </button>
                    <button className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm">
                      Gerar proposta
                    </button>
                    <button className="px-4 py-2 border border-slate-300 rounded-lg hover:bg-slate-50 text-sm">
                      Anexar documento
                    </button>
                  </div>
                </div>

                <div className="p-6 space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2 text-slate-600 mb-1">
                        <User className="w-4 h-4" />
                        <span className="text-sm">Artista/Projeto</span>
                      </div>
                      <p className="font-semibold">{selectedOportunidade.artista}</p>
                      {selectedOportunidade.projeto ? <p className="text-sm text-slate-600">{selectedOportunidade.projeto}</p> : null}
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2 text-slate-600 mb-1">
                        <User className="w-4 h-4" />
                        <span className="text-sm">Responsável</span>
                      </div>
                      <p className="font-semibold">{selectedOportunidade.responsavel}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2 text-slate-600 mb-1">
                        <Calendar className="w-4 h-4" />
                        <span className="text-sm">Prazo</span>
                      </div>
                      <p className="font-semibold text-red-600">{selectedOportunidade.prazo} dias</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2 text-slate-600 mb-1">
                        <AlertCircle className="w-4 h-4" />
                        <span className="text-sm">Risco</span>
                      </div>
                      <span className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${riskBadgeClass(selectedOportunidade.risco)}`}>
                        {normalizeLabel(selectedOportunidade.risco)}
                      </span>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2 text-slate-600 mb-1">
                        <FileText className="w-4 h-4" />
                        <span className="text-sm">Fonte original</span>
                      </div>
                      <p className="font-semibold">{selectedOportunidade.fonteOriginal || selectedOportunidade.edital}</p>
                      <p className="text-sm text-slate-600">{selectedOportunidade.fonteDescoberta || "Fonte descoberta não informada"}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2 text-slate-600 mb-1">
                        <Clock className="w-4 h-4" />
                        <span className="text-sm">Checagem</span>
                      </div>
                      <p className="font-semibold">{selectedOportunidade.dataUltimaChecada ? new Date(selectedOportunidade.dataUltimaChecada).toLocaleString("pt-BR") : "Sem data"}</p>
                      <p className="text-sm text-slate-600 capitalize">{selectedOportunidade.nivelConfiabilidade || "alta"}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <div className="flex items-center gap-2 text-slate-600 mb-1">
                        <Calendar className="w-4 h-4" />
                        <span className="text-sm">Território e área</span>
                      </div>
                      <p className="font-semibold">{selectedOportunidade.territorio || "Brasil"}</p>
                      <p className="text-sm text-slate-600">{selectedOportunidade.area || "Área não informada"} • {selectedOportunidade.tipo || "edital"}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-600 mb-1">Valor total</p>
                      <p className="font-semibold">{selectedOportunidade.valorTotal ? `R$ ${selectedOportunidade.valorTotal.toLocaleString("pt-BR")}` : "Não informado"}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-600 mb-1">Valor por projeto</p>
                      <p className="font-semibold">{selectedOportunidade.valorPorProjeto ? `R$ ${selectedOportunidade.valorPorProjeto.toLocaleString("pt-BR")}` : "Não informado"}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-600 mb-1">Público-alvo</p>
                      <p className="font-semibold">{selectedOportunidade.publicoAlvo || "Não informado"}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-600 mb-1">Link do edital</p>
                      <p className="text-sm break-all text-blue-700">{selectedOportunidade.linkEdital || "Não informado"}</p>
                    </div>
                    <div className="p-4 bg-slate-50 rounded-lg">
                      <p className="text-sm text-slate-600 mb-1">Link do formulário</p>
                      <p className="text-sm break-all text-blue-700">{selectedOportunidade.linkFormulario || "Não informado"}</p>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-2">Progresso geral</h3>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-slate-200 rounded-full h-3">
                        <div
                          className="bg-blue-600 h-3 rounded-full transition-all"
                          style={{ width: `${selectedOportunidade.progresso}%` }}
                        />
                      </div>
                      <span className="font-bold text-lg">{selectedOportunidade.progresso}%</span>
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3">Checklist de tarefas</h3>
                    <div className="space-y-2">
                      {(selectedOportunidade.checklist.length > 0 ? selectedOportunidade.checklist : []).map((item, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                          <input
                            type="checkbox"
                            checked={item.concluido}
                            className="w-4 h-4 rounded border-slate-300"
                            readOnly
                          />
                          <div className="flex-1">
                            <p className={`font-medium ${item.concluido ? "line-through text-slate-500" : ""}`}>
                              {item.tarefa}
                            </p>
                            <p className="text-xs text-slate-600">
                              {item.responsavel} • {item.prazo}
                            </p>
                          </div>
                          {item.concluido ? (
                            <CheckCircle2 className="w-5 h-5 text-green-600" />
                          ) : (
                            <Clock className="w-5 h-5 text-yellow-600" />
                          )}
                        </div>
                      ))}
                      {selectedOportunidade.checklist.length === 0 ? (
                        <div className="p-4 bg-slate-50 rounded-lg text-sm text-slate-600">
                          Nenhuma tarefa cadastrada.
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3">Documentos necessários</h3>
                    <div className="space-y-2">
                      {selectedOportunidade.documentosFaltantes.length > 0 ? (
                        selectedOportunidade.documentosFaltantes.map((doc) => (
                          <div key={doc} className="flex items-center justify-between p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                            <div className="flex items-center gap-2">
                              <FileText className="w-4 h-4 text-yellow-600" />
                              <span className="text-sm font-medium">{doc}</span>
                            </div>
                            <button className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">
                              Anexar
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="p-4 bg-green-50 border border-green-200 rounded-lg text-center">
                          <CheckCircle2 className="w-8 h-8 text-green-600 mx-auto mb-2" />
                          <p className="text-sm text-green-700 font-medium">Todos documentos anexados</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="font-semibold mb-3">Comentários internos</h3>
                    <div className="space-y-3">
                      {(selectedOportunidade.comentarios || []).map((commentItem) => (
                        <div key={`${commentItem.autor}-${commentItem.createdAt}`} className="p-3 bg-slate-50 rounded-lg">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-8 h-8 bg-blue-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                              {commentItem.autor.slice(0, 2).toUpperCase()}
                            </div>
                            <div className="flex-1">
                              <p className="font-semibold text-sm">{commentItem.autor}</p>
                              <p className="text-xs text-slate-600">{new Date(commentItem.createdAt).toLocaleString("pt-BR")}</p>
                            </div>
                          </div>
                          <p className="text-sm text-slate-700">{commentItem.texto}</p>
                        </div>
                      ))}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={comment}
                          onChange={(e) => setComment(e.target.value)}
                          placeholder="Adicionar comentário..."
                          className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <button
                          onClick={handleAddComment}
                          disabled={saving}
                          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {!selectedOportunidade && !loadingDetail ? (
              <div className="p-6 text-slate-500">
                Selecione uma oportunidade para ver os detalhes.
              </div>
            ) : null}
            {loadingDetail ? (
              <div className="p-6 text-slate-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Carregando detalhes...
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={createOpen} onOpenChange={setCreateOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[720px] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-xl font-semibold">Nova oportunidade</Dialog.Title>
                <Dialog.Description className="text-sm text-slate-600">
                  Crie uma oportunidade a partir de um edital, artista e projeto.
                </Dialog.Description>
              </div>
              <Dialog.Close className="p-2 rounded-lg hover:bg-slate-100">
                <X className="w-5 h-5" />
              </Dialog.Close>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium">Edital</span>
                  <select
                    value={createForm.editalId}
                    onChange={(e) => setCreateForm((current) => ({ ...current, editalId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {editais.map((edital) => (
                      <option key={edital.id} value={edital.id}>
                        {edital.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Artista</span>
                  <select
                    value={createForm.artistaId}
                    onChange={(e) => setCreateForm((current) => ({ ...current, artistaId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    {artistas.map((artista) => (
                      <option key={artista.id} value={artista.id}>
                        {artista.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Projeto</span>
                  <select
                    value={createForm.projectId}
                    onChange={(e) => setCreateForm((current) => ({ ...current, projectId: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option value="">Sem projeto</option>
                    {projetos.map((projeto) => (
                      <option key={projeto.id} value={projeto.id}>
                        {projeto.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Nome da oportunidade</span>
                  <input
                    value={createForm.nome}
                    onChange={(e) => setCreateForm((current) => ({ ...current, nome: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Turnê Nordeste - Luna Rodrigues"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Responsável</span>
                  <input
                    value={createForm.responsavel}
                    onChange={(e) => setCreateForm((current) => ({ ...current, responsavel: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    placeholder="Ana Silva"
                  />
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
                  <span className="text-sm font-medium">Status</span>
                  <select
                    value={createForm.status}
                    onChange={(e) => setCreateForm((current) => ({ ...current, status: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option>Em fila</option>
                    <option>Em revisão</option>
                    <option>Concluídos</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Risco</span>
                  <select
                    value={createForm.risco}
                    onChange={(e) => setCreateForm((current) => ({ ...current, risco: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  >
                    <option>Médio</option>
                    <option>Baixo</option>
                    <option>Alto</option>
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-2">
                  <span className="text-sm font-medium">Progresso</span>
                  <input
                    value={createForm.progresso}
                    onChange={(e) => setCreateForm((current) => ({ ...current, progresso: e.target.value }))}
                    type="number"
                    min="0"
                    max="100"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium">Pendências</span>
                  <input
                    value={createForm.pendencias}
                    onChange={(e) => setCreateForm((current) => ({ ...current, pendencias: e.target.value }))}
                    type="number"
                    min="0"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <Dialog.Close className="px-4 py-2 rounded-lg border border-slate-300 text-sm hover:bg-slate-50">
                  Cancelar
                </Dialog.Close>
                <button
                  type="button"
                  onClick={handleCreateOpportunity}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700"
                >
                  Criar oportunidade
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {error ? <div className="fixed bottom-4 right-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      </div>
    </DndProvider>
  );
}
