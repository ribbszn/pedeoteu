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
// UTILITY FUNCTIONS
// ================================
// Função auxiliar para gerar estilos de impressão inline
function getPrintStyles(type) {
  const baseStyles = `
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    @page {
      size: 58mm auto;
      margin: 0;
    }
    
    html, body {
      width: 80mm;
      margin: 0;
      padding: 0;
      font-family: "Courier New", monospace;
      font-size: ${type === "kitchen" ? "14px" : "12px"};
      color: #000;
      background: #fff;
    }
    
    body {
      padding: 10px;
      width: 100%;
      max-width: 80mm;
    }
    
    .header {
      text-align: center;
      border-bottom: 2px dashed #000;
      padding-bottom: 10px;
      margin-bottom: 15px;
      ${type === "kitchen" ? "font-weight: bold;" : ""}
    }
    
    .logo {
      font-size: 18px;
      font-weight: bold;
      margin-bottom: 5px;
    }
    
    .order-number {
      font-size: ${type === "kitchen" ? "24px" : "20px"};
      font-weight: bold;
      margin: ${type === "kitchen" ? "10px 0" : "8px 0"};
    }
    
    .section {
      margin: ${type === "kitchen" ? "15px 0" : "12px 0"};
      ${type === "kitchen" ? "border-bottom: 1px dashed #000;" : ""}
      padding-bottom: 10px;
      page-break-inside: avoid;
    }
    
    .section-title {
      font-weight: bold;
      margin-bottom: 8px;
      font-size: 16px;
    }
    
    .item {
      margin: 8px 0;
      padding-left: 10px;
      page-break-inside: avoid;
    }
    
    .item-qty {
      font-weight: bold;
      display: inline-block;
      width: 30px;
    }
    
    .item-line {
      display: flex;
      justify-content: space-between;
      margin: 5px 0;
    }
    
    .item-obs {
      margin-left: ${type === "kitchen" ? "40px" : "15px"};
      font-size: 11px;
      margin-top: 4px;
      padding-left: 8px;
      border-left: 2px solid ${type === "kitchen" ? "#333" : "#666"};
      padding: 3px 0 3px 8px;
      line-height: 1.5;
    }
    
    .total-section {
      border-top: 2px dashed #000;
      padding-top: 10px;
      margin-top: 10px;
      page-break-inside: avoid;
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
      margin-bottom: 20px;
      font-size: ${type === "kitchen" ? "12px" : "11px"};
      ${type === "customer" ? "border-top: 1px dashed #000; padding-top: 10px;" : ""}
      page-break-inside: avoid;
    }
    
    .print-section-divider {
      margin: 8px 0;
    }
  `;

  return baseStyles;
}

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
}

function renderOrderItems(items) {
  if (!items || items.length === 0) {
    return '<div class="empty-state">Nenhum item no pedido</div>';
  }

  return items
    .map((item) => {
      const qty = item.quantidade || item.qtd || 1;
      const name = item.nome || "Item";
      const obs = item.observacao || "";

      let obsHtml = "";

      // Parse observation details if exists
      if (obs) {
        const details = parseObservationDetails(obs);
        if (details && details.length > 0) {
          obsHtml = details
            .map((detail) => `<div class="item-obs-line">${detail.text}</div>`)
            .join("");
        } else {
          obsHtml = `<div class="item-obs-line">${obs}</div>`;
        }
      }

      return `
      <div class="order-item">
        <span class="item-qty">${qty}x</span>
        <span class="item-name">${name}</span>
      </div>
      ${obsHtml}
    `;
    })
    .join("");
}

// Parse observation details
function parseObservationDetails(obs) {
  if (!obs) return [];

  const details = [];
  const lines = obs
    .split(/\n|;/)
    .map((l) => l.trim())
    .filter(Boolean);

  lines.forEach((line) => {
    let type = "other";
    let text = line;

    if (line.match(/ponto|mal passad|ao ponto|bem passad/i)) {
      type = "ponto";
    } else if (line.match(/sem |retirar|tirar/i)) {
      type = "retiradas";
    } else if (line.match(/adicionar|add |com /i)) {
      type = "adicionais";
    } else if (line.match(/nome:|^\w+:/i)) {
      type = "name";
    }

    details.push({ type, text });
  });

  return details;
}

function formatPrice(value) {
  const num = parseFloat(value) || 0;
  return `R$ ${num.toFixed(2).replace(".", ",")}`;
}

function formatTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ================================
// ACCEPT ORDER
// ================================
async function acceptOrder(orderId) {
  if (!State.database) return;

  try {
    // Marcar como aceito no estado local
    State.acceptedOrders[orderId] = true;

    // Parar o beep
    stopBeep(orderId);

    // Re-renderizar o pedido
    const order = State.orders[orderId];
    if (order) {
      renderOrder(orderId, order, false);
    }

    // Atualizar widget de pedidos em preparo
    updateInProgressWidget();

    showToast("✅ Pedido aceito e em preparo", "success");
  } catch (error) {
    console.error("Erro ao aceitar pedido:", error);
    showToast("Erro ao aceitar pedido", "error");
  }
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

    showToast("✅ Pedido concluído", "success");
  } catch (error) {
    console.error("Erro ao finalizar pedido:", error);
    showToast("Erro ao finalizar pedido", "error");
  }
}

// ================================
// PRINT KITCHEN - VERSÃO MELHORADA
// ================================
async function printKitchen(orderId) {
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
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pedido Cozinha - #${orderId.slice(-6).toUpperCase()}</title>
      <style>
        ${getPrintStyles("kitchen")}
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
        ${new Date().toLocaleString("pt-BR")}
      </div>

      <script>
        window.onload = function() {
          setTimeout(() => {
            window.print();
            setTimeout(() => window.close(), 500);
          }, 250);
        };
      </script>
    </body>
    </html>
  `;

  // Abrir janela de impressão
  const printWindow = window.open("", "_blank", "width=350,height=600");
  if (printWindow) {
    printWindow.document.write(printContent);
    printWindow.document.close();
  }

  showToast("🖨️ Imprimindo pedido para cozinha", "success");
}

// ================================
// PRINT CUSTOMER - VERSÃO MELHORADA
// ================================
async function printCustomer(orderId) {
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
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Comprovante - #${orderId.slice(-6).toUpperCase()}</title>
      <style>
        ${getPrintStyles("customer")}
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
        <div class="print-section-divider">
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
        ═══════════════════════<br>
        ${new Date().toLocaleString("pt-BR")}
      </div>

      <script>
        window.onload = function() {
          setTimeout(() => {
            window.print();
            setTimeout(() => window.close(), 500);
          }, 250);
        };
      </script>
    </body>
    </html>
  `;

  // Abrir janela de impressão
  const printWindow = window.open("", "_blank", "width=350,height=600");
  if (printWindow) {
    printWindow.document.write(printContent);
    printWindow.document.close();
  }

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
    orderCard.classList.add("fade-out-animation");
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
        .map((item, itemIndex) => {
          const itemKey = `${category}-${item.nome}`;
          const isAvailable = State.menuAvailability[itemKey] !== false;

          if (isAvailable) {
            availableCount++;
          } else {
            unavailableCount++;
          }

          // Gerar campos de preço editáveis
          let priceEditorHtml = "";

          if (item.precoBase) {
            if (Array.isArray(item.precoBase)) {
              // Múltiplos preços (ex: Simples, Duplo, Triplo)
              const opcoes = item.opcoes || [];
              priceEditorHtml = item.precoBase
                .map((price, priceIndex) => {
                  const optionName =
                    opcoes[priceIndex] || `Opção ${priceIndex + 1}`;
                  const inputId = `price-${category}-${itemIndex}-${priceIndex}`;
                  return `
                    <div class="menu-item-price-editor">
                      <strong class="price-label">${optionName}:</strong>
                      <div class="price-input-wrapper">
                        <span class="price-currency">R$</span>
                        <input 
                          type="number" 
                          step="0.01" 
                          min="0" 
                          class="price-input" 
                          id="${inputId}"
                          value="${price.toFixed(2)}"
                          data-category="${category}"
                          data-item-name="${item.nome}"
                          data-price-index="${priceIndex}"
                          data-original-value="${price.toFixed(2)}"
                          onchange="handlePriceChange(this)"
                        />
                      </div>
                      <button 
                        class="btn-save-price" 
                        id="save-${inputId}"
                        onclick="savePriceChange('${category}', '${item.nome}', ${priceIndex}, '${inputId}')"
                      >
                        💾 Salvar
                      </button>
                      <span class="price-save-indicator" id="indicator-${inputId}">✓</span>
                    </div>
                  `;
                })
                .join("");
            } else {
              // Preço único
              const inputId = `price-${category}-${itemIndex}-0`;
              priceEditorHtml = `
                <div class="menu-item-price-editor">
                  <strong class="price-label-short">Preço:</strong>
                  <div class="price-input-wrapper">
                    <span class="price-currency">R$</span>
                    <input 
                      type="number" 
                      step="0.01" 
                      min="0" 
                      class="price-input" 
                      id="${inputId}"
                      value="${item.precoBase.toFixed(2)}"
                      data-category="${category}"
                      data-item-name="${item.nome}"
                      data-price-index="0"
                      data-original-value="${item.precoBase.toFixed(2)}"
                      onchange="handlePriceChange(this)"
                    />
                  </div>
                  <button 
                    class="btn-save-price" 
                    id="save-${inputId}"
                    onclick="savePriceChange('${category}', '${item.nome}', null, '${inputId}')"
                  >
                    💾 Salvar
                  </button>
                  <span class="price-save-indicator" id="indicator-${inputId}">✓</span>
                </div>
              `;
            }
          }

          const priceText = item.precoBase
            ? Array.isArray(item.precoBase)
              ? formatPrice(Math.min(...item.precoBase))
              : formatPrice(item.precoBase)
            : "Preço variável";

          return `
        <div class="menu-item ${isAvailable ? "" : "unavailable"}">
          <div class="menu-item-header">
            <div class="menu-item-info">
              <div class="menu-item-name">${item.nome}</div>
              <div class="menu-item-price">${priceText}</div>
            </div>
            <div class="menu-item-controls">
              <div class="menu-item-toggle ${isAvailable ? "available" : ""}" 
                   onclick="toggleMenuItem('${category}', '${item.nome}')">
              </div>
            </div>
          </div>
          ${priceEditorHtml}
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
  items.style.display = items.style.display === "none" ? "block" : "none";
}

function handlePriceChange(input) {
  const saveButton = document.getElementById(`save-${input.id}`);
  const indicator = document.getElementById(`indicator-${input.id}`);

  if (saveButton && indicator) {
    const hasChanged =
      parseFloat(input.value) !== parseFloat(input.dataset.originalValue);
    saveButton.style.display = hasChanged ? "inline-block" : "none";
    indicator.style.display = hasChanged ? "none" : "inline";
  }
}

async function savePriceChange(category, itemName, priceIndex, inputId) {
  const input = document.getElementById(inputId);
  const saveButton = document.getElementById(`save-${inputId}`);
  const indicator = document.getElementById(`indicator-${inputId}`);

  if (!input || !State.menuData || !State.database) {
    showToast("❌ Erro: dados não encontrados", "error");
    return;
  }

  const newPrice = parseFloat(input.value);

  if (isNaN(newPrice) || newPrice < 0) {
    showToast("❌ Preço inválido!", "error");
    return;
  }

  // Desabilitar botão e mostrar loading
  if (saveButton) {
    saveButton.disabled = true;
    saveButton.textContent = "⏳ Salvando...";
  }

  try {
    // Encontrar o item no State.menuData
    const categoryItems = State.menuData[category];
    if (!categoryItems) {
      throw new Error("Categoria não encontrada");
    }

    const item = categoryItems.find((i) => i.nome === itemName);
    if (!item) {
      throw new Error("Item não encontrado");
    }

    // Atualizar preço localmente primeiro
    if (priceIndex !== null && Array.isArray(item.precoBase)) {
      item.precoBase[priceIndex] = newPrice;
    } else {
      item.precoBase = newPrice;
    }

    // Salvar no Firebase
    const itemPath = `cardapio/${category}`;
    const updatedItems = categoryItems;

    await State.database.ref(itemPath).set(updatedItems);

    // Atualizar valor original
    input.dataset.originalValue = newPrice.toFixed(2);

    // Mostrar indicador de sucesso
    if (saveButton && indicator) {
      saveButton.style.display = "none";
      indicator.style.display = "inline";
    }

    // Atualizar renderização
    renderMenuManagement();

    showToast(`💰 Preço de "${itemName}" atualizado com sucesso!`, "success");
  } catch (error) {
    console.error("Erro ao salvar preço:", error);
    showToast(`❌ Erro ao salvar preço: ${error.message}`, "error");

    // Reabilitar botão em caso de erro
    if (saveButton) {
      saveButton.disabled = false;
      saveButton.textContent = "💾 Salvar";
    }
  }
}

// ================================
// IN-PROGRESS WIDGET
// ================================

// Inicializar widget
function initInProgressWidget() {
  console.log("🔧 Inicializando widget Em Preparo...");

  const header = document.getElementById("in-progress-header");
  const dropdown = document.getElementById("in-progress-dropdown");

  if (!header || !dropdown) {
    console.error("❌ Elementos do widget não encontrados");
    return;
  }

  header.addEventListener("click", function () {
    header.classList.toggle("expanded");
    dropdown.classList.toggle("show");
    console.log("📂 Widget expandido:", dropdown.classList.contains("show"));
  });

  // Atualizar widget inicial
  updateInProgressWidget();
  console.log("✅ Widget Em Preparo inicializado");
}

// Atualizar lista de pedidos em preparo
function updateInProgressWidget() {
  const countElement = document.getElementById("in-progress-count");
  const listElement = document.getElementById("in-progress-list");

  if (!countElement || !listElement) {
    console.warn("⚠️ Elementos do widget não encontrados");
    return;
  }

  // Filtrar pedidos em preparo
  const inProgressOrders = Object.entries(State.orders)
    .filter(([id, order]) => {
      const isAccepted = State.acceptedOrders[id] === true;
      const isPending = order.status === "pending";
      return isAccepted && isPending;
    })
    .map(([id, order]) => ({ id, ...order }));

  console.log(
    `📊 Pedidos em preparo: ${inProgressOrders.length}`,
    inProgressOrders,
  );

  // Atualizar contador
  countElement.textContent = inProgressOrders.length;

  // Renderizar lista
  if (inProgressOrders.length === 0) {
    listElement.innerHTML = `
      <div class="empty-state-inline">
        <p>Nenhum pedido em preparo</p>
      </div>
    `;
  } else {
    // Ordenar por timestamp (mais antigo primeiro)
    inProgressOrders.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

    listElement.innerHTML = inProgressOrders
      .map((order) => renderInProgressOrder(order))
      .join("");
  }
}

// Renderizar pedido individual
function renderInProgressOrder(order) {
  const orderNumber = order.numeroPedido || order.id.substring(0, 8);
  const customer = order.cliente || order.nomeCliente || "Cliente";
  const time = order.timestamp ? formatTime(order.timestamp) : "";
  const items = order.itens || order.items || [];

  const itemsHTML = items
    .map((item) => {
      const qty = item.quantidade || item.qtd || 1;
      const name = item.nome || "Item";
      const obs = item.observacao || "";
      const adicionais = item.adicionais || [];
      const retiradas = item.retiradas || [];
      const ponto = item.ponto || "";

      // Verificar se tem modificações
      const hasMods =
        obs || adicionais.length > 0 || retiradas.length > 0 || ponto;
      const modClass = hasMods ? "has-mods" : "";

      // Construir HTML de modificações
      let modsHTML = "";
      if (hasMods) {
        const modsParts = [];

        // Ponto da carne
        if (ponto) {
          modsParts.push(
            `<div class="in-progress-mod in-progress-mod-obs">Ponto: ${ponto}</div>`,
          );
        }

        // Retiradas
        if (retiradas.length > 0) {
          retiradas.forEach((ret) => {
            const retName = typeof ret === "string" ? ret : ret.nome || ret;
            modsParts.push(
              `<div class="in-progress-mod in-progress-mod-remove">Sem ${retName}</div>`,
            );
          });
        }

        // Adicionais
        if (adicionais.length > 0) {
          adicionais.forEach((add) => {
            const addName = typeof add === "string" ? add : add.nome || add;
            modsParts.push(
              `<div class="in-progress-mod in-progress-mod-add">+ ${addName}</div>`,
            );
          });
        }

        // Observações do texto
        if (obs) {
          try {
            const details = parseObservationDetails(obs);
            details.forEach((detail) => {
              if (detail.type === "retiradas" && retiradas.length === 0) {
                modsParts.push(
                  `<div class="in-progress-mod in-progress-mod-remove">${detail.text}</div>`,
                );
              } else if (
                detail.type === "adicionais" &&
                adicionais.length === 0
              ) {
                modsParts.push(
                  `<div class="in-progress-mod in-progress-mod-add">${detail.text}</div>`,
                );
              } else if (detail.type === "ponto" && !ponto) {
                modsParts.push(
                  `<div class="in-progress-mod in-progress-mod-obs">${detail.text}</div>`,
                );
              } else if (detail.type === "other") {
                modsParts.push(
                  `<div class="in-progress-mod in-progress-mod-obs">${detail.text}</div>`,
                );
              }
            });
          } catch (e) {
            // Se parseObservationDetails não existir ou falhar, mostrar obs como está
            modsParts.push(
              `<div class="in-progress-mod in-progress-mod-obs">${obs}</div>`,
            );
          }
        }

        if (modsParts.length > 0) {
          modsHTML = `<div class="in-progress-item-mods">${modsParts.join("")}</div>`;
        }
      }

      return `
      <div class="in-progress-item ${modClass}">
        <span class="in-progress-item-qty">${qty}x</span>
        <span class="in-progress-item-name">${name}</span>
        ${modsHTML}
      </div>
    `;
    })
    .join("");

  return `
    <div class="in-progress-order">
      <div class="in-progress-order-header">
        <span class="in-progress-order-number">#${orderNumber}</span>
        <span class="in-progress-order-time">${time}</span>
      </div>
      <div class="in-progress-order-customer">${customer}</div>
      <div class="in-progress-order-items">
        ${itemsHTML}
      </div>
    </div>
  `;
}

// Sobrescrever funções originais para atualizar widget
(function () {
  // Guardar referências originais
  const _acceptOrder = window.acceptOrder;
  const _completeOrder = window.completeOrder;
  const _cancelOrder = window.cancelOrder;

  // Sobrescrever acceptOrder
  window.acceptOrder = async function (orderId) {
    console.log("✅ Aceitando pedido:", orderId);
    await _acceptOrder.call(this, orderId);
    setTimeout(() => {
      updateInProgressWidget();
    }, 200);
  };

  // Sobrescrever completeOrder
  window.completeOrder = async function (orderId) {
    console.log("🏁 Completando pedido:", orderId);
    await _completeOrder.call(this, orderId);
    setTimeout(() => {
      updateInProgressWidget();
    }, 200);
  };

  // Sobrescrever cancelOrder
  window.cancelOrder = async function (orderId) {
    console.log("❌ Cancelando pedido:", orderId);
    await _cancelOrder.call(this, orderId);
    setTimeout(() => {
      updateInProgressWidget();
    }, 200);
  };

  console.log("🔄 Funções de pedido sobrescritas com sucesso");
})();

// ================================
// SOUND & NOTIFICATIONS
// ================================
function playNotificationSound() {
  if (!State.soundEnabled) return;

  const audio = document.getElementById("notification-sound");
  if (audio) {
    audio.currentTime = 0;
    audio.play().catch((error) => {
      console.log("Não foi possível reproduzir som:", error);
    });
  }
}

function toggleSound() {
  State.soundEnabled = !State.soundEnabled;
  const statusEl = document.getElementById("sound-status");
  if (statusEl) {
    statusEl.textContent = `Som: ${State.soundEnabled ? "ON" : "OFF"}`;
  }

  // Se desligou o som, parar todos os beeps
  if (!State.soundEnabled) {
    Object.keys(State.beepIntervals).forEach((orderId) => {
      stopBeep(orderId);
    });
  }
}

// ================================
// TOAST NOTIFICATIONS
// ================================
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ================================
// UI INITIALIZATION
// ================================
function initUI() {
  // Botão de gestão de cardápio
  const btnMenuManagement = document.getElementById("btn-menu-management");
  if (btnMenuManagement) {
    btnMenuManagement.addEventListener("click", () => {
      const modal = document.getElementById("menu-modal");
      const overlay = document.getElementById("overlay");
      if (modal && overlay) {
        modal.classList.add("show");
        overlay.classList.add("show");
        loadMenuData();
      }
    });
  }

  // Botão de histórico
  const btnHistory = document.getElementById("btn-history");
  if (btnHistory) {
    btnHistory.addEventListener("click", () => {
      const sidebar = document.getElementById("history-sidebar");
      const overlay = document.getElementById("overlay");
      if (sidebar && overlay) {
        sidebar.classList.add("show");
        overlay.classList.add("show");
        loadHistoryFromFirebase();
      }
    });
  }

  // Botão de som
  const btnSound = document.getElementById("btn-sound");
  if (btnSound) {
    btnSound.addEventListener("click", toggleSound);
  }

  // Fechar modais e sidebar
  const closeButtons = document.querySelectorAll(".btn-close");
  closeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".modal, .sidebar, .overlay").forEach((el) => {
        el.classList.remove("show");
      });
    });
  });

  // Overlay fecha modais e sidebar
  const overlay = document.getElementById("overlay");
  if (overlay) {
    overlay.addEventListener("click", () => {
      document.querySelectorAll(".modal, .sidebar, .overlay").forEach((el) => {
        el.classList.remove("show");
      });
    });
  }

  // Filtros de histórico
  const filterButtons = document.querySelectorAll(".filter-btn");
  filterButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      State.activeFilter = btn.dataset.filter;
      renderHistory();
    });
  });

  // Busca no cardápio
  const searchInput = document.getElementById("menu-search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      const query = e.target.value.toLowerCase();
      const items = document.querySelectorAll(".menu-item");

      items.forEach((item) => {
        const name = item
          .querySelector(".menu-item-name")
          ?.textContent.toLowerCase();
        if (name && name.includes(query)) {
          item.style.display = "";
        } else {
          item.style.display = "none";
        }
      });
    });
  }
}

// Inicializar quando DOM estiver pronto
(function () {
  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        initFirebase();
        initUI();
        setTimeout(initInProgressWidget, 1500);
      });
    } else {
      initFirebase();
      initUI();
      setTimeout(initInProgressWidget, 1500);
    }
  }

  init();
})();
