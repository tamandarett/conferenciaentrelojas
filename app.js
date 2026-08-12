// Variável global para armazenar a análise e permitir filtros sem reprocessamento
window.resultadosAuditoria = [];

function toggleSidebar() { 
    document.getElementById('mainSidebar').classList.toggle('collapsed'); 
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
    
    window.resultadosAuditoria = [];
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
                        // Trata arquivos de entrada
                        let valStr = linha.QUANTIDADE ? linha.QUANTIDADE.toString().replace(',', '.') : "0";
                        linha.QUANTIDADE = parseFloat(valStr) || 0;
                        linha.CÓDIGOPRODUTO = normalizarCodigo(linha.CÓDIGOPRODUTO);
                        // Captura a loja de origem caso exista
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
    const resumo = { total: entradas.length, encontrado: 0, parcial: 0, naoLocalizado: 0 };
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
            status = 'NÃO LOCALIZADO';
            resumo.naoLocalizado++;
        } else if (qtdLocalizada < entrada.QUANTIDADE) {
            status = 'PARCIAL';
            resumo.parcial++;
        } else {
            status = 'ENCONTRADO';
            resumo.encontrado++;
        }

        resultados.push({
            id: Math.random().toString(36).substring(2, 10),
            entrada: entrada,
            status: status,
            qtdRecebida: entrada.QUANTIDADE,
            qtdLocalizada: qtdLocalizada,
            vendasVinculadas: vendasCompativeis,
            statusConferencia: 'Pendente',
            observacao: ''
        });
    });

    window.resultadosAuditoria = resultados;
    
    document.getElementById('res-total').innerText = resumo.total;
    document.getElementById('res-encontrados').innerText = resumo.encontrado;
    document.getElementById('res-parciais').innerText = resumo.parcial;
    document.getElementById('res-nao-localizados').innerText = resumo.naoLocalizado;
    
    document.getElementById('dashboard-resumo').style.display = 'grid';
    document.getElementById('container-tabela').style.display = 'block';
    
    document.getElementById('filtro-conferir').checked = false;
    renderizarTabela(resultados);
}

function aplicarFiltros() {
    const apenasPendentes = document.getElementById('filtro-conferir').checked;
    let dadosFiltrados = window.resultadosAuditoria;
    
    if (apenasPendentes) {
        dadosFiltrados = dadosFiltrados.filter(r => r.status === 'NÃO LOCALIZADO' || r.status === 'PARCIAL');
    }
    
    renderizarTabela(dadosFiltrados);
}

function renderizarTabela(dados) {
    const tbody = document.getElementById('corpo-tabela');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    if (dados.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--label-color);">Nenhuma operação encontrada com os filtros atuais.</td></tr>';
        return;
    }

    dados.forEach(item => {
        const e = item.entrada;
        
        let badgeClass = '';
        if (item.status === 'ENCONTRADO') badgeClass = 'badge-encontrado';
        else if (item.status === 'PARCIAL') badgeClass = 'badge-parcial';
        else badgeClass = 'badge-nao-localizado';
        
        // Trata a formatação de emp para exibir 02 - Documento
        let empFormatado = '';
        if (e.EMP) {
            empFormatado = e.EMP.padStart(2, '0') + ' - ';
        }
        const docExibicao = empFormatado + (e.DOCUMENTO || '');
        
        const tr = document.createElement('tr');
        tr.className = 'linha-tabela';
        tr.innerHTML = `
            <td><span class="status-badge ${badgeClass}">${item.status}</span></td>
            <td><strong>${e.DATAEMISSÃO || ''}</strong></td>
            <td><div style="font-size:11px; color:var(--label-color);">${e.TIPO_ORIGEM}</div><strong style="color:var(--gray-chumbo)">${docExibicao}</strong></td>
            <td>
                <strong style="color:var(--tamandare-red)">${e.CÓDIGOPRODUTO}</strong><br>
                <small style="color:var(--label-color)">${e['DESCRIÇÃO DO PRODUTO'] || ''}</small>
            </td>
            <td style="font-weight: bold; font-size: 15px; color: var(--gray-chumbo); text-align: center;">${item.qtdRecebida}</td>
            <td style="font-weight: bold; font-size: 15px; color: var(--gray-chumbo); text-align: center;">${item.qtdLocalizada}</td>
            <td>
                <select class="select-status" onchange="atualizarStatusConferencia('${item.id}', this.value)" style="background: var(--gray-light);">
                    <option value="Pendente" ${item.statusConferencia === 'Pendente' ? 'selected' : ''}>Pendente</option>
                    <option value="Correto" ${item.statusConferencia === 'Correto' ? 'selected' : ''}>Correto</option>
                    <option value="Lançamento Encontrado" ${item.statusConferencia === 'Lançamento Encontrado' ? 'selected' : ''}>Lanç. Encontrado</option>
                    <option value="Problema" ${item.statusConferencia === 'Problema' ? 'selected' : ''}>Problema / Divergência</option>
                    <option value="Justificativa" ${item.statusConferencia === 'Justificativa' ? 'selected' : ''}>Justificativa</option>
                </select>
                <input type="text" class="input-obs" placeholder="Observação interna..." value="${item.observacao}" onchange="atualizarObs('${item.id}', this.value)">
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function atualizarStatusConferencia(id, valor) {
    const item = window.resultadosAuditoria.find(r => r.id === id);
    if (item) item.statusConferencia = valor;
}

function atualizarObs(id, valor) {
    const item = window.resultadosAuditoria.find(r => r.id === id);
    if (item) item.observacao = valor;
}

function exportarAuditoriaCSV() {
    if (!window.resultadosAuditoria || window.resultadosAuditoria.length === 0) {
        return customAlert("Não há dados para exportar.");
    }

    const dropdownLoja = document.getElementById('loja-selecionada');
    const lojaSelecionada = dropdownLoja.options[dropdownLoja.selectedIndex].text;
    
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
            `"${r.status}"`,
            r.qtdLocalizada,
            `"${docsVenda}"`,
            `"${r.statusConferencia}"`,
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