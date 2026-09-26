/**
 * ============================================================================
 * FINMOBILE - LÓGICA DO CLIENTE MOBILE (JAVASCRIPT)
 * ============================================================================
 * Integração assíncrona anti-CORS com Google Apps Script, validações móveis,
 * máscaras de moeda BRL, motor reativo de parcelamento e filtros de previsão.
 * ============================================================================
 */

// ============================================================================
// 1. BANCO DE DADOS EM MEMÓRIA (MODO DE TESTE / VOLÁTIL)
// ============================================================================
// Todos os dados ficam salvos exclusivamente na memória volátil da sessão.
// Ao atualizar a página (F5 ou recarregar), os lançamentos são perdidos e a
// aplicação retorna ao estado limpo inicial contendo apenas as categorias padrão.
// ============================================================================
const inMemoryDB = {
  registros: [],
  gastosFixos: [],
  categorias: [
    // Categorias Pessoal - Despesa
    { escopo: "Pessoal", tipoTransacao: "Despesa", nome: "Alimentação" },
    { escopo: "Pessoal", tipoTransacao: "Despesa", nome: "Moradia" },
    { escopo: "Pessoal", tipoTransacao: "Despesa", nome: "Transporte" },
    { escopo: "Pessoal", tipoTransacao: "Despesa", nome: "Saúde" },
    { escopo: "Pessoal", tipoTransacao: "Despesa", nome: "Educação" },
    { escopo: "Pessoal", tipoTransacao: "Despesa", nome: "Lazer" },
    { escopo: "Pessoal", tipoTransacao: "Despesa", nome: "Outros" },
    // Categorias Pessoal - Receita
    { escopo: "Pessoal", tipoTransacao: "Receita", nome: "Salário" },
    { escopo: "Pessoal", tipoTransacao: "Receita", nome: "Rendimentos" },
    { escopo: "Pessoal", tipoTransacao: "Receita", nome: "Outras Receitas" },
    // Categorias Empresarial - Despesa
    { escopo: "Empresarial", tipoTransacao: "Despesa", nome: "Fornecedores" },
    { escopo: "Empresarial", tipoTransacao: "Despesa", nome: "Operacional" },
    { escopo: "Empresarial", tipoTransacao: "Despesa", nome: "Marketing" },
    { escopo: "Empresarial", tipoTransacao: "Despesa", nome: "Impostos" },
    { escopo: "Empresarial", tipoTransacao: "Despesa", nome: "Folha de Pagamento" },
    { escopo: "Empresarial", tipoTransacao: "Despesa", nome: "Outros" },
    // Categorias Empresarial - Receita
    { escopo: "Empresarial", tipoTransacao: "Receita", nome: "Vendas" },
    { escopo: "Empresarial", tipoTransacao: "Receita", nome: "Prestação de Serviços" },
    { escopo: "Empresarial", tipoTransacao: "Receita", nome: "Outras Entradas" }
  ]
};

// 2. ESTADO DA APLICAÇÃO
const state = {
  activeView: "view-lancamento",
  categories: [],
  currentForecastFilter: "Geral",
  forecastMonths: [], // Matriz de 6 competências (mês atual + 5 meses seguintes)
  selectedForecastIndex: 1, // Padrão: 1 (Próximo Mês)
  isSyncing: false,
  parcelasCalcMode: "parcela" // "parcela" ou "total"
};

// ============================================================================
// SIMULADOR DE BACKEND EM MEMÓRIA (SEM BANCO DE DADOS EXTERNO)
// ============================================================================
async function callBackend(action, payload = {}) {
  setSyncStatus("syncing", "Processando...");

  // Delay mínimo assíncrono para garantir animações suaves da interface
  await new Promise((resolve) => setTimeout(resolve, 60));

  try {
    let result = null;

    switch (action) {
      case "obterCategorias": {
        result = {
          success: true,
          data: inMemoryDB.categorias.map((c) => ({ ...c }))
        };
        break;
      }

      case "cadastrarCategoria": {
        const escopo = (payload.escopo || "Pessoal").trim();
        const tipoTransacao = (payload.tipoTransacao || "Despesa").trim();
        const categoriaNome = (payload.categoriaNome || "").trim();

        if (!categoriaNome) {
          throw new Error("Nome da categoria não pode ser vazio.");
        }

        const existe = inMemoryDB.categorias.some(
          (c) =>
            c.escopo.toLowerCase() === escopo.toLowerCase() &&
            c.tipoTransacao.toLowerCase() === tipoTransacao.toLowerCase() &&
            c.nome.toLowerCase() === categoriaNome.toLowerCase()
        );

        if (existe) {
          result = {
            success: true,
            data: {
              jaExistia: true,
              mensagem: "Categoria já existe para este escopo e tipo.",
              categoria: categoriaNome
            }
          };
        } else {
          inMemoryDB.categorias.push({
            escopo,
            tipoTransacao,
            nome: categoriaNome
          });
          result = {
            success: true,
            data: {
              sucesso: true,
              jaExistia: false,
              mensagem: "Categoria cadastrada com sucesso.",
              categoria: categoriaNome,
              escopo,
              tipoTransacao
            }
          };
        }
        break;
      }

      case "salvarRegistro": {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const timestamp = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const dataHoraCurta = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        const escopo = payload.escopo || "Pessoal";
        const subOrigem = escopo === "Empresarial" ? (payload.subOrigem || "") : "";
        const tipoTransacao = payload.tipoTransacao || "Despesa";
        const categoria = payload.categoria || "Geral";
        const descricaoBase = (payload.descricao || "").trim();
        const valorUnitario = parseFloat(payload.valor);

        if (isNaN(valorUnitario) || valorUnitario <= 0) {
          throw new Error("Valor inválido.");
        }

        const isParcelado =
          payload.parcelado === true ||
          String(payload.parcelado).toLowerCase() === "true" ||
          payload.parcelado === 1 ||
          String(payload.parcelado) === "1";
        const totalParcelas = isParcelado ? parseInt(payload.totalParcelas, 10) : 1;

        if (isParcelado && (isNaN(totalParcelas) || totalParcelas < 2)) {
          throw new Error("Número de parcelas deve ser maior ou igual a 2.");
        }

        // Determina data base da competência
        let baseDate = new Date();
        if (payload.dataCompetencia) {
          if (typeof payload.dataCompetencia === "string" && /^\d{4}-\d{2}-\d{2}/.test(payload.dataCompetencia)) {
            const parts = payload.dataCompetencia.split("T")[0].split("-");
            baseDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          } else if (typeof payload.dataCompetencia === "string" && /^\d{2}\/\d{2}\/\d{4}/.test(payload.dataCompetencia)) {
            const parts = payload.dataCompetencia.split("/");
            baseDate = new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
          }
        }

        const idAgrupamento = isParcelado
          ? "PARC-" + Math.random().toString(36).substring(2, 10).toUpperCase() + "-" + Date.now()
          : "";

        const baseDay = baseDate.getDate();
        const baseMonth = baseDate.getMonth();
        const baseYear = baseDate.getFullYear();

        for (let i = 1; i <= totalParcelas; i++) {
          const offsetMonths = i - 1;
          const targetMonthIndex = baseMonth + offsetMonths;
          const targetYear = baseYear + Math.floor(targetMonthIndex / 12);
          const targetMonth = targetMonthIndex % 12;

          const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
          const finalDay = Math.min(baseDay, daysInTargetMonth);
          const compFormatted = `${pad(finalDay)}/${pad(targetMonth + 1)}/${targetYear}`;

          const descricaoFinal = isParcelado
            ? (descricaoBase ? `${descricaoBase} (${i}/${totalParcelas})` : `Parcela ${i}/${totalParcelas}`)
            : descricaoBase;

          inMemoryDB.registros.push({
            dataHora: timestamp,
            dataHoraFormatada: dataHoraCurta,
            competencia: compFormatted,
            escopo,
            subOrigem,
            tipoTransacao,
            categoria,
            descricao: descricaoFinal,
            valor: valorUnitario,
            parcelaAtual: i,
            totalParcelas,
            idAgrupamento,
            timestampMs: Date.now() + i
          });
        }

        result = {
          success: true,
          data: {
            linhasInseridas: totalParcelas,
            idAgrupamento,
            totalParcelas,
            valorPorParcela: valorUnitario,
            valorTotal: valorUnitario * totalParcelas
          }
        };
        break;
      }

      case "obterRegistros": {
        // Ordena do mais recente para o mais antigo
        const ordenados = [...inMemoryDB.registros].sort((a, b) => {
          return (b.timestampMs || 0) - (a.timestampMs || 0);
        });

        const lista = ordenados.map((item) => ({
          dataHora: item.dataHoraFormatada || item.dataHora,
          escopo: item.escopo,
          tipo: item.tipoTransacao,
          categoria: item.categoria,
          valor: item.valor
        }));

        result = {
          success: true,
          data: lista
        };
        break;
      }

      case "obterPrevisaoMesSeguinte": {
        const filtro = (payload && payload.filtro ? payload.filtro : "Geral").trim();

        const hoje = new Date();
        const mesAtual = hoje.getMonth();
        const anoAtual = hoje.getFullYear();

        const periodos = [];
        const mesesAbrev = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        const nomesMeses = [
          "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
          "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
        ];

        for (let offset = 0; offset < 6; offset++) {
          const rawMes = mesAtual + offset;
          const mesIndex = rawMes % 12;
          const ano = anoAtual + Math.floor(rawMes / 12);
          const mesNumero = mesIndex + 1;
          const mesRef = `${String(mesNumero).padStart(2, "0")}/${ano}`;

          periodos.push({
            offset,
            mesIndex,
            mesNumero,
            ano,
            mesReferencia: mesRef,
            mesNome: `${nomesMeses[mesIndex]} de ${ano}`,
            labelCurto: `${mesesAbrev[mesIndex]}/${String(ano).slice(-2)}`,
            isAtual: offset === 0,
            isProximo: offset === 1,
            totalParcelasMes: 0,
            qtdParcelasMes: 0,
            totalFixosMes: 0,
            qtdFixosMes: 0,
            totalGastoPrevisto: 0
          });
        }

        // Processa despesas registradas
        for (const reg of inMemoryDB.registros) {
          if (String(reg.tipoTransacao || "").toLowerCase() !== "despesa") continue;
          if (!aplicarFiltroEscopoLocal(filtro, reg.escopo, reg.subOrigem)) continue;

          let compMes = null;
          let compAno = null;
          const compRaw = reg.competencia;

          if (typeof compRaw === "string") {
            if (/^\d{2}\/\d{2}\/\d{4}/.test(compRaw)) {
              const parts = compRaw.split("/");
              compMes = parseInt(parts[1], 10);
              compAno = parseInt(parts[2], 10);
            } else if (/^\d{4}-\d{2}-\d{2}/.test(compRaw)) {
              const parts = compRaw.split("T")[0].split("-");
              compMes = parseInt(parts[1], 10);
              compAno = parseInt(parts[0], 10);
            }
          }

          if (compMes && compAno) {
            for (let p = 0; p < periodos.length; p++) {
              if (compMes === periodos[p].mesNumero && compAno === periodos[p].ano) {
                periodos[p].totalParcelasMes += reg.valor;
                periodos[p].qtdParcelasMes++;
                break;
              }
            }
          }
        }

        // Consolida totais
        for (let p = 0; p < periodos.length; p++) {
          periodos[p].totalFixosMes = 0;
          periodos[p].qtdFixosMes = 0;
          periodos[p].totalParcelasMes = Math.round(periodos[p].totalParcelasMes * 100) / 100;
          periodos[p].totalGastoPrevisto = periodos[p].totalParcelasMes;
        }

        let periodoSelecionado = periodos[1]; // Próximo mês por padrão
        if (payload && payload.offset !== undefined && payload.offset !== null && payload.offset !== "") {
          const off = parseInt(payload.offset, 10);
          if (!isNaN(off) && off >= 0 && off < periodos.length) {
            periodoSelecionado = periodos[off];
          }
        } else if (payload && payload.mes && payload.ano) {
          const targetMes = parseInt(payload.mes, 10);
          const targetAno = parseInt(payload.ano, 10);
          const match = periodos.find((p) => p.mesNumero === targetMes && p.ano === targetAno);
          if (match) periodoSelecionado = match;
        }

        result = {
          success: true,
          data: {
            filtro,
            mesReferencia: periodoSelecionado.mesReferencia,
            mesNome: periodoSelecionado.mesNome,
            totalGastoPrevisto: periodoSelecionado.totalGastoPrevisto,
            totalParcelasMes: periodoSelecionado.totalParcelasMes,
            totalFixosMes: periodoSelecionado.totalFixosMes,
            qtdParcelasMes: periodoSelecionado.qtdParcelasMes,
            qtdFixosMes: periodoSelecionado.qtdFixosMes,
            offsetSelecionado: periodoSelecionado.offset,
            projecaoMeses: periodos
          }
        };
        break;
      }

      case "status": {
        result = { success: true, data: { status: "online", mode: "test-in-memory" } };
        break;
      }

      default:
        throw new Error(`Ação '${action}' não reconhecida pelo mock em memória.`);
    }

    setSyncStatus("online", "Modo Teste");
    return result;
  } catch (error) {
    setSyncStatus("error", "Erro Local");
    console.error(`[Mock DB Error] Falha na ação '${action}':`, error);
    throw error;
  }
}

function aplicarFiltroEscopoLocal(filtro, escopo = "", subOrigem = "") {
  if (!filtro || filtro === "Geral" || filtro === "Todos") return true;
  if (filtro === "Pessoal") return escopo.toLowerCase() === "pessoal";
  if (filtro === "Empresarial MT" || filtro === "MT") {
    return escopo.toLowerCase() === "empresarial" && subOrigem.indexOf("MT") !== -1;
  }
  if (filtro === "Empresarial MS" || filtro === "MS") {
    return escopo.toLowerCase() === "empresarial" && subOrigem.indexOf("MS") !== -1;
  }
  return true;
}

function setSyncStatus(status, label) {
  const dot = document.getElementById("status-dot");
  const text = document.getElementById("status-label");
  if (!dot || !text) return;

  dot.className = `status-dot ${status}`;
  text.textContent = label;
}

// ============================================================================
// UTILITÁRIOS: FORMATAÇÃO BRL E DATAS
// ============================================================================
function formatCurrencyBRL(value) {
  const num = typeof value === "number" ? value : parseFloat(value) || 0;
  return num.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function parseCurrencyInput(valueStr) {
  if (!valueStr) return 0;
  // Remove pontos de milhar e converte vírgula decimal para ponto
  const clean = valueStr.toString().replace(/\D/g, "");
  const num = (parseInt(clean, 10) || 0) / 100;
  return num;
}

function setupMoneyMask(inputElement, onChangeCallback) {
  if (!inputElement) return;

  inputElement.addEventListener("input", (e) => {
    let raw = e.target.value.replace(/\D/g, "");
    if (!raw) {
      e.target.value = "0,00";
    } else {
      let num = parseInt(raw, 10) / 100;
      e.target.value = formatCurrencyBRL(num);
    }
    if (typeof onChangeCallback === "function") {
      onChangeCallback(parseCurrencyInput(e.target.value));
    }
  });

  inputElement.addEventListener("focus", (e) => {
    if (e.target.value === "0,00") {
      e.target.select();
    }
  });
}

function getTodayISODate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// ============================================================================
// SISTEMA DE TOAST (NOTIFICAÇÕES FLUTUANTES)
// ============================================================================
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-message">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 4000);
}

// ============================================================================
// NAVEGAÇÃO ENTRE TELAS (BOTTOM NAVIGATION)
// ============================================================================
function initNavigation() {
  const navItems = document.querySelectorAll(".bottom-nav .nav-item");
  const views = document.querySelectorAll(".view");

  navItems.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-target");
      switchView(targetId);
    });
  });

  // Link rápido para criar categoria a partir do lançamento
  const quickNewCatBtn = document.getElementById("btn-quick-new-category");
  if (quickNewCatBtn) {
    quickNewCatBtn.addEventListener("click", () => {
      switchView("view-categorias");
      const catInput = document.getElementById("cat-nome");
      if (catInput) {
        setTimeout(() => catInput.focus(), 300);
      }
    });
  }
}

function switchView(targetId) {
  state.activeView = targetId;

  // Atualiza botões da barra
  document.querySelectorAll(".bottom-nav .nav-item").forEach((item) => {
    if (item.getAttribute("data-target") === targetId) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });

  // Alterna as telas
  document.querySelectorAll(".view").forEach((view) => {
    if (view.id === targetId) {
      view.classList.add("active");
    } else {
      view.classList.remove("active");
    }
  });

  // Ações contextuais ao entrar na tela
  if (targetId === "view-previsao") {
    carregarPrevisao(state.currentForecastFilter);
  }
  if (targetId === "view-categorias") {
    renderCategoryBadges();
  }
  if (targetId === "view-historico") {
    carregarHistorico();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ============================================================================
// GESTÃO DE SEGMENTED CONTROLS & CAMPOS CONDICIONAIS
// ============================================================================
function setupSegmentedControl(containerId, hiddenInputId, onChangeCallback) {
  const container = document.getElementById(containerId);
  const hiddenInput = document.getElementById(hiddenInputId);
  if (!container || !hiddenInput) return;

  const buttons = container.querySelectorAll(".segment-btn");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const val = btn.getAttribute("data-value");
      hiddenInput.value = val;

      if (typeof onChangeCallback === "function") {
        onChangeCallback(val);
      }
    });
  });
}

function initConditionalFields() {
  // 1. Escopo no Novo Lançamento
  setupSegmentedControl("escopo-lancamento", "lancamento-escopo", (escopo) => {
    const boxSub = document.getElementById("box-suborigem-lancamento");
    if (escopo === "Empresarial") {
      boxSub.classList.add("visible");
    } else {
      boxSub.classList.remove("visible");
    }
    atualizarSelectsCategorias();
  });

  // 2. Sub-origem MT/MS no Lançamento
  setupSegmentedControl("suborigem-lancamento", "lancamento-suborigem");

  // 3. Tipo no Lançamento (Despesa / Receita)
  setupSegmentedControl("tipo-lancamento", "lancamento-tipo", (tipo) => {
    atualizarSelectsCategorias();
  });

  // 4. Cadastro de Categoria: Escopo e Tipo
  setupSegmentedControl("escopo-cad-cat", "cat-escopo");
  setupSegmentedControl("tipo-cad-cat", "cat-tipo");
}

// ============================================================================
// MOTOR DE PARCELAMENTO & PREVIEW REATIVO
// ============================================================================
function initParcelamento() {
  const switchParcelado = document.getElementById("lancamento-parcelado");
  const boxParcelas = document.getElementById("box-parcelas");
  const inputParcelas = document.getElementById("lancamento-total-parcelas");
  const btnMinus = document.getElementById("btn-parc-minus");
  const btnPlus = document.getElementById("btn-parc-plus");
  const modeButtons = document.querySelectorAll("#modo-calculo-parcelas .segment-btn");

  if (!switchParcelado || !boxParcelas) return;

  switchParcelado.addEventListener("change", (e) => {
    if (e.target.checked) {
      boxParcelas.classList.add("visible");
    } else {
      boxParcelas.classList.remove("visible");
    }
    atualizarPreviewParcelamento();
  });

  // Stepper + / -
  if (btnMinus && inputParcelas) {
    btnMinus.addEventListener("click", () => {
      let val = parseInt(inputParcelas.value, 10) || 2;
      if (val > 2) {
        inputParcelas.value = val - 1;
        atualizarPreviewParcelamento();
      }
    });
  }

  if (btnPlus && inputParcelas) {
    btnPlus.addEventListener("click", () => {
      let val = parseInt(inputParcelas.value, 10) || 2;
      if (val < 1000) {
        inputParcelas.value = val + 1;
        atualizarPreviewParcelamento();
      }
    });
  }

  if (inputParcelas) {
    inputParcelas.addEventListener("input", () => {
      let val = parseInt(inputParcelas.value, 10);
      if (val < 2) inputParcelas.value = 2;
      if (val > 1000) inputParcelas.value = 1000;
      atualizarPreviewParcelamento();
    });
  }

  // Alternância de modo de cálculo: Por Parcela vs Total
  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      modeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.parcelasCalcMode = btn.getAttribute("data-mode");
      atualizarPreviewParcelamento();
    });
  });

  // Recalcula parcelas ao alterar data de vencimento
  const inputData = document.getElementById("lancamento-data");
  if (inputData) {
    inputData.addEventListener("change", () => {
      atualizarPreviewParcelamento();
    });
  }
}

function atualizarPreviewParcelamento() {
  const isParcelado = document.getElementById("lancamento-parcelado")?.checked;
  const listContainer = document.getElementById("parcelas-preview-list");
  const badgeResumo = document.getElementById("preview-resumo");
  if (!listContainer || !badgeResumo) return;

  if (!isParcelado) {
    listContainer.innerHTML = "";
    return;
  }

  const rawValor = parseCurrencyInput(document.getElementById("lancamento-valor")?.value);
  const totalParcelas = parseInt(document.getElementById("lancamento-total-parcelas")?.value, 10) || 2;
  const dataStr = document.getElementById("lancamento-data")?.value || getTodayISODate();

  let valorUnitario = 0;
  let valorTotal = 0;

  if (state.parcelasCalcMode === "total") {
    valorTotal = rawValor;
    valorUnitario = rawValor > 0 ? rawValor / totalParcelas : 0;
  } else {
    valorUnitario = rawValor;
    valorTotal = rawValor * totalParcelas;
  }

  badgeResumo.textContent = `${totalParcelas}x de R$ ${formatCurrencyBRL(valorUnitario)} (Total: R$ ${formatCurrencyBRL(valorTotal)})`;

  // Parse da data inicial
  const parts = dataStr.split("-");
  const baseYear = parseInt(parts[0], 10);
  const baseMonth = parseInt(parts[1], 10) - 1; // 0..11
  const baseDay = parseInt(parts[2], 10);

  let html = "";
  for (let i = 1; i <= totalParcelas; i++) {
    const offsetMonths = i - 1;
    const targetMonthIndex = baseMonth + offsetMonths;
    const targetYear = baseYear + Math.floor(targetMonthIndex / 12);
    const targetMonth = targetMonthIndex % 12;

    const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const finalDay = Math.min(baseDay, daysInTargetMonth);

    const dayStr = String(finalDay).padStart(2, "0");
    const monthStr = String(targetMonth + 1).padStart(2, "0");
    const formattedDate = `${dayStr}/${monthStr}/${targetYear}`;

    html += `
      <li>
        <span class="parc-num">${i}/${totalParcelas}</span>
        <span class="parc-date">${formattedDate}</span>
        <span class="parc-val">R$ ${formatCurrencyBRL(valorUnitario)}</span>
      </li>
    `;
  }

  listContainer.innerHTML = html;
}

// ============================================================================
// GESTÃO DE CATEGORIAS (CAD_AUX)
// ============================================================================
async function carregarCategorias() {
  try {
    const res = await callBackend("obterCategorias");
    if (Array.isArray(res.data)) {
      state.categories = res.data;
      state.categories.sort((a, b) =>
        String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", { sensitivity: "base" })
      );
    } else {
      state.categories = [];
    }
  } catch (err) {
    console.error("Erro ao carregar categorias:", err);
    state.categories = [];
    showToast(`Não foi possível carregar as categorias: ${err.message}`, "warning");
  } finally {
    atualizarSelectsCategorias();
    renderCategoryBadges();
  }
}

function getCategoriasFiltradas(escopo, tipoTransacao) {
  return state.categories.filter((cat) => {
    const matchEscopo = String(cat.escopo).toLowerCase() === String(escopo).toLowerCase();
    const matchTipo = String(cat.tipoTransacao).toLowerCase() === String(tipoTransacao).toLowerCase();
    return matchEscopo && matchTipo;
  });
}

function atualizarSelectsCategorias() {
  const select = document.getElementById("lancamento-categoria");
  if (!select) return;

  const escopo = document.getElementById("lancamento-escopo")?.value || "Pessoal";
  const tipo = document.getElementById("lancamento-tipo")?.value || "Despesa";

  const filtradas = getCategoriasFiltradas(escopo, tipo);
  const valorAtual = select.value;

  if (filtradas.length === 0) {
    select.innerHTML = `<option value="" disabled selected>Nenhuma categoria cadastrada (${escopo} - ${tipo})</option>`;
    return;
  }

  select.innerHTML = `<option value="" disabled ${!valorAtual ? "selected" : ""}>Selecione uma categoria...</option>`;

  filtradas.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat.nome;
    opt.textContent = cat.nome;
    if (cat.nome === valorAtual) opt.selected = true;
    select.appendChild(opt);
  });
}

function renderCategoryBadges() {
  const container = document.getElementById("lista-categorias-container");
  const countBadge = document.getElementById("count-categorias");
  if (!container) return;

  const chipAtivo = document.querySelector(".category-filter-chips .chip.active")?.getAttribute("data-chip") || "Pessoal";
  const filtradas = state.categories.filter(
    (c) => String(c.escopo).toLowerCase() === chipAtivo.toLowerCase()
  );

  // Ordena alfabeticamente de A a Z
  filtradas.sort((a, b) =>
    String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", { sensitivity: "base" })
  );

  if (countBadge) {
    countBadge.textContent = `${filtradas.length} cadastradas`;
  }

  if (filtradas.length === 0) {
    container.innerHTML = `<div class="empty-state">Nenhuma categoria cadastrada para ${chipAtivo}.<br><small>Cadastre uma categoria no formulário acima para começar.</small></div>`;
    return;
  }

  let html = "";
  filtradas.forEach((cat) => {
    const isDespesa = String(cat.tipoTransacao).toLowerCase() === "despesa";
    html += `
      <div class="cat-badge ${isDespesa ? "despesa" : "receita"}">
        <span class="cat-name">${cat.nome}</span>
        <span class="cat-type-label ${isDespesa ? "despesa" : "receita"}">${isDespesa ? "Despesa" : "Receita"}</span>
      </div>
    `;
  });

  container.innerHTML = html;
}

function initCategoryChips() {
  const chips = document.querySelectorAll(".category-filter-chips .chip");
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderCategoryBadges();
    });
  });
}

// ============================================================================
// PREVISÃO DO PRÓXIMO MÊS (CARD HERO & BREAKDOWN)
// ============================================================================
// ============================================================================
// PREVISÃO, SELETOR TEMPORAL DE COMPETÊNCIA & GRÁFICO DE EVOLUÇÃO
// ============================================================================
function initPrevisaoScreen() {
  const pills = document.querySelectorAll(".forecast-filters .forecast-pill");
  pills.forEach((pill) => {
    pill.addEventListener("click", () => {
      pills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      state.currentForecastFilter = pill.getAttribute("data-filtro");
      carregarPrevisao(state.currentForecastFilter, state.selectedForecastIndex);
    });
  });

  const btnRefresh = document.getElementById("btn-atualizar-previsao");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", () => {
      btnRefresh.style.transform = "rotate(360deg)";
      setTimeout(() => (btnRefresh.style.transform = "none"), 400);
      carregarPrevisao(state.currentForecastFilter, state.selectedForecastIndex);
    });
  }
}

/**
 * Constrói períodos temporais para a projeção caso o backend ainda não retorne o array completo
 */
function buildFallbackForecastPeriods(dadosBase) {
  const hoje = new Date();
  const mesAtual = hoje.getMonth();
  const anoAtual = hoje.getFullYear();
  const mesesAbrev = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const nomesMeses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];

  const periodos = [];
  for (let offset = 0; offset < 6; offset++) {
    const rawMes = mesAtual + offset;
    const mesIndex = rawMes % 12;
    const ano = anoAtual + Math.floor(rawMes / 12);
    const mesNum = mesIndex + 1;
    const mesRef = (mesNum < 10 ? "0" + mesNum : String(mesNum)) + "/" + ano;

    let totalParcelas = 0;
    let qtdParcelas = 0;

    if (offset === 1 && dadosBase) {
      totalParcelas = dadosBase.totalParcelasMes || 0;
      qtdParcelas = dadosBase.qtdParcelasMes || 0;
    } else if (dadosBase && dadosBase.totalParcelasMes) {
      // Degradação suave de parcelas estimadas para meses futuros
      const fatorDecaimento = Math.max(0.15, 1 - (offset * 0.18));
      totalParcelas = Math.round((dadosBase.totalParcelasMes * fatorDecaimento) * 100) / 100;
      qtdParcelas = Math.max(1, Math.round(dadosBase.qtdParcelasMes * fatorDecaimento));
    }

    const totalPrevisto = Math.round(totalParcelas * 100) / 100;

    periodos.push({
      offset: offset,
      mesIndex: mesIndex,
      mesNumero: mesNum,
      ano: ano,
      mesReferencia: mesRef,
      mesNome: nomesMeses[mesIndex] + " de " + ano,
      labelCurto: mesesAbrev[mesIndex] + "/" + String(ano).slice(-2),
      isAtual: offset === 0,
      isProximo: offset === 1,
      totalParcelasMes: totalParcelas,
      qtdParcelasMes: qtdParcelas,
      totalFixosMes: 0,
      qtdFixosMes: 0,
      totalGastoPrevisto: totalPrevisto
    });
  }

  return periodos;
}

/**
 * Calcula a regressão linear simples (y = mx + b)
 * Obrigatória para a linha de tendência solicitada
 */
function calculateLinearRegression(points) {
  const n = points.length;
  if (n <= 1) {
    const yVal = points[0] ? points[0].y : 0;
    return { slope: 0, intercept: yVal, predict: () => yVal };
  }

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += points[i].x;
    sumY += points[i].y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    const dx = points[i].x - meanX;
    const dy = points[i].y - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  }

  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = meanY - (slope * meanX);

  return {
    slope: slope,
    intercept: intercept,
    predict: (x) => (slope * x) + intercept
  };
}

/**
 * Rola suavemente o chip ativo para o centro sem afetar o restante do card ou da página
 */
function scrollActiveChipIntoView(container, activeChip) {
  if (!container || !activeChip) return;
  const chipLeft = activeChip.offsetLeft;
  const chipWidth = activeChip.offsetWidth;
  const containerWidth = container.clientWidth;
  container.scrollTo({
    left: chipLeft - (containerWidth / 2) + (chipWidth / 2),
    behavior: "smooth"
  });
}

/**
 * Renderiza os Chips de Competência Touch (44x44px)
 */
function renderMonthSelector(months, selectedIndex) {
  const chipsContainer = document.getElementById("forecast-month-chips");
  if (!months || months.length === 0 || !chipsContainer) return;

  chipsContainer.innerHTML = months.map((m, idx) => {
    const activeClass = idx === selectedIndex ? "active" : "";
    const subTag = m.isAtual ? "Atual" : m.isProximo ? "Próx" : `+${m.offset}m`;
    return `
      <button type="button" 
        class="forecast-chip ${activeClass}" 
        data-index="${idx}" 
        role="tab" 
        aria-selected="${idx === selectedIndex ? "true" : "false"}"
        title="Ver gastos de ${m.mesNome}">
        <span class="chip-label">${m.labelCurto}</span>
        <span class="chip-sub">${subTag}</span>
      </button>
    `;
  }).join("");

  // Adicionar listener de toque nos chips
  const chipBtns = chipsContainer.querySelectorAll(".forecast-chip");
  chipBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.getAttribute("data-index"), 10);
      if (!isNaN(idx) && idx !== state.selectedForecastIndex) {
        state.selectedForecastIndex = idx;
        atualizarVisualizacaoCompetencia(idx);
      }
    });
  });

  // Rolagem horizontal isolada exclusivamente no container de chips
  const activeChip = chipsContainer.querySelector(".forecast-chip.active");
  if (activeChip) {
    scrollActiveChipIntoView(chipsContainer, activeChip);
  }
}

/**
 * Atualiza todos os elementos visuais ao trocar de competência
 */
function atualizarVisualizacaoCompetencia(index) {
  if (!state.forecastMonths || !state.forecastMonths[index]) return;

  const item = state.forecastMonths[index];
  state.selectedForecastIndex = index;

  // Atualizar Card Herói (Total, período e quantidade de lançamentos)
  const totalEl = document.getElementById("forecast-total");
  const periodoEl = document.getElementById("forecast-periodo");
  const countParcEl = document.getElementById("forecast-count-parcelas");

  if (totalEl) totalEl.textContent = `R$ ${formatCurrencyBRL(item.totalGastoPrevisto)}`;
  if (periodoEl) periodoEl.textContent = item.mesReferencia;
  if (countParcEl) {
    const qtd = item.qtdParcelasMes || 0;
    countParcEl.textContent = `${qtd} ${qtd === 1 ? "lançamento a vencer" : "lançamentos a vencer"}`;
  }

  // Atualizar estado ativo dos chips e rolar isoladamente sem mover o card
  const chipsContainer = document.getElementById("forecast-month-chips");
  if (chipsContainer) {
    const chips = chipsContainer.querySelectorAll(".forecast-chip");
    chips.forEach((c, i) => {
      if (i === index) {
        c.classList.add("active");
        c.setAttribute("aria-selected", "true");
        scrollActiveChipIntoView(chipsContainer, c);
      } else {
        c.classList.remove("active");
        c.setAttribute("aria-selected", "false");
      }
    });
  }

  // Redesenhar gráfico destacando o ponto da competência selecionada
  renderForecastChart(state.forecastMonths, index);
}

/**
 * Renderiza o Gráfico SVG de Linhas com Linha de Tendência Linear
 * Dimensão compacta mobile (~185px) sem interatividade pesada
 */
function renderForecastChart(months, selectedIndex = 1) {
  const container = document.getElementById("forecast-chart-container");
  if (!container || !months || months.length === 0) return;

  const width = 340;
  const height = 185;
  const padTop = 24;
  const padBottom = 30;
  const padLeft = 24;
  const padRight = 24;

  const chartW = width - padLeft - padRight;
  const chartH = height - padTop - padBottom;

  // Extrair valores Y e calcular escala
  const yValues = months.map(m => Number(m.totalGastoPrevisto) || 0);
  let minVal = Math.min(...yValues);
  let maxVal = Math.max(...yValues);

  if (minVal === maxVal) {
    minVal = Math.max(0, minVal * 0.8);
    maxVal = maxVal * 1.25 || 100;
  } else {
    // Adicionar respiro superior de 14% para rótulos de valores não colidirem com o topo
    const range = maxVal - minVal;
    maxVal = maxVal + (range * 0.14);
    minVal = Math.max(0, minVal - (range * 0.05));
  }

  const valRange = (maxVal - minVal) || 1;

  function getX(i) {
    return padLeft + (i / (months.length - 1)) * chartW;
  }

  function getY(val) {
    return padTop + chartH - ((val - minVal) / valRange) * chartH;
  }

  // 1. Regressão Linear Simples para Linha de Tendência
  const points = months.map((m, i) => ({ x: i, y: Number(m.totalGastoPrevisto) || 0 }));
  const regression = calculateLinearRegression(points);

  const trendStart = { x: getX(0), y: getY(regression.predict(0)) };
  const trendEnd = { x: getX(months.length - 1), y: getY(regression.predict(months.length - 1)) };

  // 2. Construir caminhos SVG para Despesas Previstas
  const coords = months.map((m, i) => ({
    x: getX(i),
    y: getY(Number(m.totalGastoPrevisto) || 0),
    val: Number(m.totalGastoPrevisto) || 0
  }));

  // Linha sólida
  let linePathD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    linePathD += ` L ${coords[i].x} ${coords[i].y}`;
  }

  // Área preenchida com gradiente
  const baseY = padTop + chartH;
  let areaPathD = `M ${coords[0].x} ${baseY} L ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    areaPathD += ` L ${coords[i].x} ${coords[i].y}`;
  }
  areaPathD += ` L ${coords[coords.length - 1].x} ${baseY} Z`;

  // Linhas horizontais de grade (Grid suave)
  const gridLevels = [0.25, 0.5, 0.75, 1];
  const gridSvg = gridLevels.map(pct => {
    const y = padTop + (1 - pct) * chartH;
    return `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="var(--chart-grid)" stroke-width="1" stroke-dasharray="2 3" opacity="0.8" />`;
  }).join("");

  // Rótulos do Eixo X
  const xLabelsSvg = months.map((m, i) => {
    const isSel = i === selectedIndex;
    const x = getX(i);
    const y = height - 10;
    const fill = isSel ? "var(--chart-1)" : "var(--chart-axis)";
    const weight = isSel ? "700" : "500";
    return `<text x="${x}" y="${y}" text-anchor="middle" font-size="10" font-family="'JetBrains Mono', Inter, sans-serif" font-weight="${weight}" fill="${fill}">${m.labelCurto}</text>`;
  }).join("");

  // Pontos (Nós) e Marcador Selecionado
  const nodesSvg = coords.map((c, i) => {
    const isSel = i === selectedIndex;
    if (isSel) {
      const textVal = `R$ ${formatCurrencyBRL(c.val)}`;
      const approxCharWidth = 6.4;
      const boxW = Math.round(textVal.length * approxCharWidth) + 12;
      const boxH = 20;
      // Clampa boxX para não vazar a borda esquerda ou direita
      const boxX = Math.max(4, Math.min(width - boxW - 4, c.x - (boxW / 2)));
      // Posiciona acima do ponto se houver espaço no topo, senão posiciona logo abaixo
      const boxY = (c.y - boxH - 8 < 6) ? c.y + 10 : c.y - boxH - 8;
      const textX = boxX + (boxW / 2);
      const textY = boxY + 14;

      return `
        <g class="chart-active-node">
          <!-- Halo de foco com pulso estético -->
          <circle cx="${c.x}" cy="${c.y}" r="11" fill="var(--chart-1)" opacity="0.25" />
          <circle cx="${c.x}" cy="${c.y}" r="5.5" fill="var(--chart-1)" stroke="var(--chart-card-bg)" stroke-width="2" />

          <!-- Badge/Pill flutuante de alto contraste -->
          <rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="5" 
            fill="var(--chart-badge-bg)" stroke="var(--chart-badge-border)" stroke-width="1.2" 
            filter="drop-shadow(0 2px 6px rgba(0,0,0,0.35))" />

          <!-- Valor monetário em destaque âmbar/dourado de altíssima visibilidade -->
          <text x="${textX}" y="${textY}" text-anchor="middle" 
            font-size="10.5" font-family="'JetBrains Mono', monospace" font-weight="800" 
            fill="var(--chart-badge-text)" letter-spacing="-0.02em">${textVal}</text>
        </g>
      `;
    }
    return `
      <circle cx="${c.x}" cy="${c.y}" r="3.5" fill="var(--chart-card-bg)" stroke="var(--chart-1)" stroke-width="2.2" />
    `;
  }).join("");

  // Gerar SVG Completo
  container.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" class="forecast-svg-chart" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="forecastAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--chart-gradient-start)" />
          <stop offset="100%" stop-color="var(--chart-gradient-end)" />
        </linearGradient>
      </defs>

      <!-- Linhas de Grade -->
      <g class="chart-grid-group">
        ${gridSvg}
      </g>

      <!-- Linha de Tendência (Regressão Linear Tracejada) -->
      <line x1="${trendStart.x}" y1="${trendStart.y}" x2="${trendEnd.x}" y2="${trendEnd.y}" 
        stroke="var(--chart-2)" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" />

      <!-- Área de Despesas Previstas com Gradiente Suave -->
      <path d="${areaPathD}" fill="url(#forecastAreaGrad)" />

      <!-- Linha Sólida Principal de Despesas Previstas -->
      <path d="${linePathD}" fill="none" stroke="var(--chart-1)" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" />

      <!-- Pontos de Dados -->
      <g class="chart-nodes-group">
        ${nodesSvg}
      </g>

      <!-- Rótulos do Eixo X -->
      <g class="chart-labels-group">
        ${xLabelsSvg}
      </g>
    </svg>
  `;

  // 3. Atualizar Barra Inferior de Tendência e Média
  const trendBadge = document.getElementById("chart-trend-badge");
  const trendText = document.getElementById("chart-trend-text");
  const avgText = document.getElementById("chart-avg-text");

  const avgVal = yValues.reduce((a, b) => a + b, 0) / yValues.length;
  if (avgText) {
    avgText.textContent = `Média: R$ ${formatCurrencyBRL(avgVal)}`;
  }

  if (trendBadge && trendText) {
    const diffTotal = regression.predict(months.length - 1) - regression.predict(0);
    const taxaMensal = diffTotal / (months.length - 1);

    trendBadge.classList.remove("trend-up", "trend-down", "trend-stable");

    if (diffTotal > 60) {
      trendBadge.classList.add("trend-up");
      trendText.textContent = `Tendência de Alta (+R$ ${formatCurrencyBRL(Math.abs(taxaMensal))}/mês)`;
    } else if (diffTotal < -60) {
      trendBadge.classList.add("trend-down");
      trendText.textContent = `Tendência de Queda (-R$ ${formatCurrencyBRL(Math.abs(taxaMensal))}/mês)`;
    } else {
      trendBadge.classList.add("trend-stable");
      trendText.textContent = "Tendência Estável";
    }
  }
}

/**
 * Carrega a previsão financeira via backend e sincroniza competências e gráfico
 */
async function carregarPrevisao(filtro = "Geral", targetOffset = state.selectedForecastIndex) {
  const totalEl = document.getElementById("forecast-total");
  const periodoEl = document.getElementById("forecast-periodo");
  const chartContainer = document.getElementById("forecast-chart-container");

  if (totalEl) totalEl.textContent = "Calculando...";
  if (periodoEl) periodoEl.textContent = "Calculando...";

  if (chartContainer && (!state.forecastMonths || state.forecastMonths.length === 0)) {
    chartContainer.innerHTML = `
      <div class="chart-loading-state">
        <div class="spinner-sm"></div>
        <span>Carregando projeção financeira...</span>
      </div>
    `;
  }

  try {
    const res = await callBackend("obterPrevisaoMesSeguinte", {
      filtro: filtro,
      offset: targetOffset
    });
    const dados = res.data;

    // Se o backend já retornar o array de 6 meses (nova versão do Code.gs)
    if (dados && Array.isArray(dados.projecaoMeses) && dados.projecaoMeses.length > 0) {
      state.forecastMonths = dados.projecaoMeses;
    } else {
      // Fallback robusto caso a publicação do Google Apps Script ainda execute a versão anterior
      state.forecastMonths = buildFallbackForecastPeriods(dados);
    }

    // Definir índice selecionado (mantém o offset se válido, senão usa 1 = Próximo Mês)
    let activeIdx = typeof targetOffset === "number" && targetOffset >= 0 && targetOffset < state.forecastMonths.length
      ? targetOffset
      : 1;

    state.selectedForecastIndex = activeIdx;

    // Renderizar controles de seleção e visualização
    renderMonthSelector(state.forecastMonths, activeIdx);
    atualizarVisualizacaoCompetencia(activeIdx);

  } catch (err) {
    console.error("Erro ao carregar previsão:", err);
    if (totalEl) totalEl.textContent = "Indisponível";
    if (periodoEl) periodoEl.textContent = "--/----";
    showToast("Não foi possível carregar a previsão.", "error");

    if (chartContainer) {
      chartContainer.innerHTML = `
        <div class="chart-loading-state" style="color: var(--color-despesa);">
          <span>Falha ao sincronizar gráfico de evolução</span>
        </div>
      `;
    }
  }
}

// ============================================================================
// SUBMISSÃO DE FORMULÁRIOS
// ============================================================================
function setButtonLoading(buttonId, isLoading, originalText = "") {
  const btn = document.getElementById(buttonId);
  if (!btn) return;

  const textEl = btn.querySelector(".btn-text");
  const spinnerEl = btn.querySelector(".btn-spinner");

  if (isLoading) {
    btn.disabled = true;
    if (textEl) textEl.textContent = "Gravando...";
    if (spinnerEl) spinnerEl.style.display = "inline-block";
  } else {
    btn.disabled = false;
    if (textEl && originalText) textEl.textContent = originalText;
    if (spinnerEl) spinnerEl.style.display = "none";
  }
}

// ============================================================================
// SISTEMA DA TELA 5: HISTÓRICO DE LANÇAMENTOS (PAGINAÇÃO DE 25 LINHAS/PÁG)
// ============================================================================
let historicoRegistrosCache = [];
let historicoPaginaAtual = 1;
const HISTORICO_ITENS_POR_PAGINA = 25;

function initHistoricoScreen() {
  const btnAtualizar = document.getElementById("btn-atualizar-historico");
  if (btnAtualizar) {
    btnAtualizar.addEventListener("click", () => {
      carregarHistorico();
    });
  }

  // Controles de paginação
  const btnPrev = document.getElementById("btn-page-prev");
  const btnNext = document.getElementById("btn-page-next");
  const btnFirst = document.getElementById("btn-page-first");
  const btnLast = document.getElementById("btn-page-last");

  if (btnPrev) {
    btnPrev.addEventListener("click", () => {
      if (historicoPaginaAtual > 1) {
        historicoPaginaAtual--;
        renderTabelaHistoricoPaginada();
        scrollParaTopoTabela();
      }
    });
  }

  if (btnNext) {
    btnNext.addEventListener("click", () => {
      const totalPaginas = Math.ceil(historicoRegistrosCache.length / HISTORICO_ITENS_POR_PAGINA) || 1;
      if (historicoPaginaAtual < totalPaginas) {
        historicoPaginaAtual++;
        renderTabelaHistoricoPaginada();
        scrollParaTopoTabela();
      }
    });
  }

  if (btnFirst) {
    btnFirst.addEventListener("click", () => {
      if (historicoPaginaAtual !== 1) {
        historicoPaginaAtual = 1;
        renderTabelaHistoricoPaginada();
        scrollParaTopoTabela();
      }
    });
  }

  if (btnLast) {
    btnLast.addEventListener("click", () => {
      const totalPaginas = Math.ceil(historicoRegistrosCache.length / HISTORICO_ITENS_POR_PAGINA) || 1;
      if (historicoPaginaAtual !== totalPaginas) {
        historicoPaginaAtual = totalPaginas;
        renderTabelaHistoricoPaginada();
        scrollParaTopoTabela();
      }
    });
  }
}

function scrollParaTopoTabela() {
  const container = document.querySelector(".table-container");
  if (container) {
    container.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function carregarHistorico() {
  const tbody = document.getElementById("lista-historico-body");
  const countLabel = document.getElementById("label-total-historico");
  const paginationWrapper = document.getElementById("historico-pagination-wrapper");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="3" class="table-loading">Carregando lançamentos...</td></tr>`;
  if (paginationWrapper) paginationWrapper.style.display = "none";

  try {
    const res = await callBackend("obterRegistros");
    const lista = (res && res.data && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
    historicoRegistrosCache = lista;
    historicoPaginaAtual = 1; // Reseta sempre para a primeira página
    renderTabelaHistoricoPaginada();
  } catch (err) {
    console.error("[Histórico] Erro ao carregar registros:", err);
    tbody.innerHTML = `<tr><td colspan="3" class="table-empty error">Erro ao processar lançamentos.</td></tr>`;
    if (countLabel) countLabel.textContent = "Erro no histórico";
    if (paginationWrapper) paginationWrapper.style.display = "none";
  }
}

function renderTabelaHistoricoPaginada() {
  const tbody = document.getElementById("lista-historico-body");
  const countLabel = document.getElementById("label-total-historico");
  const paginationWrapper = document.getElementById("historico-pagination-wrapper");
  const paginationInfo = document.getElementById("historico-pagination-info");
  const pageCurrentPill = document.getElementById("page-current-pill");
  const btnPrev = document.getElementById("btn-page-prev");
  const btnNext = document.getElementById("btn-page-next");
  const btnFirst = document.getElementById("btn-page-first");
  const btnLast = document.getElementById("btn-page-last");

  if (!tbody) return;

  const totalRegistros = historicoRegistrosCache.length;

  if (totalRegistros === 0) {
    tbody.innerHTML = `<tr><td colspan="3" class="table-empty">Nenhum lançamento registrado nesta sessão de teste.</td></tr>`;
    if (countLabel) countLabel.textContent = "0 lançamentos encontrados";
    if (paginationWrapper) paginationWrapper.style.display = "none";
    return;
  }

  const totalPaginas = Math.ceil(totalRegistros / HISTORICO_ITENS_POR_PAGINA) || 1;
  if (historicoPaginaAtual > totalPaginas) historicoPaginaAtual = totalPaginas;
  if (historicoPaginaAtual < 1) historicoPaginaAtual = 1;

  const inicio = (historicoPaginaAtual - 1) * HISTORICO_ITENS_POR_PAGINA;
  const fim = Math.min(inicio + HISTORICO_ITENS_POR_PAGINA, totalRegistros);
  const itensPagina = historicoRegistrosCache.slice(inicio, fim);

  // Renderizar somente as 25 linhas da página atual
  tbody.innerHTML = itensPagina.map((item) => {
    const escopo = item.escopo || "Pessoal";
    const escopoClass = escopo.toLowerCase().indexOf("empresarial") !== -1 ? "empresarial" : "pessoal";
    const categoria = item.categoria || "Sem Categoria";
    const tipo = (item.tipo || "Despesa").trim();
    const isReceita = tipo.toLowerCase() === "receita";

    const valorNum = parseFloat(item.valor) || 0;
    const valorFormatado = formatCurrencyBRL(valorNum);
    const sinal = isReceita ? "+" : "-";
    const classeValor = isReceita ? "valor-receita" : "valor-despesa";
    const classeLinha = isReceita ? "row-receita" : "row-despesa";

    return `
      <tr class="${classeLinha}">
        <td class="td-escopo">
          <span class="badge-escopo ${escopoClass}">${escopo}</span>
        </td>
        <td class="td-categoria">
          <span class="cat-name">${categoria}</span>
        </td>
        <td class="td-valor ${classeValor}">
          ${sinal} R$ ${valorFormatado}
        </td>
      </tr>
    `;
  }).join("");

  // Atualizar informações da paginação
  if (countLabel) {
    countLabel.textContent = `${totalRegistros} lançamentos em ordem decrescente`;
  }

  if (paginationInfo) {
    paginationInfo.textContent = `Exibindo ${inicio + 1}–${fim} de ${totalRegistros} lançamentos`;
  }

  if (pageCurrentPill) {
    pageCurrentPill.textContent = `${historicoPaginaAtual} / ${totalPaginas}`;
  }

  // Desabilitar botões nos extremos
  if (btnFirst) btnFirst.disabled = historicoPaginaAtual === 1;
  if (btnPrev) btnPrev.disabled = historicoPaginaAtual === 1;
  if (btnNext) btnNext.disabled = historicoPaginaAtual === totalPaginas;
  if (btnLast) btnLast.disabled = historicoPaginaAtual === totalPaginas;

  // Exibir a barra de paginação apenas se houver mais de 1 página ou registros
  if (paginationWrapper) {
    paginationWrapper.style.display = totalPaginas > 1 ? "flex" : "none";
  }
}

function initFormSubmissions() {
  // 1. FORMULÁRIO DE LANÇAMENTO
  const formLancamento = document.getElementById("form-lancamento");
  if (formLancamento) {
    formLancamento.addEventListener("submit", async (e) => {
      e.preventDefault();

      const escopo = document.getElementById("lancamento-escopo")?.value || "Pessoal";
      const subOrigem = escopo === "Empresarial" ? (document.getElementById("lancamento-suborigem")?.value || "") : "";
      const tipo = document.getElementById("lancamento-tipo")?.value || "Despesa";
      const categoria = document.getElementById("lancamento-categoria")?.value;
      const descricao = (document.getElementById("lancamento-descricao")?.value || "").trim();
      const rawValor = parseCurrencyInput(document.getElementById("lancamento-valor")?.value);
      const dataCompetencia = document.getElementById("lancamento-data")?.value;
      const isParcelado = document.getElementById("lancamento-parcelado")?.checked;
      const totalParcelas = isParcelado ? (parseInt(document.getElementById("lancamento-total-parcelas")?.value, 10) || 2) : 1;

      // Validações Mobile
      if (escopo === "Empresarial" && !subOrigem) {
        showToast("Selecione a unidade empresarial (MT ou MS).", "warning");
        return;
      }
      if (!categoria) {
        showToast("Por favor, selecione uma categoria.", "warning");
        document.getElementById("lancamento-categoria")?.focus();
        return;
      }
      if (rawValor <= 0) {
        showToast("O valor deve ser maior que R$ 0,00.", "warning");
        document.getElementById("lancamento-valor")?.focus();
        return;
      }
      if (!dataCompetencia) {
        showToast("Informe a data de competência/vencimento.", "warning");
        return;
      }

      let valorPorParcela = rawValor;
      if (isParcelado && state.parcelasCalcMode === "total") {
        valorPorParcela = rawValor / totalParcelas;
      }

      setButtonLoading("btn-salvar-lancamento", true);

      try {
        const payload = {
          escopo,
          subOrigem,
          tipoTransacao: tipo,
          categoria,
          descricao,
          valor: valorPorParcela,
          dataCompetencia,
          parcelado: isParcelado,
          totalParcelas: totalParcelas
        };

        const res = await callBackend("salvarRegistro", payload);

        showToast(
          isParcelado
            ? `Sucesso! ${totalParcelas} parcelas registradas.`
            : "Lançamento registrado com sucesso!",
          "success"
        );

        // Reset do formulário
        formLancamento.reset();
        document.getElementById("lancamento-valor").value = "0,00";
        document.getElementById("lancamento-data").value = getTodayISODate();
        document.getElementById("box-parcelas")?.classList.remove("visible");
        atualizarSelectsCategorias();
        atualizarPreviewParcelamento();

        // Atualiza a previsão e histórico em segundo plano
        carregarPrevisao(state.currentForecastFilter);
        carregarHistorico();

      } catch (err) {
        showToast(`Erro ao salvar: ${err.message}`, "error");
      } finally {
        setButtonLoading("btn-salvar-lancamento", false, "Salvar Lançamento");
      }
    });
  }


  // 3. FORMULÁRIO DE CADASTRO DE CATEGORIA
  const formCategoria = document.getElementById("form-categoria");
  if (formCategoria) {
    formCategoria.addEventListener("submit", async (e) => {
      e.preventDefault();

      const escopo = document.getElementById("cat-escopo")?.value || "Pessoal";
      const tipo = document.getElementById("cat-tipo")?.value || "Despesa";
      const nome = document.getElementById("cat-nome")?.value.trim();

      if (!nome) {
        showToast("Digite o nome da categoria.", "warning");
        document.getElementById("cat-nome")?.focus();
        return;
      }

      setButtonLoading("btn-salvar-categoria", true);

      try {
        const res = await callBackend("cadastrarCategoria", {
          escopo,
          tipoTransacao: tipo,
          categoriaNome: nome
        });

        if (res.data?.jaExistia) {
          showToast(`A categoria "${nome}" já existe.`, "warning");
        } else {
          showToast(`Categoria "${nome}" cadastrada com sucesso!`, "success");
          // Adiciona ao cache local
          state.categories.push({
            escopo,
            tipoTransacao: tipo,
            nome
          });
          state.categories.sort((a, b) =>
            String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", { sensitivity: "base" })
          );
        }

        document.getElementById("cat-nome").value = "";
        atualizarSelectsCategorias();
        renderCategoryBadges();

      } catch (err) {
        showToast(`Erro ao cadastrar: ${err.message}`, "error");
      } finally {
        setButtonLoading("btn-salvar-categoria", false, "+ Cadastrar Categoria");
      }
    });
  }
}

// ============================================================================
// INICIALIZAÇÃO DO APP NO CARREGAMENTO DO DOM
// ============================================================================
document.addEventListener("DOMContentLoaded", () => {
  // Define data padrão de hoje
  const dataInput = document.getElementById("lancamento-data");
  if (dataInput) {
    dataInput.value = getTodayISODate();
  }

  // Máscaras de moeda
  const valorLancamento = document.getElementById("lancamento-valor");
  if (valorLancamento) {
    setupMoneyMask(valorLancamento, () => {
      atualizarPreviewParcelamento();
    });
  }


  // Inicializações dos módulos
  initThemeToggle();
  initNavigation();
  initConditionalFields();
  initParcelamento();
  initCategoryChips();
  initPrevisaoScreen();
  initHistoricoScreen();
  initFormSubmissions();

  // Sincronização inicial
  carregarCategorias();
  carregarPrevisao("Geral");
  carregarHistorico();
});

// ============================================================================
// SISTEMA DE TEMA ESCURO / CLARO (CYBERSECURITY DARK MODE)
// ============================================================================
function initThemeToggle() {
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');

  function applyTheme(theme) {
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      document.body.classList.add("dark-theme");
      if (metaThemeColor) metaThemeColor.setAttribute("content", "#030706");
      if (themeToggleBtn) {
        themeToggleBtn.setAttribute("title", "Mudar para Modo Claro");
        themeToggleBtn.setAttribute("aria-label", "Mudar para Modo Claro");
      }
    } else {
      document.documentElement.setAttribute("data-theme", "light");
      document.body.classList.remove("dark-theme");
      if (metaThemeColor) metaThemeColor.setAttribute("content", "#0D3C1F");
      if (themeToggleBtn) {
        themeToggleBtn.setAttribute("title", "Mudar para Modo Escuro");
        themeToggleBtn.setAttribute("aria-label", "Mudar para Modo Escuro");
      }
    }

    // Re-renderizar o gráfico de projeção financeira para sincronizar com o novo tema
    if (state.forecastMonths && state.forecastMonths.length > 0) {
      renderForecastChart(state.forecastMonths, state.selectedForecastIndex);
    }
  }

  // Verificar preferência salva (padrão é o tema claro original da aplicação)
  let savedTheme = "light";
  try {
    const stored = localStorage.getItem("mmh_theme");
    if (stored === "dark" || stored === "light") {
      savedTheme = stored;
    }
  } catch (e) {
    console.warn("Acesso ao localStorage indisponível:", e);
  }

  applyTheme(savedTheme);

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const newTheme = currentTheme === "dark" ? "light" : "dark";

      try {
        localStorage.setItem("mmh_theme", newTheme);
      } catch (e) {
        console.warn("Não foi possível salvar preferência de tema:", e);
      }

      applyTheme(newTheme);
    });
  }
}

