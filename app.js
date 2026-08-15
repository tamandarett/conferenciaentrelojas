// Variável global para armazenar a análise e permitir filtros sem reprocessamento
window.resultadosAuditoria = [];
let abaAtual = 'TODOS';
const STORAGE_KEY = 'auditoria_lojas_gix_v1';

// Inicialização: Verifica se há dados salvos no Local Storage ao carregar a página
document.addEventListener("DOMContentLoaded", () => {
    const dadosSalvos = localStorage.getItem(STORAGE_KEY);
    if (dadosSalvos) {
        try {
            window.resultadosAuditoria = JSON.parse(dadosSalvos);
            
            // Se houver dados, oculta o upload, exibe tabelas e carrega a aba "Todos"
            const uploadWrapper = document.getElementById('upload-wrapper');
            if(uploadWrapper) uploadWrapper.classList.add('collapsed');
            
            document.getElementById('dashboard-resumo').style.display = 'grid';
            document.getElementById('container-tabela').style.display = 'block';
            
            atualizarDashboard();
            mudarAba('TODOS');
        } catch (e) {
            console.error("Erro ao carregar dados locais", e);
        }
    }
});

function toggleSidebar() { 
    document.getElementById('mainSidebar').classList.toggle('collapsed'); 
}

// Recolhe ou expande o painel de Upload
function toggleUploadSection() {
    const wrapper = document.getElementById('upload-wrapper');
    if (wrapper) wrapper.classList.toggle('collapsed');
}

// Limpa os dados salvos no navegador e reseta a tela
function limparStorage() {
    localStorage.removeItem(STORAGE_KEY);
    window.resultadosAuditoria = [];
    limparTela();
    
    // Força o painel de upload a abrir novamente
    const wrapper = document.getElementById('upload-wrapper');
    if (wrapper) wrapper.classList.remove('collapsed');
}

// Controle das abas laterais
function mostrarNovaConferencia() {
    document.getElementById('view-nova-conferencia').style.display = 'block';
    document.getElementById('view-ajuda').style.display = 'none';
    
    document.getElementById('menu-nova').classList.add('active');
    document.getElementById('menu-ajuda').classList.remove('active');
    document.getElementById('titulo-pagina').innerText = 'Conferência de Operações entre Lojas';
}

function mostrarAjuda() {
    document.getElementById('view-nova-conferencia').style.display = 'none';
    document.getElementById('view-ajuda').style.display = 'block';
    
    document.getElementById('menu-nova').classList.remove('active');
    document.getElementById('menu-ajuda').classList.add('active');
    document.getElementById('titulo-pagina').innerText = 'Ajuda e Relatórios';
}

function customAlert(msg) { 
    document.getElementById('modalMessage').innerText = msg; 
    document.getElementById('customModal').style.display = 'flex'; 
}

function closeModal() { 
    document.getElementById('customModal').style.display = 'none'; 
}

function limparTela() {
    document.getElementById('file-vendas-in').value = '';
    document.getElementById('file-transf-in').value = '';
    document.getElementById('file-vendas-out').value = '';
    
    document.getElementById('dashboard-resumo').style.display = 'none';
    document.getElementById('container-tabela').style.display = 'none';
}

// Remove zeros à esquerda para garantir cruzamento exato
function normalizarCodigo(codigo) {
    if (!codigo) return "";
    let codStr = codigo.toString().trim();
    return codStr.replace(/^0+/, '') || '0';
}

function iniciarAnalise() {
    const fileVendasIn = document.getElementById('file-vendas-in').files[0];
    const fileTransfIn = document.getElementById('file-transf-in').files[0];
    const fileVendasOut = document.getElementById('file-vendas-out').files[0];
    
    if (!fileVendasIn && !fileTransfIn) {
        return customAlert("Carregue pelo menos um arquivo de entrada (Vendas de outras lojas ou Transferências).");
    }
    if (!fileVendasOut) {
        return customAlert("Carregue a Ficha de Estoque.");
    }

    const btn = document.getElementById('btnAnalisar');
    btn.disabled = true;
    btn.innerText = 'Processando...';

    let entradas = [];
    let saidas = [];
    const promises = [];

    if (fileVendasIn) {
        promises.push(lerCSV(fileVendasIn, 'VENDA INTERNA').then(data => entradas = entradas.concat(data)));
    }
    if (fileTransfIn) {
        promises.push(lerCSV(fileTransfIn, 'TRANSFERÊNCIA').then(data => entradas = entradas.concat(data)));
    }
    
    promises.push(lerCSV(fileVendasOut, 'FICHA ESTOQUE').then(data => saidas = data));

    Promise.all(promises).then(() => {
        executarCruzamento(entradas, saidas);
    }).catch(err => {
        console.error(err);
        customAlert("Erro crítico ao ler os arquivos. Verifique se o formato está correto.");
    }).finally(() => {
        btn.disabled = false;
        btn.innerText = 'Processar e Analisar Dados';
    });
}

function lerCSV(file, tipoOrigem) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            delimiter: ";",
            skipEmptyLines: 'greedy',
            encoding: "ISO-8859-1", 
            transformHeader: function(headerName, index) {
                let nomeLimpo = headerName.trim().toUpperCase();
                if (nomeLimpo === "" && index === 0) {
                    return "CLIENTELOJA"; 
                }
                return nomeLimpo;
            },
            complete: function(results) {
                const dataNormalizada = [];

                results.data.forEach(linha => {
                    linha.TIPO_ORIGEM = tipoOrigem;

                    if (tipoOrigem === 'FICHA ESTOQUE') {
                        if (linha.PRODUTO) {
                            const firstHyphenIndex = linha.PRODUTO.indexOf('-');
                            if (firstHyphenIndex !== -1) {
                                const rawCode = linha.PRODUTO.substring(0, firstHyphenIndex).trim();
                                linha.CÓDIGOPRODUTO = normalizarCodigo(rawCode);
                                linha['DESCRIÇÃO DO PRODUTO'] = linha.PRODUTO.substring(firstHyphenIndex + 1).trim();
                            } else {
                                linha.CÓDIGOPRODUTO = normalizarCodigo(linha.PRODUTO);
                            }
                        }
                        
                        linha.DATAEMISSÃO = linha.DATA || "";
                        
                        let valStr = linha.SAÍDA ? linha.SAÍDA.toString().replace(',', '.') : "0";
                        let qtdSaida = parseFloat(valStr) || 0;
                        linha.QUANTIDADE = Math.abs(qtdSaida);
                        
                        if (linha.QUANTIDADE > 0) {
                            dataNormalizada.push(linha);
                        }

                    } else {
                        let valStr = linha.QUANTIDADE ? linha.QUANTIDADE.toString().replace(',', '.') : "0";
                        linha.QUANTIDADE = parseFloat(valStr) || 0;
                        linha.CÓDIGOPRODUTO = normalizarCodigo(linha.CÓDIGOPRODUTO);
                        linha.EMP = linha.EMP ? linha.EMP.toString().trim() : "";
                        
                        dataNormalizada.push(linha);
                    }
                });

                const dadosValidos = dataNormalizada.filter(l => l.CÓDIGOPRODUTO && l.CÓDIGOPRODUTO !== "0" && l.CÓDIGOPRODUTO !== "NAN");
                resolve(dadosValidos);
            },
            error: function(err) {
                reject(err);
            }
        });
    });
}

function parseDataBR(dataStr) {
    if (!dataStr) return 0;
    const partes = dataStr.split('/');
    if (partes.length !== 3) return 0;
    return new Date(partes[2], partes[1] - 1, partes[0], 0, 0, 0).getTime();
}

function executarCruzamento(entradas, saidas) {
    const indexSaidas = {};
    
    saidas.forEach(s => {
        const cod = s.CÓDIGOPRODUTO;
        if (!indexSaidas[cod]) { indexSaidas[cod] = []; }
        s.dataTempo = parseDataBR(s.DATAEMISSÃO);
        indexSaidas[cod].push(s);
    });

    const resultados = [];
    const TRES_DIAS_MS = 3 * 24 * 60 * 60 * 1000; 

    entradas.forEach(entrada => {
        const cod = entrada.CÓDIGOPRODUTO;
        const dataEntradaTempo = parseDataBR(entrada.DATAEMISSÃO);
        const dataLimiteTempo = dataEntradaTempo + TRES_DIAS_MS; 
        
        let vendasCompativeis = [];
        let qtdLocalizada = 0;

        if (indexSaidas[cod]) {
            vendasCompativeis = indexSaidas[cod].filter(saida => {
                return saida.dataTempo >= dataEntradaTempo && saida.dataTempo <= dataLimiteTempo;
            });
            qtdLocalizada = vendasCompativeis.reduce((soma, venda) => soma + venda.QUANTIDADE, 0);
        }

        let status = '';
        if (qtdLocalizada === 0) {
            status = 'NAO_LOCALIZADO'; // Chave padronizada (sem acento)
        } else if (qtdLocalizada < entrada.QUANTIDADE) {
            status = 'PARCIAL';
        } else {
            status = 'ENCONTRADO';
        }

        resultados.push({
            id: Math.random().toString(36).substring(2, 10),
            entrada: entrada,
            statusSistema: status,         // Status original apontado pelo sistema
            statusManual: status,          // Status controlável via dropdown (inicia igual ao do sistema)
            qtdRecebida: entrada.QUANTIDADE,
            qtdLocalizada: qtdLocalizada,
            vendasVinculadas: vendasCompativeis,
            observacao: ''
        });
    });

    // Atualiza a variável global e salva no LocalStorage (substituindo dados antigos)
    window.resultadosAuditoria = resultados;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(window.resultadosAuditoria));
    
    // Atualiza interface
    atualizarDashboard();
    
    const uploadWrapper = document.getElementById('upload-wrapper');
    if(uploadWrapper) uploadWrapper.classList.add('collapsed');
    
    document.getElementById('dashboard-resumo').style.display = 'grid';
    document.getElementById('container-tabela').style.display = 'block';
    
    if (document.getElementById('filtro-conferir')) {
        document.getElementById('filtro-conferir').checked = false;
    }

    // Retorna para a aba TODOS sempre que rodar um novo arquivo
    mudarAba('TODOS');
}

// === CONTROLE DE ABAS E FILTROS ===
function mudarAba(aba) {
    abaAtual = aba;
    
    // Ajusta o visual dos botões da aba
    const botoes = document.querySelectorAll('.tab-btn');
    botoes.forEach(btn => {
        btn.classList.remove('active');
        const txt = btn.innerText.toUpperCase();
        if (aba === 'N_CONFERENCIA' && txt.includes('N CONFERENCIA')) btn.classList.add('active');
        else if (aba === 'DIVERGENCIA' && txt.includes('DIVERGÊNCIA')) btn.classList.add('active');
        else if (aba === 'NAO_LOCALIZADO' && txt.includes('NÃO LOCALIZADO')) btn.classList.add('active');
        else if (aba === 'PARCIAL' && txt.includes('PARCIAL')) btn.classList.add('active');
        else if (aba === 'ENCONTRADO' && txt.includes('ENCONTRADOS')) btn.classList.add('active');
        else if (aba === 'TODOS' && txt === 'TODOS') btn.classList.add('active');
    });

    aplicarFiltros();
}

function aplicarFiltros() {
    const chkConferir = document.getElementById('filtro-conferir');
    const apenasPendentes = chkConferir ? chkConferir.checked : false;
    
    let dadosFiltrados = window.resultadosAuditoria;
    
    // 1. Filtro da aba atual
    if (abaAtual !== 'TODOS') {
        dadosFiltrados = dadosFiltrados.filter(r => r.statusManual === abaAtual);
    }
    
    // 2. Filtro do checkbox extra (somente pendentes)
    if (apenasPendentes) {
        dadosFiltrados = dadosFiltrados.filter(r => r.statusManual === 'NAO_LOCALIZADO' || r.statusManual === 'PARCIAL');
    }
    
    renderizarTabela(dadosFiltrados);
}

// === INTERAÇÕES MANUAIS (Dropdown e Input) ===
function atualizarStatusManual(id, novoValor) {
    const item = window.resultadosAuditoria.find(r => r.id === id);
    if (item) {
        item.statusManual = novoValor;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(window.resultadosAuditoria));
        
        atualizarDashboard();
        aplicarFiltros(); // Re-aplica os filtros e tira o item da aba atual se necessário
    }
}

function atualizarObs(id, valor) {
    const item = window.resultadosAuditoria.find(r => r.id === id);
    if (item) {
        item.observacao = valor;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(window.resultadosAuditoria));
    }
}

// Atualiza contadores do topo baseado no status atual de cada item
function atualizarDashboard() {
    let t = window.resultadosAuditoria.length;
    let enc = 0, parc = 0, nLoc = 0;

    window.resultadosAuditoria.forEach(r => {
        if (r.statusManual === 'ENCONTRADO') enc++;
        else if (r.statusManual === 'PARCIAL') parc++;
        else if (r.statusManual === 'NAO_LOCALIZADO') nLoc++;
    });

    document.getElementById('res-total').innerText = t;
    if(document.getElementById('res-encontrados')) document.getElementById('res-encontrados').innerText = enc;
    if(document.getElementById('res-parciais')) document.getElementById('res-parciais').innerText = parc;
    if(document.getElementById('res-nao-localizados')) document.getElementById('res-nao-localizados').innerText = nLoc;
}

function renderizarTabela(dados) {
    const tbody = document.getElementById('corpo-tabela');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (dados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--label-color);">Nenhuma operação encontrada nesta aba ou com os filtros atuais.</td></tr>';
        return;
    }

    dados.forEach(item => {
        const e = item.entrada;
        
        // Define a cor e texto da badge com base no status do sistema
        let badgeClass = '';
        let textoStatusSistema = item.statusSistema;

        if (item.statusSistema === 'ENCONTRADO') badgeClass = 'badge-encontrado';
        else if (item.statusSistema === 'PARCIAL') badgeClass = 'badge-parcial';
        else if (item.statusSistema === 'NAO_LOCALIZADO') {
            badgeClass = 'badge-nao-localizado';
            textoStatusSistema = 'NÃO LOCALIZADO'; // Formatação visual com acento
        }
        
        // Trata a formatação de emp para exibir 02 - Documento
        let empFormatado = '';
        if (e.EMP) {
            empFormatado = e.EMP.padStart(2, '0') + ' - ';
        }
        const docExibicao = empFormatado + (e.DOCUMENTO || '');
        
        const tr = document.createElement('tr');
        tr.className = 'linha-tabela';
        tr.innerHTML = `
            <td><span class="status-badge ${badgeClass}">${textoStatusSistema}</span></td>
            <td>
                <div style="font-size:11px; color:var(--label-color);">${e.TIPO_ORIGEM}</div>
                <strong style="color:var(--gray-chumbo)">${docExibicao}</strong><br>
                <small>${e.DATAEMISSÃO || ''}</small>
            </td>
            <td>
                <strong style="color:var(--tamandare-red)">${e.CÓDIGOPRODUTO}</strong><br>
                <small style="color:var(--label-color)">${e['DESCRIÇÃO DO PRODUTO'] || ''}</small>
            </td>
            <td style="font-weight: bold; font-size: 15px; color: var(--gray-chumbo); text-align: center;">${item.qtdRecebida}</td>
            <td style="font-weight: bold; font-size: 15px; color: ${item.qtdLocalizada === item.qtdRecebida ? 'var(--status-pago)' : 'var(--tamandare-red)'}; text-align: center;">${item.qtdLocalizada}</td>
            <td>
                <select class="select-status" onchange="atualizarStatusManual('${item.id}', this.value)">
                    <option value="ENCONTRADO" ${item.statusManual === 'ENCONTRADO' ? 'selected' : ''}>Encontrado</option>
                    <option value="PARCIAL" ${item.statusManual === 'PARCIAL' ? 'selected' : ''}>Corresp. Parcial</option>
                    <option value="NAO_LOCALIZADO" ${item.statusManual === 'NAO_LOCALIZADO' ? 'selected' : ''}>Não Localizado</option>
                    <option value="DIVERGENCIA" ${item.statusManual === 'DIVERGENCIA' ? 'selected' : ''}>Divergência</option>
                    <option value="N_CONFERENCIA" ${item.statusManual === 'N_CONFERENCIA' ? 'selected' : ''}>N Conferencia</option>
                </select>
                <input type="text" class="input-obs" placeholder="Observação interna..." value="${item.observacao}" onchange="atualizarObs('${item.id}', this.value)">
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function exportarAuditoriaCSV() {
    if (!window.resultadosAuditoria || window.resultadosAuditoria.length === 0) {
        return customAlert("Não há dados para exportar.");
    }

    const dropdownLoja = document.getElementById('loja-selecionada');
    const lojaSelecionada = dropdownLoja ? dropdownLoja.options[dropdownLoja.selectedIndex].text : 'Loja';
    
    let csvContent = "LOJA_ANALISADA;TIPO_ENTRADA;DATA_ENTRADA;DOCUMENTO_ENTRADA;CODIGO_PRODUTO;DESCRICAO;QTD_RECEBIDA;STATUS_SISTEMA;QTD_LOCALIZADA;DOCS_SAIDA;STATUS_MANUAL;OBSERVACAO\n";

    window.resultadosAuditoria.forEach(r => {
        const e = r.entrada;
        const docsVenda = r.vendasVinculadas.map(v => v.DOCUMENTO).join(' | ');

        const obsLimpa = r.observacao.replace(/"/g, '""').replace(/\n/g, ' ');
        const descLimpa = e['DESCRIÇÃO DO PRODUTO'] ? e['DESCRIÇÃO DO PRODUTO'].replace(/"/g, '""') : '';
        
        let empFormatado = e.EMP ? e.EMP.padStart(2, '0') + ' - ' : '';
        let docExibicao = empFormatado + (e.DOCUMENTO || '');

        const linha = [
            `"${lojaSelecionada}"`,
            `"${e.TIPO_ORIGEM}"`,
            `"${e.DATAEMISSÃO || ''}"`,
            `"${docExibicao}"`,
            `"${e.CÓDIGOPRODUTO}"`,
            `"${descLimpa}"`,
            r.qtdRecebida,
            `"${r.statusSistema}"`,
            r.qtdLocalizada,
            `"${docsVenda}"`,
            `"${r.statusManual}"`,
            `"${obsLimpa}"`
        ];

        csvContent += linha.join(";") + "\n";
    });

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `Auditoria_${lojaSelecionada}_${new Date().toISOString().slice(0,10)}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
