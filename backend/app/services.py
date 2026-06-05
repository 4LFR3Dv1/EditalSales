from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone

from .ingest import normalize, truncate
from .openai_client import enrich_edital_with_openai, generate_edital_chat_bundle
from .store import create_id


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def default_checklist(edital: dict, artista: dict | None = None, projeto: dict | None = None) -> list[dict]:
    return [
        {
            "tarefa": "Atualizar documentos obrigatórios",
            "concluido": False,
            "responsavel": artista["nome"] if artista else "Equipe interna",
            "prazo": "Hoje",
        },
        {
            "tarefa": "Revisar orçamento e cronograma",
            "concluido": False,
            "responsavel": "Equipe interna",
            "prazo": "Em seguida",
        },
        {
            "tarefa": "Validar submissão final",
            "concluido": False,
            "responsavel": "Responsável da oportunidade",
            "prazo": "Antes do prazo",
        },
    ]


def infer_document_requirements(text: str) -> list[str]:
    normalized = normalize(text)
    mapping = [
        ("portfólio", ["portfolio", "portfólio", "portifolio"]),
        ("release", ["release"]),
        ("currículo", ["curriculo", "currículo", "cv"]),
        ("orçamento", ["orcamento", "orçamento"]),
        ("cronograma", ["cronograma"]),
        ("carta de anuência", ["carta de anuencia", "carta de anuência"]),
        ("plano de trabalho", ["plano de trabalho"]),
        ("comprovante de atuação", ["comprovante de atuacao", "comprovante de atuação"]),
        ("RG/CPF ou CNPJ", ["rg", "cpf", "cnpj"]),
    ]
    docs = []
    for label, keywords in mapping:
        if any(keyword in normalized for keyword in keywords):
            docs.append(label)
    return list(dict.fromkeys(docs))


def infer_requisitos(text: str) -> list[str]:
    normalized = normalize(text)
    requisitos = []
    phrases = [
        "pessoa física ou jurídica",
        "comprovação de atuação",
        "portfólio atualizado",
        "documentação regular",
        "prazo de inscrição ativo",
        "proposta alinhada ao objeto do edital",
    ]
    for phrase in phrases:
        if all(token in normalized for token in normalize(phrase).split()):
            requisitos.append(phrase)
    if not requisitos and text:
        requisitos.append("Requisitos extraídos automaticamente a partir do texto disponível.")
    return requisitos


def infer_criterios(edital: dict) -> list[dict]:
    criteria = [
        ("Alinhamento de área", "alto" if edital.get("area") != "Geral" else "médio"),
        ("Documentação obrigatória", "alto"),
        ("Compatibilidade do projeto", "alto"),
        ("Prazo de inscrição", "médio" if int(edital.get("prazo") or 0) > 0 else "alto"),
    ]
    return [{"criterio": criterio, "peso": peso.capitalize()} for criterio, peso in criteria]


def _build_analysis_local(state: dict, edital: dict) -> dict:
    text = " ".join(
        [
            edital.get("resumo") or "",
            edital.get("quemPodeParticipar") or "",
            edital.get("descricaoCompleta") or "",
        ]
    )
    requisitos = infer_requisitos(text)
    documentos = infer_document_requirements(text)
    criterios = infer_criterios(edital)

    suggestions = []
    artist_to_projects = {project["artistaId"]: [] for project in state.get("projetos", [])}
    for project in state.get("projetos", []):
        artist_to_projects.setdefault(project["artistaId"], []).append(project)

    for artist in state.get("artistas", []):
        artist_area_score = 20 if normalize(artist.get("area", "")) == normalize(edital.get("area", "")) else 0
        artist_name_score = 5 if normalize(edital.get("descricaoCompleta", "")) in normalize(artist.get("bio", "")) else 0
        doc_count = sum(1 for doc in state.get("documentos", []) if doc.get("ownerType") == "artist" and doc.get("ownerId") == artist["id"])
        base_score = min(35, artist_area_score + artist_name_score + min(15, doc_count * 5))

        projects = artist_to_projects.get(artist["id"], [])
        if not projects:
            projects = [None]

        for project in projects:
            project_score = 0
            project_name = None
            if project:
                project_name = project["nome"]
                project_score += 15 if normalize(edital.get("area", "")) in normalize(project.get("descricao", "")) else 0
                project_score += min(20, len(project.get("editaisRelacionados", [])) * 4)
                project_score += 10 if normalize(edital.get("descricaoCompleta", "")) in normalize(project.get("descricao", "")) else 0
            score = min(99, base_score + project_score + 35)
            pendencias = max(0, len(documentos) - doc_count)
            suggestions.append(
                {
                    "artistaId": artist["id"],
                    "artista": artist["nome"],
                    "projetoId": project["id"] if project else None,
                    "projeto": project_name,
                    "compatibilidade": score,
                    "motivo": (
                        f"Alinhamento com área {edital.get('area', 'Geral')}"
                        + (f" e projeto {project_name}" if project_name else "")
                    ),
                    "pendencias": pendencias,
                }
            )

    suggestions = sorted(suggestions, key=lambda item: item["compatibilidade"], reverse=True)[:6]

    riscos = []
    if int(edital.get("prazo") or 0) and int(edital.get("prazo") or 0) <= 14:
        riscos.append("Prazo curto")
    if not documentos:
        riscos.append("Documentos não identificados automaticamente")
    if not requisitos:
        riscos.append("Requisitos pouco claros")

    resumo_executivo = truncate(
        (
            f"Este edital financia iniciativas de {edital.get('area', 'Geral').lower()}."
            f" Prazo estimado: {edital.get('prazo', 0)} dias."
            f" Compatibilidade média das sugestões: {sum(item['compatibilidade'] for item in suggestions) // max(1, len(suggestions))}."
        ),
        260,
    )

    return {
        "editalId": edital["id"],
        "resumoExecutivo": resumo_executivo,
        "requisitos": requisitos,
        "criterios": criterios,
        "documentosObrigatorios": documentos,
        "riscos": riscos,
        "sugestoes": suggestions,
        "proximasAcoes": [
            "Validar a extração automática com a equipe responsável.",
            "Relacionar os melhores artistas/projetos sugeridos.",
            "Criar oportunidade no CRM se houver aderência suficiente.",
        ],
        "updatedAt": now_iso(),
    }


def build_analysis(state: dict, edital: dict) -> dict:
    source = next((item for item in state.get("sources", []) if item.get("id") == edital.get("sourceId")), None)
    openai_result = enrich_edital_with_openai(state, edital, source=source, raw_text=edital.get("descricaoCompleta"))
    if openai_result and openai_result.analysis:
        return openai_result.analysis
    return _build_analysis_local(state, edital)


def score_priority(edital: dict, analysis: dict) -> str:
    score = max((item["compatibilidade"] for item in analysis.get("sugestoes", [])), default=0)
    prazo = int(edital.get("prazo") or 0)
    if score >= 80:
        return "Alta"
    if prazo and prazo <= 14:
        return "Alta"
    if score >= 60:
        return "Média"
    return "Baixa"


def apply_analysis_to_edital(edital: dict, analysis: dict) -> dict:
    suggestions = analysis.get("sugestoes") or []
    edital["analysis"] = analysis
    edital["compatibilidade"] = max((item["compatibilidade"] for item in suggestions), default=0)
    edital["matches"] = {
        "artistas": len({item["artistaId"] for item in suggestions}),
        "projetos": len({item["projetoId"] for item in suggestions if item.get("projetoId")}),
    }
    edital["prioridade"] = score_priority(edital, analysis)
    edital["status"] = "Analisado"
    edital["riscos"] = analysis.get("riscos", [])
    edital["proximaAcao"] = analysis.get("proximasAcoes", ["Revisar análise"])[0]
    edital["updatedAt"] = now_iso()
    return edital


def enrich_edital_record(state: dict, edital: dict, source: dict | None = None, raw_text: str | None = None) -> dict:
    base = dict(edital)
    openai_result = enrich_edital_with_openai(state, base, source=source, raw_text=raw_text or base.get("descricaoCompleta"))
    if openai_result:
        enriched = dict(base)
        edital_payload = openai_result.edital
        analysis_payload = openai_result.analysis
        enriched.update(
            {
                "nome": edital_payload.get("nome") or enriched.get("nome"),
                "fonte": edital_payload.get("fonte") or enriched.get("fonte"),
                "fonteUrl": edital_payload.get("fonteUrl") if edital_payload.get("fonteUrl") is not None else enriched.get("fonteUrl"),
                "area": edital_payload.get("area") or enriched.get("area"),
                "prazo": int(edital_payload.get("prazo") or enriched.get("prazo") or 0),
                "valor": int(edital_payload.get("valor") or enriched.get("valor") or 0),
                "status": edital_payload.get("status") or enriched.get("status"),
                "prioridade": edital_payload.get("prioridade") or enriched.get("prioridade"),
                "resumo": edital_payload.get("resumo") or enriched.get("resumo"),
                "quemPodeParticipar": edital_payload.get("quemPodeParticipar") or enriched.get("quemPodeParticipar"),
                "descricaoCompleta": edital_payload.get("descricaoCompleta") or enriched.get("descricaoCompleta"),
                "tags": list(edital_payload.get("tags") or enriched.get("tags") or []),
                "riscos": list(edital_payload.get("riscos") or analysis_payload.get("riscos") or enriched.get("riscos") or []),
                "proximaAcao": edital_payload.get("proximaAcao") or (analysis_payload.get("proximasAcoes") or [enriched.get("proximaAcao") or "Revisar manualmente."])[0],
                "analysis": analysis_payload,
                "compatibilidade": max((int(item.get("compatibilidade") or 0) for item in analysis_payload.get("sugestoes", [])), default=0),
                "matches": {
                    "artistas": len({item.get("artistaId") for item in analysis_payload.get("sugestoes", []) if item.get("artistaId")}),
                    "projetos": len({item.get("projetoId") for item in analysis_payload.get("sugestoes", []) if item.get("projetoId")}),
                },
                "updatedAt": now_iso(),
            }
        )
        return enriched

    fallback = apply_analysis_to_edital(base, _build_analysis_local(state, base))
    return fallback


def build_default_opportunity(edital: dict, artista: dict, projeto: dict | None, payload: dict) -> dict:
    now = now_iso()
    return {
        "id": create_id("opp"),
        "nome": payload.get("nome") or f"{edital['nome']} - {artista['nome']}",
        "editalId": edital["id"],
        "edital": edital["nome"],
        "artistaId": artista["id"],
        "artista": artista["nome"],
        "projectId": projeto["id"] if projeto else None,
        "projeto": projeto["nome"] if projeto else None,
        "prazo": int(payload.get("prazo") or edital.get("prazo") or 0),
        "responsavel": payload.get("responsavel") or "Nao atribuido",
        "status": payload.get("status") or "Em fila",
        "progresso": int(payload.get("progresso") or 0),
        "pendencias": int(payload.get("pendencias") or 0),
        "risco": payload.get("risco") or "Médio",
        "tipo": payload.get("tipo") or "edital",
        "area": payload.get("area") or edital.get("area") or "Geral",
        "publicoAlvo": payload.get("publicoAlvo") or "artista",
        "territorio": payload.get("territorio") or "Brasil",
        "valorTotal": int(payload.get("valorTotal") or edital.get("valor") or 0),
        "valorPorProjeto": int(payload.get("valorPorProjeto") or 0),
        "prazoInicio": payload.get("prazoInicio") or None,
        "prazoFinal": payload.get("prazoFinal") or None,
        "linkEdital": payload.get("linkEdital") or edital.get("fonteUrl"),
        "linkFormulario": payload.get("linkFormulario") or None,
        "linkAnexos": payload.get("linkAnexos") or None,
        "fonteOriginal": payload.get("fonteOriginal") or edital.get("fonte"),
        "fonteDescoberta": payload.get("fonteDescoberta") or edital.get("fonte"),
        "nivelConfiabilidade": payload.get("nivelConfiabilidade") or "alta",
        "dataUltimaChecada": payload.get("dataUltimaChecada") or now,
        "documentosFaltantes": list(payload.get("documentosFaltantes") or []),
        "checklist": list(payload.get("checklist") or default_checklist(edital, artista, projeto)),
        "comentarios": [],
        "protocolo": payload.get("protocolo"),
        "resultado": payload.get("resultado"),
        "createdAt": now,
        "updatedAt": now,
    }


def build_auto_opportunity(edital: dict, analysis: dict | None = None) -> dict:
    analysis = analysis or edital.get("analysis") or {}
    docs = list(analysis.get("documentosObrigatorios") or [])
    risks = list(analysis.get("riscos") or edital.get("riscos") or [])
    placeholder_artist = {
        "id": "auto_pipeline",
        "nome": "Leitura automática",
    }
    payload = {
        "nome": edital.get("nome"),
        "tipo": "edital",
        "area": edital.get("area") or "Geral",
        "publicoAlvo": "artista/projeto",
        "territorio": "Brasil",
        "valorTotal": int(edital.get("valor") or 0),
        "valorPorProjeto": 0,
        "prazoInicio": None,
        "prazoFinal": None,
        "linkEdital": edital.get("fonteUrl"),
        "linkFormulario": None,
        "linkAnexos": None,
        "fonteOriginal": edital.get("fonte"),
        "fonteDescoberta": edital.get("sourceName") or edital.get("fonte"),
        "nivelConfiabilidade": "alta",
        "dataUltimaChecada": now_iso(),
        "responsavel": "Pipeline automático",
        "status": "Em fila",
        "progresso": 0,
        "pendencias": max(1, len(docs) or len(risks) or 1),
        "risco": "Médio" if len(risks) < 2 else "Alto",
        "documentosFaltantes": docs or ["Documentos não identificados automaticamente"],
        "checklist": default_checklist(edital, placeholder_artist, None),
        "protocolo": None,
        "resultado": None,
    }
    opportunity = build_default_opportunity(edital, placeholder_artist, None, payload)
    opportunity["autoGenerated"] = True
    opportunity["origem"] = "edital"
    opportunity["tituloOrigem"] = edital.get("nome")
    opportunity["documentosFaltantes"] = payload["documentosFaltantes"]
    opportunity["checklist"] = payload["checklist"]
    return opportunity


def build_match_records(edital: dict, opportunity: dict, analysis: dict | None = None) -> list[dict]:
    analysis = analysis or edital.get("analysis") or {}
    matches = []
    required_documents = list(analysis.get("documentosObrigatorios") or [])
    for suggestion in analysis.get("sugestoes", [])[:6]:
        matches.append(
            {
                "id": create_id("match"),
                "oportunidadeId": opportunity["id"],
                "editalId": edital["id"],
                "projetoId": suggestion.get("projetoId"),
                "artistaId": suggestion.get("artistaId"),
                "notaMatch": int(suggestion.get("compatibilidade") or 0),
                "motivoMatch": suggestion.get("motivo") or "",
                "riscos": list(analysis.get("riscos") or []),
                "documentosFaltantes": required_documents if required_documents else ["Documentos não identificados automaticamente"],
                "prazoDeAcao": "urgente" if int(edital.get("prazo") or 0) <= 14 else "normal",
                "recomendacao": "inscrever" if int(suggestion.get("compatibilidade") or 0) >= 70 else "avaliar",
                "createdAt": now_iso(),
                "updatedAt": now_iso(),
            }
        )
    return matches


def _local_chat_bundle(scope: str, context: dict, question: str) -> dict:
    q = normalize(question)
    if scope == "edital":
        if "document" in q:
            docs = context.get("analysis", {}).get("documentosObrigatorios") or []
            reply = (
                "Documentos obrigatórios identificados: " + ", ".join(docs) + "."
                if docs
                else "Não identifiquei documentos obrigatórios no texto disponível."
            )
            return {
                "reply": reply,
                "sections": [
                    {
                        "title": "Resumo editorial",
                        "bullets": [
                            reply,
                        ],
                    },
                    {
                        "title": "Pontos que exigem validação",
                        "bullets": [
                            "Verificar a lista de documentos no texto oficial.",
                            "Confirmar regras de elegibilidade antes da submissão.",
                        ],
                    },
                ],
                "actions": [
                    {
                        "label": "Gerar checklist",
                        "prompt": "Crie uma checklist de submissão",
                        "kind": "checklist",
                    }
                ],
                "highlights": docs[:3],
                "confidence": 42 if docs else 18,
            }
        if "pessoa fisica" in q or "pessoa física" in q:
            text = " ".join(
                [
                    context.get("quemPodeParticipar", ""),
                    context.get("descricaoCompleta", ""),
                ]
            )
            reply = (
                "Parece haver menção a pessoa física, mas isso precisa de validação manual no texto oficial."
                if "pessoa fisica" in normalize(text)
                else "Não encontrei confirmação de pessoa física no texto disponível."
            )
            return {
                "reply": reply,
                "sections": [
                    {
                        "title": "Resumo editorial",
                        "bullets": [reply],
                    },
                    {
                        "title": "Pontos que exigem validação",
                        "bullets": ["Checar elegibilidade no edital oficial."],
                    },
                ],
                "actions": [
                    {
                        "label": "Rever elegibilidade",
                        "prompt": "Quais requisitos de elegibilidade devo validar?",
                        "kind": "analysis",
                    }
                ],
                "highlights": ["Validação manual necessária"],
                "confidence": 34,
            }
        if "risco" in q:
            risks = context.get("analysis", {}).get("riscos") or context.get("riscos") or []
            reply = "Riscos identificados: " + ", ".join(risks) + "." if risks else "Não identifiquei riscos relevantes na extração atual."
            return {
                "reply": reply,
                "sections": [
                    {
                        "title": "Resumo editorial",
                        "bullets": [reply],
                    },
                    {
                        "title": "Pontos práticos",
                        "bullets": risks[:3] or ["Validar se há impedimentos formais."],
                    },
                ],
                "actions": [
                    {
                        "label": "Listar riscos",
                        "prompt": "Quais riscos de desclassificação?",
                        "kind": "risk",
                    }
                ],
                "highlights": risks[:3],
                "confidence": 38 if risks else 16,
            }
        if "checklist" in q:
            return {
                "reply": "Checklist recomendada: revisar requisitos, documentos obrigatórios, prazos e compatibilidade das sugestões.",
                "sections": [
                    {
                        "title": "Resumo editorial",
                        "bullets": [
                            "Checklist recomendada para submissão.",
                        ],
                    },
                    {
                        "title": "Etapas sugeridas",
                        "bullets": [
                            "Revisar requisitos, documentos obrigatórios e prazo.",
                            "Validar compatibilidade e responsáveis internos.",
                        ],
                    },
                ],
                "actions": [
                    {
                        "label": "Criar oportunidade",
                        "prompt": "Crie uma oportunidade para este edital",
                        "kind": "opportunity",
                    }
                ],
                "highlights": ["Requisitos", "Documentos", "Prazos"],
                "confidence": 52,
            }
        if "compar" in q:
            return {
                "reply": "Posso comparar pelo texto extraído, área, prazo, valor e documentação exigida.",
                "sections": [
                    {
                        "title": "Resumo editorial",
                        "bullets": ["Posso comparar pelo texto extraído e critérios objetivos."],
                    },
                    {
                        "title": "Comparação sugerida",
                        "bullets": ["Área", "Prazo", "Valor", "Documentação exigida"],
                    },
                ],
                "actions": [
                    {
                        "label": "Sugerir artistas",
                        "prompt": "Quais artistas combinam melhor?",
                        "kind": "analysis",
                    }
                ],
                "highlights": ["Área", "Prazo", "Valor"],
                "confidence": 44,
            }
        return {
            "reply": "Consulta registrada. Posso ajudar com requisitos, documentos, riscos, sugestões de artistas e próxima ação.",
            "sections": [
                {
                    "title": "Resumo editorial",
                    "bullets": [
                        "Consulta registrada.",
                    ],
                },
                {
                    "title": "O que posso fazer",
                    "bullets": [
                        "Analisar requisitos e documentos.",
                        "Sugerir artistas e próximas ações.",
                    ],
                },
            ],
            "actions": [
                {
                    "label": "Resumir edital",
                    "prompt": "Resuma esse edital",
                    "kind": "analysis",
                }
            ],
            "highlights": [],
            "confidence": 30,
        }

    if scope == "oportunidade":
        if "pendencia" in q:
            return {
                "reply": "Revise checklist, documentos faltantes e confirme o responsável por cada tarefa.",
                "sections": [
                    {
                        "title": "Resumo editorial",
                        "bullets": ["A oportunidade tem pendências a revisar."],
                    },
                    {
                        "title": "Próximos passos",
                        "bullets": [
                            "Revisar checklist.",
                            "Confirmar documentos faltantes.",
                        ],
                    },
                ],
                "actions": [
                    {
                        "label": "Gerar checklist",
                        "prompt": "Crie uma checklist de submissão",
                        "kind": "checklist",
                    }
                ],
                "highlights": ["Checklist", "Documentos faltantes"],
                "confidence": 55,
            }
        if "proposta" in q:
            return {
                "reply": "A proposta deve seguir o edital, o histórico do artista e o plano de entrega da oportunidade.",
                "sections": [
                    {
                        "title": "Resumo editorial",
                        "bullets": ["A proposta precisa estar alinhada ao edital e ao histórico do artista."],
                    },
                    {
                        "title": "Pontos de atenção",
                        "bullets": [
                            "Evidências do artista.",
                            "Plano de entrega.",
                            "Coerência com o edital.",
                        ],
                    },
                ],
                "actions": [
                    {
                        "label": "Revisar risco",
                        "prompt": "Quais riscos de desclassificação?",
                        "kind": "risk",
                    }
                ],
                "highlights": ["Edital", "Histórico do artista", "Plano de entrega"],
                "confidence": 50,
            }
        if "status" in q:
            return {
                "reply": "Use o status para refletir a etapa do pipeline e registre o próximo passo.",
                "sections": [
                    {
                        "title": "Resumo editorial",
                        "bullets": ["O status deve refletir a etapa atual da oportunidade."],
                    },
                    {
                        "title": "Ação imediata",
                        "bullets": ["Registrar o próximo passo e o responsável."],
                    },
                ],
                "actions": [],
                "highlights": ["Pipeline"],
                "confidence": 40,
            }
        return {
            "reply": "Posso ajudar a resumir a oportunidade, identificar pendências e sugerir próximos passos.",
            "sections": [
                {
                    "title": "Resumo editorial",
                    "bullets": ["Posso resumir a oportunidade e mapear pendências."],
                },
                {
                    "title": "Próximos passos",
                    "bullets": ["Identificar responsáveis e atualizar o pipeline."],
                },
            ],
            "actions": [],
            "highlights": [],
            "confidence": 30,
        }

    return {
        "reply": "Contexto insuficiente para responder.",
        "sections": [
            {
                "title": "Resumo editorial",
                "bullets": ["Contexto insuficiente para uma resposta útil."],
            }
        ],
        "actions": [],
        "highlights": [],
        "confidence": 0,
    }


def generate_chat_bundle(scope: str, context: dict, question: str, state: dict | None = None) -> dict:
    openai_bundle = generate_edital_chat_bundle(scope, context, question, state=state)
    if openai_bundle:
        return openai_bundle

    return _local_chat_bundle(scope, context, question)


def generate_chat_reply(scope: str, context: dict, question: str, state: dict | None = None) -> str:
    return generate_chat_bundle(scope, context, question, state=state)["reply"]


def ensure_auto_opportunities(state: dict) -> bool:
    existing = {item.get("editalId") for item in state.get("oportunidades", []) if item.get("autoGenerated")}
    changed = False
    for edital in reversed(state.get("editais", [])):
        if edital.get("id") in existing:
            continue
        opportunity = build_auto_opportunity(edital, edital.get("analysis"))
        state["oportunidades"].insert(0, opportunity)
        state.setdefault("matches", []).extend(build_match_records(edital, opportunity, edital.get("analysis")))
        state["auditLog"].insert(
            0,
            {
                "id": create_id("audit"),
                "type": "oportunidade.auto_created",
                "entityId": edital["id"],
                "createdAt": now_iso(),
            },
        )
        existing.add(edital.get("id"))
        changed = True
    return changed


def ensure_matches(state: dict) -> bool:
    existing_ids = {item.get("editalId") for item in state.get("matches", []) if item.get("editalId")}
    opportunity_by_edital = {item.get("editalId"): item for item in state.get("oportunidades", []) if item.get("editalId")}
    changed = False

    for edital in state.get("editais", []):
        edital_id = edital.get("id")
        if not edital_id or edital_id in existing_ids:
            continue
        opportunity = opportunity_by_edital.get(edital_id)
        if not opportunity:
            continue
        state.setdefault("matches", []).extend(build_match_records(edital, opportunity, edital.get("analysis")))
        existing_ids.add(edital_id)
        changed = True

    return changed


def summarize_state(state: dict) -> dict:
    def count_by_status(items: list[dict], field: str = "status") -> dict:
        counter = Counter(normalize(item.get(field, "")) for item in items)
        return dict(counter)

    return {
        "editais": len(state.get("editais", [])),
        "artistas": len(state.get("artistas", [])),
        "projetos": len(state.get("projetos", [])),
        "documentos": len(state.get("documentos", [])),
        "oportunidades": len(state.get("oportunidades", [])),
        "matches": len(state.get("matches", [])),
        "sources": len(state.get("sources", [])),
        "ingestions": len(state.get("ingestions", [])),
        "byStatus": {
            "editais": count_by_status(state.get("editais", [])),
            "oportunidades": count_by_status(state.get("oportunidades", [])),
            "documentos": count_by_status(state.get("documentos", [])),
            "ingestions": count_by_status(state.get("ingestions", [])),
        },
    }
