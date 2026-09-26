/**
 * ============================================================================
 * SISTEMA INTEGRADO DE GESTÃO FINANCEIRA MOBILE (GOOGLE APPS SCRIPT)
 * ============================================================================
 * Backend para inserção de lançamentos, parcelamento automático,
 * gestão de gastos fixos, categorias auxiliares e cálculo de previsão mensal.
 * 
 * Planilha ID: 10Aiv-JrGMKt-lhooY1EUpNs4GuD0sQMYozo3dhVPq3U
 * Fuso Horário: America/Sao_Paulo (DD/MM/YYYY HH:MM:SS)
 * ============================================================================
 */

const CONFIG = {
  SPREADSHEET_ID: "10Aiv-JrGMKt-lhooY1EUpNs4GuD0sQMYozo3dhVPq3U",
  TIMEZONE: "America/Sao_Paulo",
  SHEETS: {
    REGISTROS: "REGISTROS",
    GASTOS_FIXOS: "GASTOS_FIXOS",
    CAD_AUX: "CAD_AUX"
  },
  SCHEMAS: {
    REGISTROS: [
      "Data_Hora_Registro",
      "Competencia_Vencimento",
      "Tipo_Escopo",
      "Sub_Origem",
      "Tipo_Transacao",
      "Categoria",
      "Descricao",
      "Valor",
      "Parcela_Atual",
      "Total_Parcelas",
      "ID_Agrupamento_Parcela"
    ],
    GASTOS_FIXOS: [
      "Data_Hora_Cadastro",
      "Tipo_Escopo",
      "Sub_Origem",
      "Categoria",
      "Descricao",
      "Valor",
      "Dia_Vencimento",
      "Status_Ativo"
    ],
    CAD_AUX: [
      "Tipo_Escopo",
      "Tipo_Transacao",
      "Categoria_Nome"
    ]
  }
};

/**
 * Retorna a instância da planilha configurada
 */
function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID && CONFIG.SPREADSHEET_ID !== "") {
    try {
      return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    } catch (err) {
      console.warn("Falha ao abrir por ID, usando getActiveSpreadsheet:", err);
    }
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Garante que as abas necessárias e cabeçalhos existam (sem inserir categorias padrão)
 */
function initializeSheets() {
  const ss = getSpreadsheet();
  if (!ss) throw new Error("Planilha não encontrada.");

  // 1. REGISTROS
  let shRegistros = ss.getSheetByName(CONFIG.SHEETS.REGISTROS);
  if (!shRegistros) {
    shRegistros = ss.insertSheet(CONFIG.SHEETS.REGISTROS);
  }
  if (shRegistros.getLastRow() === 0) {
    shRegistros.appendRow(CONFIG.SCHEMAS.REGISTROS);
    shRegistros.getRange(1, 1, 1, CONFIG.SCHEMAS.REGISTROS.length).setFontWeight("bold").setBackground("#0D3C1F").setFontColor("#FFFFFF");
    shRegistros.setFrozenRows(1);
  }

  // 2. GASTOS_FIXOS
  let shFixos = ss.getSheetByName(CONFIG.SHEETS.GASTOS_FIXOS);
  if (!shFixos) {
    shFixos = ss.insertSheet(CONFIG.SHEETS.GASTOS_FIXOS);
  }
  if (shFixos.getLastRow() === 0) {
    shFixos.appendRow(CONFIG.SCHEMAS.GASTOS_FIXOS);
    shFixos.getRange(1, 1, 1, CONFIG.SCHEMAS.GASTOS_FIXOS.length).setFontWeight("bold").setBackground("#0D3C1F").setFontColor("#FFFFFF");
    shFixos.setFrozenRows(1);
  }

  // 3. CAD_AUX (Apenas cabeçalho; categorias cadastradas exclusivamente pelo usuário na planilha)
  let shAux = ss.getSheetByName(CONFIG.SHEETS.CAD_AUX);
  if (!shAux) {
    shAux = ss.insertSheet(CONFIG.SHEETS.CAD_AUX);
  }
  if (shAux.getLastRow() === 0) {
    shAux.appendRow(CONFIG.SCHEMAS.CAD_AUX);
    shAux.getRange(1, 1, 1, CONFIG.SCHEMAS.CAD_AUX.length).setFontWeight("bold").setBackground("#0D3C1F").setFontColor("#FFFFFF");
    shAux.setFrozenRows(1);
  }

  return { ss, shRegistros, shFixos, shAux };
}

/**
 * Formata data no padrão DD/MM/YYYY HH:MM:SS (horário de Brasília)
 */
function getCurrentTimestamp() {
  return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm:ss");
}

/**
 * Converte string 'YYYY-MM-DD' ou 'DD/MM/YYYY' ou objeto Date para string 'DD/MM/YYYY'
 */
function formatarDataBR(dataInput) {
  if (!dataInput) {
    return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, "dd/MM/yyyy");
  }

  if (typeof dataInput === "string") {
    // Se já estiver no formato DD/MM/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dataInput)) {
      return dataInput;
    }
    // Se estiver no formato YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(dataInput)) {
      const parts = dataInput.split("T")[0].split("-");
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
  }

  if (dataInput instanceof Date) {
    return Utilities.formatDate(dataInput, CONFIG.TIMEZONE, "dd/MM/yyyy");
  }

  return Utilities.formatDate(new Date(dataInput), CONFIG.TIMEZONE, "dd/MM/yyyy");
}

/**
 * Trata requisição POST (anti-CORS via Content-Type text/plain)
 */
function doPost(e) {
  try {
    initializeSheets();

    let data = {};
    if (e && e.postData && e.postData.contents) {
      data = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      data = e.parameter;
    }

    const action = data.action || (e && e.parameter ? e.parameter.action : null);
    let result = null;

    switch (action) {
      case "salvarRegistro":
        result = actionSalvarRegistro(data);
        break;


      case "cadastrarCategoria":
        result = actionCadastrarCategoria(data);
        break;

      case "obterCategorias":
        result = actionObterCategorias(data);
        break;

      case "obterPrevisaoMesSeguinte":
        result = actionObterPrevisaoMesSeguinte(data);
        break;

      case "obterRegistros":
        result = actionObterRegistros(data);
        break;

      default:
        throw new Error("Ação não reconhecida: " + action);
    }

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      timestamp: getCurrentTimestamp(),
      data: result
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    console.error("Erro no doPost:", error);
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: error.message || error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Trata requisição GET (para consultas rápidas, anti-CORS universal e JSONP)
 */
function doGet(e) {
  try {
    initializeSheets();
    const params = e && e.parameter ? e.parameter : {};
    const action = params.action || "status";
    const callback = params.callback;

    let result = null;

    switch (action) {
      case "obterCategorias":
        result = actionObterCategorias(params);
        break;

      case "obterPrevisaoMesSeguinte":
        result = actionObterPrevisaoMesSeguinte(params);
        break;

      case "obterRegistros":
        result = actionObterRegistros(params);
        break;

      case "salvarRegistro":
        result = actionSalvarRegistro(params);
        break;


      case "cadastrarCategoria":
        result = actionCadastrarCategoria(params);
        break;

      case "status":
      default:
        result = {
          message: "API do Sistema Financeiro ativa e operacional.",
          timestamp: getCurrentTimestamp()
        };
        break;
    }

    const response = {
      success: true,
      timestamp: getCurrentTimestamp(),
      data: result
    };

    if (callback) {
      return ContentService.createTextOutput(callback + "(" + JSON.stringify(response) + ");")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService.createTextOutput(JSON.stringify(response))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    const errorResponse = {
      success: false,
      error: error.message || error.toString()
    };
    const callback = e && e.parameter ? e.parameter.callback : null;
    if (callback) {
      return ContentService.createTextOutput(callback + "(" + JSON.stringify(errorResponse) + ");")
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(JSON.stringify(errorResponse))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ============================================================================
 * ROTA: salvarRegistro
 * ============================================================================
 * Salva novo registro na aba REGISTROS.
 * Se for parcelado, gera N linhas com datas sequenciais mês a mês e mesmo ID de agrupamento.
 */
function actionSalvarRegistro(payload) {
  const { shRegistros } = initializeSheets();

  const timestamp = getCurrentTimestamp();
  const escopo = payload.escopo || "Pessoal";
  const subOrigem = escopo === "Empresarial" ? (payload.subOrigem || "") : "";
  const tipoTransacao = payload.tipoTransacao || "Despesa";
  const categoria = payload.categoria || "Geral";
  const descricaoBase = (payload.descricao || "").trim();
  const valorUnitario = parseFloat(payload.valor);

  if (isNaN(valorUnitario) || valorUnitario <= 0) {
    throw new Error("Valor inválido.");
  }

  const isParcelado = payload.parcelado === true || String(payload.parcelado).toLowerCase() === "true" || payload.parcelado === 1 || String(payload.parcelado) === "1";
  const totalParcelas = isParcelado ? parseInt(payload.totalParcelas, 10) : 1;

  if (isParcelado && (isNaN(totalParcelas) || totalParcelas < 2)) {
    throw new Error("Número de parcelas deve ser maior ou igual a 2.");
  }

  // Decomposição da data base da competência
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

  const rowsToInsert = [];
  const idAgrupamento = isParcelado 
    ? "PARC-" + Utilities.getUuid().substring(0, 8).toUpperCase() + "-" + new Date().getTime() 
    : "";

  const baseDay = baseDate.getDate();
  const baseMonth = baseDate.getMonth(); // 0..11
  const baseYear = baseDate.getFullYear();

  for (let i = 1; i <= totalParcelas; i++) {
    // Cálculo mês a mês sequencial com ajuste de dias em meses menores
    const offsetMonths = i - 1;
    const targetMonthIndex = baseMonth + offsetMonths;
    const targetYear = baseYear + Math.floor(targetMonthIndex / 12);
    const targetMonth = targetMonthIndex % 12;

    // Ajusta para o último dia do mês se o mês de destino tiver menos dias (ex: 31 de janeiro -> 28/29 de fevereiro)
    const daysInTargetMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const finalDay = Math.min(baseDay, daysInTargetMonth);
    const compDate = new Date(targetYear, targetMonth, finalDay);
    const compFormatted = Utilities.formatDate(compDate, CONFIG.TIMEZONE, "dd/MM/yyyy");

    const descricaoFinal = isParcelado 
      ? (descricaoBase ? `${descricaoBase} (${i}/${totalParcelas})` : `Parcela ${i}/${totalParcelas}`) 
      : descricaoBase;

    rowsToInsert.push([
      timestamp,
      compFormatted,
      escopo,
      subOrigem,
      tipoTransacao,
      categoria,
      descricaoFinal,
      valorUnitario,
      i,
      totalParcelas,
      idAgrupamento
    ]);
  }

  // Inserção em lote para alta performance
  const startRow = shRegistros.getLastRow() + 1;
  shRegistros.getRange(startRow, 1, rowsToInsert.length, rowsToInsert[0].length).setValues(rowsToInsert);

  return {
    linhasInseridas: rowsToInsert.length,
    idAgrupamento: idAgrupamento,
    totalParcelas: totalParcelas,
    valorPorParcela: valorUnitario,
    valorTotal: valorUnitario * totalParcelas
  };
}


/**
 * ============================================================================
 * ROTA: cadastrarCategoria
 * ============================================================================
 * Cadastra uma nova categoria em CAD_AUX se não existir.
 */
function actionCadastrarCategoria(payload) {
  const { shAux } = initializeSheets();

  const escopo = payload.escopo || "Pessoal";
  const tipoTransacao = payload.tipoTransacao || "Despesa";
  const categoriaNome = (payload.categoriaNome || "").trim();

  if (!categoriaNome) {
    throw new Error("Nome da categoria não pode ser vazio.");
  }

  // Verifica duplicidade existente
  const lastRow = shAux.getLastRow();
  if (lastRow > 1) {
    const data = shAux.getRange(2, 1, lastRow - 1, 3).getValues();
    for (let i = 0; i < data.length; i++) {
      const [e, t, nome] = data[i];
      if (
        String(e).toLowerCase() === escopo.toLowerCase() &&
        String(t).toLowerCase() === tipoTransacao.toLowerCase() &&
        String(nome).toLowerCase() === categoriaNome.toLowerCase()
      ) {
        return {
          jaExistia: true,
          mensagem: "Categoria já existe para este escopo e tipo.",
          categoria: categoriaNome
        };
      }
    }
  }

  shAux.appendRow([escopo, tipoTransacao, categoriaNome]);

  return {
    sucesso: true,
    jaExistia: false,
    mensagem: "Categoria cadastrada com sucesso.",
    categoria: categoriaNome,
    escopo: escopo,
    tipoTransacao: tipoTransacao
  };
}

/**
 * ============================================================================
 * ROTA: obterCategorias
 * ============================================================================
 * Retorna as categorias cadastradas na aba CAD_AUX.
 */
function actionObterCategorias(params) {
  const { shAux } = initializeSheets();
  const lastRow = shAux.getLastRow();

  if (lastRow <= 1) {
    return [];
  }

  const values = shAux.getRange(2, 1, lastRow - 1, 3).getValues();
  const categorias = [];

  for (let i = 0; i < values.length; i++) {
    const escopo = values[i][0];
    const tipo = values[i][1];
    const nome = values[i][2];

    if (nome) {
      categorias.push({
        escopo: String(escopo).trim(),
        tipoTransacao: String(tipo).trim(),
        nome: String(nome).trim()
      });
    }
  }

  return categorias;
}

/**
 * ============================================================================
 * ROTA: obterPrevisaoMesSeguinte
 * ============================================================================
 * Calcula a previsão de gastos para o mês selecionado e gera a projeção
 * para os próximos 6 meses (mês atual + 5 meses seguintes) somando:
 * 1. Parcelas/despesas na aba REGISTROS cuja competência caia no respectivo mês.
 * 2. Gastos Fixos ativos na aba GASTOS_FIXOS.
 * Filtros suportados: "Geral", "Pessoal", "Empresarial MT", "Empresarial MS".
 */
function actionObterPrevisaoMesSeguinte(params) {
  const { shRegistros } = initializeSheets();
  const filtro = (params && params.filtro ? params.filtro : "Geral").trim();

  // Determinar data base (fuso SP)
  const hoje = new Date();
  const mesAtual = hoje.getMonth(); // 0..11
  const anoAtual = hoje.getFullYear();

  // Construir matriz de 6 períodos (mês atual + 5 meses subsequentes)
  const periodos = [];
  for (let offset = 0; offset < 6; offset++) {
    const rawMes = mesAtual + offset;
    const mesIndex = rawMes % 12;
    const ano = anoAtual + Math.floor(rawMes / 12);
    const mesNumero = mesIndex + 1;
    const mesRef = (mesNumero < 10 ? "0" + mesNumero : String(mesNumero)) + "/" + ano;
    const mesesAbrev = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

    periodos.push({
      offset: offset,
      mesIndex: mesIndex,
      mesNumero: mesNumero,
      ano: ano,
      mesReferencia: mesRef,
      mesNome: getNomeMes(mesIndex) + " de " + ano,
      labelCurto: mesesAbrev[mesIndex] + "/" + String(ano).slice(-2),
      isAtual: offset === 0,
      isProximo: offset === 1,
      totalParcelasMes: 0,
      qtdParcelasMes: 0,
      totalFixosMes: 0,
      qtdFixosMes: 0,
      totalGastoPrevisto: 0
    });
  }

  // 1. Processar REGISTROS
  const lastRowRegistros = shRegistros.getLastRow();
  if (lastRowRegistros > 1) {
    const dadosReg = shRegistros.getRange(2, 1, lastRowRegistros - 1, CONFIG.SCHEMAS.REGISTROS.length).getValues();

    for (let i = 0; i < dadosReg.length; i++) {
      const compRaw = dadosReg[i][1]; // Competencia_Vencimento
      const escopo = String(dadosReg[i][2] || "").trim(); // Tipo_Escopo
      const subOrigem = String(dadosReg[i][3] || "").trim(); // Sub_Origem
      const tipoTransacao = String(dadosReg[i][4] || "").trim(); // Tipo_Transacao
      const valor = parseFloat(dadosReg[i][7]) || 0; // Valor

      // Apenas Despesas impactam o Gasto Previsto
      if (tipoTransacao.toLowerCase() !== "despesa") continue;
      if (!aplicarFiltroEscopo(filtro, escopo, subOrigem)) continue;

      // Parse da data de competência
      let compMes = null;
      let compAno = null;

      if (compRaw instanceof Date) {
        compMes = compRaw.getMonth() + 1;
        compAno = compRaw.getFullYear();
      } else if (typeof compRaw === "string") {
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
            periodos[p].totalParcelasMes += valor;
            periodos[p].qtdParcelasMes++;
            break;
          }
        }
      }
    }
  }

  // Consolidar totais em cada período
  for (let p = 0; p < periodos.length; p++) {
    periodos[p].totalFixosMes = 0;
    periodos[p].qtdFixosMes = 0;
    periodos[p].totalParcelasMes = Math.round(periodos[p].totalParcelasMes * 100) / 100;
    periodos[p].totalGastoPrevisto = periodos[p].totalParcelasMes;
  }

  // Determinar qual período entregar no nível principal
  // Por padrão, se nenhum parâmetro for passado, entrega o Próximo Mês (offset 1)
  let periodoSelecionado = periodos[1]; // Próximo mês

  if (params && params.offset !== undefined && params.offset !== null && params.offset !== "") {
    const off = parseInt(params.offset, 10);
    if (!isNaN(off) && off >= 0 && off < periodos.length) {
      periodoSelecionado = periodos[off];
    }
  } else if (params && params.mes && params.ano) {
    const targetMes = parseInt(params.mes, 10);
    const targetAno = parseInt(params.ano, 10);
    const match = periodos.find(p => p.mesNumero === targetMes && p.ano === targetAno);
    if (match) periodoSelecionado = match;
  }

  return {
    filtro: filtro,
    mesReferencia: periodoSelecionado.mesReferencia,
    mesNome: periodoSelecionado.mesNome,
    totalGastoPrevisto: periodoSelecionado.totalGastoPrevisto,
    totalParcelasMes: periodoSelecionado.totalParcelasMes,
    totalFixosMes: periodoSelecionado.totalFixosMes,
    qtdParcelasMes: periodoSelecionado.qtdParcelasMes,
    qtdFixosMes: periodoSelecionado.qtdFixosMes,
    offsetSelecionado: periodoSelecionado.offset,
    projecaoMeses: periodos
  };
}

/**
 * Valida se o registro atende ao filtro selecionado
 */
function aplicarFiltroEscopo(filtro, escopo, subOrigem) {
  if (!filtro || filtro === "Geral" || filtro === "Todos") {
    return true;
  }
  if (filtro === "Pessoal") {
    return escopo.toLowerCase() === "pessoal";
  }
  if (filtro === "Empresarial MT" || filtro === "MT") {
    return escopo.toLowerCase() === "empresarial" && subOrigem.indexOf("MT") !== -1;
  }
  if (filtro === "Empresarial MS" || filtro === "MS") {
    return escopo.toLowerCase() === "empresarial" && subOrigem.indexOf("MS") !== -1;
  }
  return true;
}

/**
 * Retorna o nome por extenso do mês
 */
function getNomeMes(indexMes) {
  const meses = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  return meses[indexMes] || "";
}

/**
 * ============================================================================
 * ROTA: obterRegistros
 * ============================================================================
 * Retorna os lançamentos da aba REGISTROS em ordem decrescente com base na Coluna A.
 * Filtra e entrega apenas:
 * - escopo (Coluna C: Pessoal ou Empresarial)
 * - categoria (Coluna F)
 * - valor (Coluna H)
 * - tipo (Coluna E: Despesa ou Receita para colorização)
 * - dataHora (Coluna A: para referência)
 */
function actionObterRegistros(params) {
  const { shRegistros } = initializeSheets();
  const lastRow = shRegistros.getLastRow();

  if (lastRow <= 1) {
    return [];
  }

  const values = shRegistros.getRange(2, 1, lastRow - 1, CONFIG.SCHEMAS.REGISTROS.length).getValues();
  const registros = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const dataHoraRaw = row[0]; // Coluna A: Data_Hora_Registro
    const escopo = String(row[2] || "").trim(); // Coluna C: Tipo_Escopo
    const tipoTransacao = String(row[4] || "").trim(); // Coluna E: Tipo_Transacao
    const categoria = String(row[5] || "").trim(); // Coluna F: Categoria
    const valor = parseFloat(row[7]) || 0; // Coluna H: Valor

    if (!escopo && !categoria && valor === 0) continue;

    let timestampMs = 0;
    let dataHoraFormatada = "";

    if (dataHoraRaw instanceof Date) {
      timestampMs = dataHoraRaw.getTime();
      dataHoraFormatada = Utilities.formatDate(dataHoraRaw, CONFIG.TIMEZONE, "dd/MM/yyyy HH:mm");
    } else if (typeof dataHoraRaw === "string" && dataHoraRaw.trim() !== "") {
      dataHoraFormatada = dataHoraRaw.trim();
      const match = dataHoraRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?/);
      if (match) {
        const dia = parseInt(match[1], 10);
        const mes = parseInt(match[2], 10) - 1;
        const ano = parseInt(match[3], 10);
        const hora = match[4] ? parseInt(match[4], 10) : 0;
        const min = match[5] ? parseInt(match[5], 10) : 0;
        const seg = match[6] ? parseInt(match[6], 10) : 0;
        timestampMs = new Date(ano, mes, dia, hora, min, seg).getTime();
      } else {
        const parsed = new Date(dataHoraRaw);
        timestampMs = !isNaN(parsed.getTime()) ? parsed.getTime() : i;
      }
    } else {
      timestampMs = i;
    }

    registros.push({
      _timestampMs: timestampMs,
      _rowIndex: i,
      dataHora: dataHoraFormatada,
      escopo: escopo,
      tipo: tipoTransacao,
      categoria: categoria,
      valor: valor
    });
  }

  // Ordenar em ordem decrescente com base na Coluna A
  registros.sort((a, b) => {
    if (b._timestampMs !== a._timestampMs) {
      return b._timestampMs - a._timestampMs;
    }
    return b._rowIndex - a._rowIndex;
  });

  return registros.map(item => ({
    dataHora: item.dataHora,
    escopo: item.escopo,
    tipo: item.tipo,
    categoria: item.categoria,
    valor: item.valor
  }));
}
