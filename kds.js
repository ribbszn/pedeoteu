// ================================
// CONFIGURATION
// ================================
const CONFIG = {
  firebaseConfig: {
    apiKey: "AIzaSyDFFbaZmX80QezLfozPAIaIGEhIJm9z43E",
    authDomain: "ribbsznmesas.firebaseapp.com",
    databaseURL: "https://ribbsznmesas-default-rtdb.firebaseio.com",
    projectId: "ribbsznmesas",
    storageBucket: "ribbsznmesas.firebasestorage.app",
    messagingSenderId: "970185571294",
    appId: "1:970185571294:web:25e8552bd72d852283bb4f",
  },
  menuDataUrl: "cardapio.json",
};

// ================================
// STATE MANAGEMENT
// ================================
const State = {
  database: null,
  orders: {},
  history: [],
  menuData: null,
  menuAvailability: {},
  soundEnabled: true,
  activeFilter: "all",
  beepIntervals: {}, // Controlar beeps para cada pedido
  acceptedOrders: {}, // Rastrear pedidos aceitos
};

// ================================
// FIREBASE INITIALIZATION
// ================================
function initFirebase() {
  try {
    if (typeof firebase === "undefined") {
      showToast("⚠️ Firebase não disponível", "error");
      updateStatus(false);
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(CONFIG.firebaseConfig);
    }

    State.database = firebase.database();
    updateStatus(true);
    console.log("✅ Firebase inicializado");

    // Iniciar listeners
    listenToOrders();
    loadMenuAvailability();
  } catch (error) {
    console.error("❌ Erro ao inicializar Firebase:", error);
    updateStatus(false);
    showToast("Erro ao conectar com Firebase", "error");
  }
}

// ================================
// STATUS INDICATOR
// ================================
function updateStatus(connected) {
  const statusDot = document.getElementById("firebase-status");
  const statusText = document.getElementById("status-text");

  if (connected) {
    statusDot.classList.add("connected");
    statusText.textContent = "Conectado";
  } else {
    statusDot.classList.remove("connected");
    statusText.textContent = "Desconectado";
  }
}

// ================================
// ORDERS LISTENER
// ================================
function listenToOrders() {
  if (!State.database) return;

  const ordersRef = State.database.ref("pedidos");

  // Listener para novos pedidos
  ordersRef.on("child_added", (snapshot) => {
    const order = snapshot.val();
    const orderId = snapshot.key;

    if (order.status === "pending") {
      State.orders[orderId] = { ...order, id: orderId };
      renderOrder(orderId, order, true);
      playNotificationSound();
      showToast(
        `🔔 Novo pedido: ${order.cliente || order.nomeCliente}`,
        "success",
      );
    }
  });

  // Listener para pedidos atualizados
  ordersRef.on("child_changed", (snapshot) => {
    const order = snapshot.val();
    const orderId = snapshot.key;

    if (order.status === "pending") {
      State.orders[orderId] = { ...order, id: orderId };
      renderOrder(orderId, order, false);
    } else {
      // Pedido foi finalizado ou cancelado
      removeOrderFromKDS(orderId);
      addToHistory(orderId, order);
    }
  });

  // Listener para pedidos removidos
  ordersRef.on("child_removed", (snapshot) => {
    const orderId = snapshot.key;
    removeOrderFromKDS(orderId);
  });
}

// ================================
// RENDER ORDER
// ================================
function renderOrder(orderId, order, isNew = false) {
  const tipo = order.tipo || order.tipoOrigem || "delivery";
  const containerId =
    tipo === "mesa" || tipo === "totem"
      ? "mesas-container"
      : "delivery-container";
  const container = document.getElementById(containerId);

  // Remover empty state se existir
  const emptyState = container.querySelector(".empty-state");
  if (emptyState) {
    emptyState.remove();
  }

  // Verificar se o pedido já existe
  let orderCard = document.getElementById(`order-${orderId}`);
  const isAccepted = State.acceptedOrders[orderId] === true;

  if (!orderCard) {
    orderCard = document.createElement("div");
    orderCard.className = `order-card ${isNew && !isAccepted ? "new-order pending-accept" : isAccepted ? "accepted" : ""}`;
    orderCard.id = `order-${orderId}`;
    container.appendChild(orderCard);

    // Iniciar beep se for novo e não aceito
    if (isNew && !isAccepted) {
      startBeep(orderId);
    }
  }

  // Formatar tempo
  const time =
    order.dataHora || new Date(order.timestamp).toLocaleString("pt-BR");

  // Renderizar adicionais e retiradas
  const renderExtras = (items) => {
    return items
      .map((item) => {
        let extrasHtml = "";

        if (item.adicionais && item.adicionais.length > 0) {
          extrasHtml += `<div class="item-obs">➕ Adicionais: ${item.adicionais.join(", ")}</div>`;
        }

        if (item.retiradas && item.retiradas.length > 0) {
          extrasHtml += `<div class="item-obs">➖ Sem: ${item.retiradas.join(", ")}</div>`;
        }

        return extrasHtml;
      })
      .join("");
  };

  // Criar HTML do pedido
  const acceptButton = !isAccepted
    ? `<button class="btn-order btn-accept" onclick="acceptOrder('${orderId}')">
         ✅ Aceitar Pedido
       </button>`
    : "";

  orderCard.innerHTML = `
    <div class="order-header">
      <span class="order-number">#${orderId.slice(-6).toUpperCase()}</span>
      <span class="order-time">${time}</span>
    </div>
    
    <div class="order-customer">
      👤 ${order.cliente || order.nomeCliente || order.nome || "Cliente"}
    </div>
    
    <div class="order-items">
      ${renderOrderItems(order.itens || [])}
    </div>
    
    <div class="order-details">
      ${order.modoConsumo ? `<div class="order-detail-row"><span>🍽️ Modo:</span><span>${order.modoConsumo}</span></div>` : ""}
      ${order.bairro ? `<div class="order-detail-row"><span>🏘️ Bairro:</span><span>${order.bairro}</span></div>` : ""}
      ${order.endereco ? `<div class="order-detail-row"><span>📍 Endereço:</span><span>${order.endereco}</span></div>` : ""}
      ${order.taxaEntrega ? `<div class="order-detail-row"><span>🛵 Taxa:</span><span>${formatPrice(order.taxaEntrega)}</span></div>` : ""}
      ${order.pagamento ? `<div class="order-detail-row"><span>💳 Pagamento:</span><span>${order.pagamento}</span></div>` : ""}
      ${order.troco ? `<div class="order-detail-row"><span>💵 Troco:</span><span>${order.troco}</span></div>` : ""}
      <div class="order-total">Total: ${formatPrice(order.total || 0)}</div>
    </div>
    
    <div class="order-actions">
      ${acceptButton}
      ${
        isAccepted
          ? `
      <div class="order-actions-row">
        <button class="btn-order btn-print-kitchen btn-small" onclick="printKitchen('${orderId}')">
          🖨️ Cozinha
        </button>
        <button class="btn-order btn-print-customer btn-small" onclick="printCustomer('${orderId}')">
          🧾 Cliente
        </button>
      </div>
      <div class="order-actions-row">
        <button class="btn-order btn-ready" onclick="completeOrder('${orderId}')">
          ✅ Concluir
        </button>
        <button class="btn-order btn-cancel" onclick="cancelOrder('${orderId}')">
          ❌ Cancelar
        </button>
      </div>
      `
          : ""
      }
    </div>
  `;

  // Atualizar contador
  updateOrderCount();

  // Remover classe new-order após animação
  if (isNew) {
    setTimeout(() => {
      orderCard.classList.remove("new-order");
    }, 2000);
  }
}

// ================================
// PARSE OBSERVATION (quebrar observação em detalhes)
// ================================
function parseObservationDetails(obs) {
  if (!obs) return [];

  const details = [];

  // Dividir por " | " para pegar cada parte
  const parts = obs.split(" | ");

  parts.forEach((part) => {
    const trimmed = part.trim();

    if (trimmed.includes("---")) {
      // Nome do produto (ex: "--- Smash Simples ---")
      details.push({ type: "name", text: trimmed });
    } else if (trimmed.toLowerCase().startsWith("ponto:")) {
      // Ponto da carne
      details.push({ type: "ponto", text: trimmed });
    } else if (trimmed.toLowerCase().startsWith("sem:")) {
      // Retiradas
      details.push({ type: "retiradas", text: trimmed });
    } else if (trimmed.toLowerCase().startsWith("adicionais:")) {
      // Adicionais
      details.push({ type: "adicionais", text: trimmed });
    } else if (trimmed) {
      // Qualquer outra observação
      details.push({ type: "other", text: trimmed });
    }
  });

  return details;
}

// ================================
// RENDER ORDER ITEMS
// ================================
function renderOrderItems(items) {
  if (!items || items.length === 0) {
    return '<div class="order-item"><span class="item-name">Sem itens</span></div>';
  }

  return items
    .map((item) => {
      const qty = item.quantidade || item.qtd || 1;
      const name = item.nome || "Item";
      const obs = item.observacao || "";
      const adicionais = item.adicionais || [];
      const retiradas = item.retiradas || [];
      const ponto = item.ponto || "";

      // Construir detalhes do item em linhas separadas
      let detalhesHtml = "";

      // Se tem observação, tentar parsear ela primeiro
      if (obs) {
        const parsedDetails = parseObservationDetails(obs);

        if (parsedDetails.length > 0) {
          // Se conseguiu parsear, usar os detalhes parseados
          parsedDetails.forEach((detail) => {
            let icon = "📝";

            if (detail.type === "name") {
              icon = "📝";
            } else if (detail.type === "ponto") {
              icon = "🔥";
            } else if (detail.type === "retiradas") {
              icon = "➖";
            } else if (detail.type === "adicionais") {
              icon = "➕";
            }

            detalhesHtml += `<div class="item-obs-line">${icon} ${detail.text}</div>`;
          });
        } else {
          // Se não conseguiu parsear, mostrar observação normal
          detalhesHtml += `<div class="item-obs-line">📝 ${obs}</div>`;
        }
      }

      // Ponto da carne (se vier como campo separado)
      if (ponto && !obs) {
        detalhesHtml += `<div class="item-obs-line">🔥 Ponto: ${ponto}</div>`;
      }

      // Retiradas (se vier como array separado)
      if (retiradas.length > 0 && !obs) {
        detalhesHtml += `<div class="item-obs-line">➖ Sem: ${retiradas.join(", ")}</div>`;
      }

      // Adicionais (se vier como array separado)
      if (adicionais.length > 0 && !obs) {
        detalhesHtml += `<div class="item-obs-line">➕ Adicionais: ${adicionais.join(", ")}</div>`;
      }

      return `
      <div class="order-item">
        <span class="item-qty">${qty}x</span>
        <div style="flex: 1;">
          <span class="item-name">${name}</span>
          ${detalhesHtml}
        </div>
      </div>
    `;
    })
    .join("");
}

// ================================
// COMPLETE ORDER
// ================================
async function completeOrder(orderId) {
  if (!State.database) return;

  try {
    await State.database.ref(`pedidos/${orderId}`).update({
      status: "completed",
      completedAt: Date.now(),
      completedTime: new Date().toLocaleString("pt-BR"),
    });

    showToast("✅ Pedido finalizado!", "success");
  } catch (error) {
    console.error("Erro ao finalizar pedido:", error);
    showToast("Erro ao finalizar pedido", "error");
  }
}

// ================================
// ACCEPT ORDER
// ================================
async function acceptOrder(orderId) {
  // Parar o beep
  stopBeep(orderId);

  // Marcar como aceito
  State.acceptedOrders[orderId] = true;

  // Re-renderizar o pedido
  const order = State.orders[orderId];
  if (order) {
    renderOrder(orderId, order, false);
  }

  showToast("✅ Pedido aceito!", "success");
}

// ================================
// PRINT KITCHEN
// ================================
function printKitchen(orderId) {
  const order = State.orders[orderId];
  if (!order) {
    showToast("Pedido não encontrado", "error");
    return;
  }

  // Criar conteúdo de impressão para cozinha
  let printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Pedido Cozinha - #${orderId.slice(-6).toUpperCase()}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Courier New', monospace; 
          padding: 20px; 
          max-width: 300px;
          font-size: 14px;
        }
        .header { 
          text-align: center; 
          border-bottom: 2px dashed #000; 
          padding-bottom: 10px; 
          margin-bottom: 15px;
          font-weight: bold;
        }
        .order-number { 
          font-size: 24px; 
          font-weight: bold; 
          margin: 10px 0;
        }
        .section { 
          margin: 15px 0; 
          border-bottom: 1px dashed #000; 
          padding-bottom: 10px;
        }
        .section-title { 
          font-weight: bold; 
          margin-bottom: 8px; 
          font-size: 16px;
        }
        .item { 
          margin: 8px 0; 
          padding-left: 10px;
        }
        .item-qty { 
          font-weight: bold; 
          display: inline-block; 
          width: 30px;
        }
        .item-obs { 
          margin-left: 40px; 
          margin-top: 4px;
          padding-left: 8px;
          border-left: 2px solid #333;
          padding: 3px 0 3px 8px;
          line-height: 1.5;
        }
        .footer { 
          text-align: center; 
          margin-top: 20px; 
          font-size: 12px;
        }
        @media print {
          body { padding: 10px; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        🔥 RIBBS ZN - COZINHA 🔥
        <div class="order-number">#${orderId.slice(-6).toUpperCase()}</div>
        <div>${order.dataHora || new Date().toLocaleString("pt-BR")}</div>
      </div>

      <div class="section">
        <div class="section-title">👤 Cliente</div>
        <div>${order.cliente || order.nomeCliente || order.nome || "Cliente"}</div>
      </div>

      ${
        order.modoConsumo
          ? `
      <div class="section">
        <div class="section-title">🍽️ Modo de Consumo</div>
        <div>${order.modoConsumo}</div>
      </div>
      `
          : ""
      }

      <div class="section">
        <div class="section-title">📋 ITENS DO PEDIDO</div>
  `;

  // Adicionar itens
  if (order.itens && order.itens.length > 0) {
    order.itens.forEach((item) => {
      const qty = item.quantidade || item.qtd || 1;
      const name = item.nome || "Item";
      const obs = item.observacao || "";
      const adicionais = item.adicionais || [];
      const retiradas = item.retiradas || [];
      const ponto = item.ponto || "";

      printContent += `
        <div class="item">
          <span class="item-qty">${qty}x</span>
          <strong>${name}</strong>
      `;

      // Parse da observação se existir
      if (obs) {
        const parsedDetails = parseObservationDetails(obs);

        if (parsedDetails.length > 0) {
          parsedDetails.forEach((detail) => {
            let prefix = "";

            if (detail.type === "name") {
              prefix = "📝";
            } else if (detail.type === "ponto") {
              prefix = "🔥";
            } else if (detail.type === "retiradas") {
              prefix = "➖";
            } else if (detail.type === "adicionais") {
              prefix = "➕";
            }

            printContent += `<div class="item-obs">${prefix} ${detail.text}</div>`;
          });
        } else {
          printContent += `<div class="item-obs">📝 ${obs}</div>`;
        }
      }

      // Campos separados (se não vier como observação)
      if (ponto && !obs) {
        printContent += `<div class="item-obs">🔥 Ponto: ${ponto}</div>`;
      }

      if (retiradas.length > 0 && !obs) {
        printContent += `<div class="item-obs">➖ SEM: ${retiradas.join(", ")}</div>`;
      }

      if (adicionais.length > 0 && !obs) {
        printContent += `<div class="item-obs">➕ ADICIONAR: ${adicionais.join(", ")}</div>`;
      }

      printContent += `</div>`;
    });
  }

  printContent += `
      </div>

      <div class="footer">
        ═══════════════════════<br>
        Pedido impresso: ${new Date().toLocaleString("pt-BR")}
      </div>

      <script>
        window.onload = function() {
          window.print();
          setTimeout(() => window.close(), 100);
        };
      </script>
    </body>
    </html>
  `;

  // Abrir janela de impressão
  const printWindow = window.open("", "_blank", "width=350,height=600");
  printWindow.document.write(printContent);
  printWindow.document.close();

  showToast("🖨️ Imprimindo pedido para cozinha", "success");
}

// ================================
// PRINT CUSTOMER
// ================================
function printCustomer(orderId) {
  const order = State.orders[orderId];
  if (!order) {
    showToast("Pedido não encontrado", "error");
    return;
  }

  // Criar conteúdo de impressão para cliente
  let printContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Comprovante - #${orderId.slice(-6).toUpperCase()}</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: 'Courier New', monospace; 
          padding: 20px; 
          max-width: 300px;
          font-size: 12px;
        }
        .header { 
          text-align: center; 
          border-bottom: 2px dashed #000; 
          padding-bottom: 10px; 
          margin-bottom: 15px;
        }
        .logo { 
          font-size: 18px; 
          font-weight: bold; 
          margin-bottom: 5px;
        }
        .order-number { 
          font-size: 20px; 
          font-weight: bold; 
          margin: 8px 0;
        }
        .section { 
          margin: 12px 0; 
          padding-bottom: 10px;
        }
        .item-line { 
          display: flex; 
          justify-content: space-between; 
          margin: 5px 0;
        }
        .item-obs { 
          margin-left: 15px; 
          font-size: 11px;
          margin-top: 4px;
          padding-left: 8px;
          border-left: 2px solid #666;
          padding: 3px 0 3px 8px;
          line-height: 1.5;
        }
        .total-section { 
          border-top: 2px dashed #000; 
          padding-top: 10px; 
          margin-top: 10px;
        }
        .total { 
          display: flex; 
          justify-content: space-between; 
          font-size: 16px; 
          font-weight: bold; 
          margin-top: 8px;
        }
        .footer { 
          text-align: center; 
          margin-top: 20px; 
          font-size: 11px;
          border-top: 1px dashed #000;
          padding-top: 10px;
        }
        @media print {
          body { padding: 10px; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="logo">🔥 RIBBS ZN 🔥</div>
        <div>Comprovante de Pedido</div>
        <div class="order-number">#${orderId.slice(-6).toUpperCase()}</div>
        <div>${order.dataHora || new Date().toLocaleString("pt-BR")}</div>
      </div>

      <div class="section">
        <div><strong>Cliente:</strong> ${order.cliente || order.nomeCliente || order.nome || "Cliente"}</div>
        ${order.modoConsumo ? `<div><strong>Modo:</strong> ${order.modoConsumo}</div>` : ""}
        ${order.endereco ? `<div><strong>Endereço:</strong> ${order.endereco}</div>` : ""}
      </div>

      <div class="section">
        <div style="border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 8px;">
          <strong>ITENS</strong>
        </div>
  `;

  // Calcular subtotal
  let subtotal = 0;

  // Adicionar itens
  if (order.itens && order.itens.length > 0) {
    order.itens.forEach((item) => {
      const qty = item.quantidade || item.qtd || 1;
      const name = item.nome || "Item";
      const price = item.preco || 0;
      const itemTotal = qty * price;
      subtotal += itemTotal;

      const obs = item.observacao || "";
      const adicionais = item.adicionais || [];
      const retiradas = item.retiradas || [];
      const ponto = item.ponto || "";

      printContent += `
        <div class="item-line">
          <span>${qty}x ${name}</span>
          <span>${formatPrice(itemTotal)}</span>
        </div>
      `;

      // Parse da observação se existir
      if (obs) {
        const parsedDetails = parseObservationDetails(obs);

        if (parsedDetails.length > 0) {
          parsedDetails.forEach((detail) => {
            let prefix = "";

            if (detail.type === "name") {
              prefix = "📝";
            } else if (detail.type === "ponto") {
              prefix = "🔥";
            } else if (detail.type === "retiradas") {
              prefix = "➖";
            } else if (detail.type === "adicionais") {
              prefix = "➕";
            }

            printContent += `<div class="item-obs">${prefix} ${detail.text}</div>`;
          });
        } else {
          printContent += `<div class="item-obs">📝 ${obs}</div>`;
        }
      }

      // Campos separados (se não vier como observação)
      if (ponto && !obs) {
        printContent += `<div class="item-obs">🔥 Ponto: ${ponto}</div>`;
      }

      if (retiradas.length > 0 && !obs) {
        printContent += `<div class="item-obs">➖ ${retiradas.join(", ")}</div>`;
      }

      if (adicionais.length > 0 && !obs) {
        printContent += `<div class="item-obs">➕ ${adicionais.join(", ")}</div>`;
      }
    });
  }

  printContent += `
      </div>

      <div class="total-section">
        ${order.pagamento ? `<div><strong>Pagamento:</strong> ${order.pagamento}</div>` : ""}
        ${order.troco ? `<div><strong>Troco para:</strong> ${order.troco}</div>` : ""}
        <div class="total">
          <span>TOTAL:</span>
          <span>${formatPrice(order.total || subtotal)}</span>
        </div>
      </div>

      <div class="footer">
        Obrigado pela preferência!<br>
        Volte sempre! 😊<br>
        ═══════════════════════<br>
        ${new Date().toLocaleString("pt-BR")}
      </div>

      <script>
        window.onload = function() {
          window.print();
          setTimeout(() => window.close(), 100);
        };
      </script>
    </body>
    </html>
  `;

  // Abrir janela de impressão
  const printWindow = window.open("", "_blank", "width=350,height=600");
  printWindow.document.write(printContent);
  printWindow.document.close();

  showToast("🧾 Imprimindo comprovante para cliente", "success");
}

// ================================
// BEEP CONTROL
// ================================
function startBeep(orderId) {
  if (!State.soundEnabled) return;

  // Parar beep existente se houver
  stopBeep(orderId);

  const beepAudio = document.getElementById("beep-sound");

  // Tocar o beep em loop
  beepAudio.currentTime = 0;
  beepAudio.play().catch((error) => {
    console.log("Não foi possível reproduzir beep:", error);
  });

  // Guardar referência
  State.beepIntervals[orderId] = beepAudio;
}

function stopBeep(orderId) {
  const beepAudio = document.getElementById("beep-sound");
  beepAudio.pause();
  beepAudio.currentTime = 0;

  // Remover referência
  delete State.beepIntervals[orderId];
}

// ================================
// CANCEL ORDER
// ================================
async function cancelOrder(orderId) {
  if (!State.database) return;

  if (!confirm("Tem certeza que deseja cancelar este pedido?")) {
    return;
  }

  try {
    await State.database.ref(`pedidos/${orderId}`).update({
      status: "cancelled",
      cancelledAt: Date.now(),
      cancelledTime: new Date().toLocaleString("pt-BR"),
    });

    showToast("❌ Pedido cancelado", "warning");
  } catch (error) {
    console.error("Erro ao cancelar pedido:", error);
    showToast("Erro ao cancelar pedido", "error");
  }
}

// ================================
// REMOVE ORDER FROM KDS
// ================================
function removeOrderFromKDS(orderId) {
  // Parar beep se estiver tocando
  stopBeep(orderId);

  // Limpar estado de aceito
  delete State.acceptedOrders[orderId];

  const orderCard = document.getElementById(`order-${orderId}`);
  if (orderCard) {
    orderCard.style.animation = "fadeOut 0.3s ease";
    setTimeout(() => {
      orderCard.remove();
      delete State.orders[orderId];
      updateOrderCount();
      checkEmptyStates();
    }, 300);
  }
}

// ================================
// UPDATE ORDER COUNT
// ================================
function updateOrderCount() {
  const mesasOrders = Object.values(State.orders).filter(
    (o) => o.tipo === "mesa" || o.tipo === "totem",
  );
  const deliveryOrders = Object.values(State.orders).filter(
    (o) => o.tipo === "delivery" || o.tipoOrigem === "delivery",
  );

  document.getElementById("mesas-count").textContent = mesasOrders.length;
  document.getElementById("delivery-count").textContent = deliveryOrders.length;
}

// ================================
// CHECK EMPTY STATES
// ================================
function checkEmptyStates() {
  const mesasContainer = document.getElementById("mesas-container");
  const deliveryContainer = document.getElementById("delivery-container");

  if (mesasContainer.children.length === 0) {
    mesasContainer.innerHTML =
      '<div class="empty-state"><p>Nenhum pedido de mesa/totem no momento</p></div>';
  }

  if (deliveryContainer.children.length === 0) {
    deliveryContainer.innerHTML =
      '<div class="empty-state"><p>Nenhum pedido de delivery no momento</p></div>';
  }
}

// ================================
// HISTORY
// ================================
function addToHistory(orderId, order) {
  State.history.unshift({ ...order, id: orderId });

  // Manter apenas últimos 100 pedidos no histórico
  if (State.history.length > 100) {
    State.history = State.history.slice(0, 100);
  }
}

function renderHistory() {
  const content = document.getElementById("history-content");
  const filter = State.activeFilter;

  let filteredHistory = State.history;

  if (filter === "today") {
    const today = new Date().setHours(0, 0, 0, 0);
    filteredHistory = State.history.filter((order) => {
      const orderDate = new Date(
        order.timestamp || order.completedAt || order.cancelledAt,
      ).setHours(0, 0, 0, 0);
      return orderDate === today;
    });
  } else if (filter === "week") {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    filteredHistory = State.history.filter((order) => {
      const orderTime =
        order.timestamp || order.completedAt || order.cancelledAt;
      return orderTime >= weekAgo;
    });
  }

  if (filteredHistory.length === 0) {
    content.innerHTML =
      '<div class="empty-state"><p>Nenhum pedido no histórico</p></div>';
    return;
  }

  content.innerHTML = filteredHistory
    .map((order) => {
      const statusClass =
        order.status === "completed" ? "completed" : "cancelled";
      const statusText =
        order.status === "completed" ? "✅ Finalizado" : "❌ Cancelado";
      const time =
        order.completedTime ||
        order.cancelledTime ||
        order.dataHora ||
        new Date(order.timestamp).toLocaleString("pt-BR");

      return `
      <div class="history-card ${statusClass}">
        <div class="order-header">
          <span class="order-number">#${order.id.slice(-6).toUpperCase()}</span>
          <span class="order-time">${time}</span>
        </div>
        <div class="order-customer">
          👤 ${order.cliente || order.nomeCliente || "Cliente"}
        </div>
        <div class="order-details">
          <div class="order-detail-row">
            <span>Status:</span>
            <span>${statusText}</span>
          </div>
          <div class="order-total">Total: ${formatPrice(order.total || 0)}</div>
        </div>
      </div>
    `;
    })
    .join("");
}

function loadHistoryFromFirebase() {
  if (!State.database) return;

  State.database
    .ref("pedidos")
    .orderByChild("status")
    .once("value")
    .then((snapshot) => {
      State.history = [];
      snapshot.forEach((child) => {
        const order = child.val();
        if (order.status === "completed" || order.status === "cancelled") {
          State.history.push({ ...order, id: child.key });
        }
      });

      // Ordenar por data mais recente
      State.history.sort((a, b) => {
        const timeA = a.completedAt || a.cancelledAt || a.timestamp || 0;
        const timeB = b.completedAt || b.cancelledAt || b.timestamp || 0;
        return timeB - timeA;
      });

      renderHistory();
    })
    .catch((error) => {
      console.error("Erro ao carregar histórico:", error);
    });
}

// ================================
// MENU MANAGEMENT
// ================================
async function loadMenuData() {
  try {
    const response = await fetch(CONFIG.menuDataUrl);
    if (!response.ok) throw new Error("Erro ao carregar cardápio");
    State.menuData = await response.json();
    renderMenuManagement();
  } catch (error) {
    console.error("Erro ao carregar cardápio:", error);
    showToast("Erro ao carregar cardápio", "error");
  }
}

function loadMenuAvailability() {
  if (!State.database) return;

  State.database.ref("menuAvailability").on("value", (snapshot) => {
    State.menuAvailability = snapshot.val() || {};
    if (State.menuData) {
      renderMenuManagement();
    }
  });
}

function renderMenuManagement() {
  const container = document.getElementById("menu-categories");

  if (!State.menuData) {
    container.innerHTML =
      '<div class="empty-state"><p>Carregando cardápio...</p></div>';
    return;
  }

  let availableCount = 0;
  let unavailableCount = 0;

  const html = Object.entries(State.menuData)
    .map(([category, items]) => {
      const itemsHtml = items
        .map((item) => {
          const itemKey = `${category}-${item.nome}`;
          const isAvailable = State.menuAvailability[itemKey] !== false;

          if (isAvailable) {
            availableCount++;
          } else {
            unavailableCount++;
          }

          const priceText = item.precoBase
            ? Array.isArray(item.precoBase)
              ? formatPrice(Math.min(...item.precoBase))
              : formatPrice(item.precoBase)
            : "Preço variável";

          return `
        <div class="menu-item ${isAvailable ? "" : "unavailable"}">
          <div class="menu-item-info">
            <div class="menu-item-name">${item.nome}</div>
            <div class="menu-item-price">${priceText}</div>
          </div>
          <div class="menu-item-toggle ${isAvailable ? "available" : ""}" 
               onclick="toggleMenuItem('${category}', '${item.nome}')">
          </div>
        </div>
      `;
        })
        .join("");

      return `
      <div class="menu-category">
        <div class="category-header-menu" onclick="toggleCategory(this)">
          <span class="category-name">${category}</span>
          <span class="category-toggle">▼</span>
        </div>
        <div class="category-items">
          ${itemsHtml}
        </div>
      </div>
    `;
    })
    .join("");

  container.innerHTML = html;

  // Atualizar contadores
  document.getElementById("available-count").textContent = availableCount;
  document.getElementById("unavailable-count").textContent = unavailableCount;
}

async function toggleMenuItem(category, itemName) {
  if (!State.database) return;

  const itemKey = `${category}-${itemName}`;
  const currentStatus = State.menuAvailability[itemKey] !== false;
  const newStatus = !currentStatus;

  try {
    await State.database.ref(`menuAvailability/${itemKey}`).set(newStatus);

    const statusText = newStatus ? "disponível" : "indisponível";
    showToast(`${itemName} marcado como ${statusText}`, "success");
  } catch (error) {
    console.error("Erro ao atualizar item:", error);
    showToast("Erro ao atualizar item", "error");
  }
}

function toggleCategory(element) {
  element.classList.toggle("active");
  const items = element.nextElementSibling;
  items.classList.toggle("active");
}

// ================================
// SEARCH MENU
// ================================
function setupMenuSearch() {
  const searchInput = document.getElementById("menu-search-input");

  searchInput.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    const menuItems = document.querySelectorAll(".menu-item");
    const categories = document.querySelectorAll(".menu-category");

    categories.forEach((category) => {
      const categoryItems = category.querySelectorAll(".menu-item");
      let hasVisibleItems = false;

      categoryItems.forEach((item) => {
        const itemName = item
          .querySelector(".menu-item-name")
          .textContent.toLowerCase();
        if (itemName.includes(query)) {
          item.style.display = "flex";
          hasVisibleItems = true;
        } else {
          item.style.display = "none";
        }
      });

      category.style.display = hasVisibleItems ? "block" : "none";

      // Expandir categorias com resultados
      if (hasVisibleItems && query) {
        const header = category.querySelector(".category-header-menu");
        const items = category.querySelector(".category-items");
        header.classList.add("active");
        items.classList.add("active");
      }
    });
  });
}

// ================================
// UI HELPERS
// ================================
function openHistorySidebar() {
  document.getElementById("history-sidebar").classList.add("active");
  document.getElementById("overlay").classList.add("active");
  loadHistoryFromFirebase();
}

function closeHistorySidebar() {
  document.getElementById("history-sidebar").classList.remove("active");
  document.getElementById("overlay").classList.remove("active");
}

function openMenuModal() {
  document.getElementById("menu-modal").classList.add("active");
  document.getElementById("overlay").classList.add("active");
  if (!State.menuData) {
    loadMenuData();
  }
}

function closeMenuModal() {
  document.getElementById("menu-modal").classList.remove("active");
  document.getElementById("overlay").classList.remove("active");
}

function toggleSound() {
  State.soundEnabled = !State.soundEnabled;
  const soundStatus = document.getElementById("sound-status");
  soundStatus.textContent = State.soundEnabled ? "Som: ON" : "Som: OFF";

  if (State.soundEnabled) {
    showToast("🔔 Som ativado", "success");
  } else {
    showToast("🔕 Som desativado", "warning");
  }
}

function playNotificationSound() {
  if (!State.soundEnabled) return;

  const audio = document.getElementById("notification-sound");
  audio.currentTime = 0;
  audio.play().catch((error) => {
    console.log("Não foi possível reproduzir som:", error);
  });
}

// ================================
// TOAST NOTIFICATIONS
// ================================
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ================================
// UTILITY FUNCTIONS
// ================================
function formatPrice(value) {
  return `R$ ${parseFloat(value).toFixed(2).replace(".", ",")}`;
}

// ================================
// EVENT LISTENERS
// ================================
function setupEventListeners() {
  // Header buttons
  document
    .getElementById("btn-history")
    .addEventListener("click", openHistorySidebar);
  document
    .getElementById("btn-menu-management")
    .addEventListener("click", openMenuModal);
  document.getElementById("btn-sound").addEventListener("click", toggleSound);

  // Close buttons
  document
    .getElementById("close-history")
    .addEventListener("click", closeHistorySidebar);
  document
    .getElementById("close-menu-modal")
    .addEventListener("click", closeMenuModal);
  document
    .getElementById("close-order-detail")
    ?.addEventListener("click", () => {
      document.getElementById("order-detail-modal").classList.remove("active");
      document.getElementById("overlay").classList.remove("active");
    });

  // Overlay
  document.getElementById("overlay").addEventListener("click", () => {
    closeHistorySidebar();
    closeMenuModal();
  });

  // History filters
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document
        .querySelectorAll(".filter-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      State.activeFilter = btn.dataset.filter;
      renderHistory();
    });
  });

  // Menu search
  setupMenuSearch();
}

// ================================
// INITIALIZATION
// ================================
function init() {
  console.log("🚀 Iniciando KDS...");
  initFirebase();
  setupEventListeners();
  checkEmptyStates();

  // Carregar dados do menu
  loadMenuData();

  console.log("✅ KDS inicializado");
}

// Iniciar quando DOM estiver pronto
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
