// ================================
// CONFIGURATION
// ================================
const CONFIG = {
  whatsappNumber: "5581996469626",
  menuDataUrl: "cardapio.json",
  firebaseConfig: {
    apiKey: "AIzaSyDFFbaZmX80QezLfozPAIaIGEhIJm9z43E",
    authDomain: "ribbsznmesas.firebaseapp.com",
    databaseURL: "https://ribbsznmesas-default-rtdb.firebaseio.com",
    projectId: "ribbsznmesas",
    storageBucket: "ribbsznmesas.firebasestorage.app",
    messagingSenderId: "970185571294",
    appId: "1:970185571294:web:25e8552bd72d852283bb4f",
  },
};

// ================================
// FIREBASE INITIALIZATION
// ================================
let database = null;
let auth = null;

async function initFirebase() {
  try {
    if (typeof firebase === "undefined") {
      console.warn(
        "⚠️ Firebase não carregado - pedidos não serão enviados ao KDS",
      );
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(CONFIG.firebaseConfig);
    }

    database = firebase.database();
    auth = firebase.auth();

    // Fazer login anônimo para permitir escrita no Firebase
    await auth.signInAnonymously();
    console.log("✅ Firebase inicializado e autenticado anonimamente");
  } catch (error) {
    console.error("❌ Erro ao inicializar Firebase:", error);
  }
}

// ================================
// STATE MANAGEMENT
// ================================
const AppState = {
  cardapioData: null,
  cart: [],
  deliveryType: "pickup",
  deliveryFee: 0,
  selectedNeighborhood: null,

  // Disponibilidade de insumos
  ingredientsAvailability: {},
  paidExtrasAvailability: {},

  // Controle de combos
  isCombo: false,
  isFullCombo: false, // true para Combos com batata+bebida
  comboData: null,
  currentBurgerIndex: 0,
  comboItems: [],

  // Controle de steps
  currentStep: 0,
  stepsData: [],
  tempItem: {},
};

// ================================
// UTILITY FUNCTIONS
// ================================
const Utils = {
  sanitizeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },

  formatPrice(value) {
    return `R$ ${value.toFixed(2).replace(".", ",")}`;
  },

  getExtras(item) {
    return item.paidExtras || item.adicionais || item.extras || [];
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  },
};

function showToast(message) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// ================================
// DOM HELPERS
// ================================
const DOM = {
  get(selector) {
    return document.querySelector(selector);
  },

  getAll(selector) {
    return document.querySelectorAll(selector);
  },

  create(tag, className, attributes = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    return element;
  },

  elements: {
    get menuContainer() {
      return DOM.get("[data-menu-container]");
    },
    get searchInput() {
      return DOM.get("[data-search-input]");
    },
    get categoriesContainer() {
      return DOM.get("[data-categories-container]");
    },
    get modal() {
      return DOM.get("[data-modal]");
    },
    get modalTitle() {
      return DOM.get("[data-modal-title]");
    },
    get modalBody() {
      return DOM.get("[data-modal-body]");
    },
    get progressDots() {
      return DOM.get("[data-progress-dots]");
    },
    get btnBack() {
      return DOM.get("[data-btn-back]");
    },
    get btnNext() {
      return DOM.get("[data-btn-next]");
    },
    get sidebar() {
      return DOM.get("[data-sidebar]");
    },
    get cartItems() {
      return DOM.get("[data-cart-items]");
    },
    get totalCart() {
      return DOM.get("[data-total-cart]");
    },
    get cartCount() {
      return DOM.get("[data-cart-count]");
    },
    get overlay() {
      return DOM.get("[data-overlay]");
    },
    get checkoutForm() {
      return DOM.get("[data-checkout-form]");
    },
    get deliveryFields() {
      return DOM.get("[data-delivery-fields]");
    },
    get changeField() {
      return DOM.get("[data-change-field]");
    },
  },
};

// ================================
// API SERVICE
// ================================
const MenuService = {
  async loadMenu() {
    try {
      const response = await fetch(CONFIG.menuDataUrl);
      if (!response.ok) throw new Error("Erro ao carregar cardápio");
      return await response.json();
    } catch (error) {
      console.error("Erro ao carregar cardápio:", error);
      throw error;
    }
  },

  async checkAvailability(category, itemName) {
    if (!database) return true;

    try {
      const itemKey = `${category}-${itemName}`;
      const snapshot = await database
        .ref(`menuAvailability/${itemKey}`)
        .once("value");
      const isAvailable = snapshot.val();
      return isAvailable !== false;
    } catch (error) {
      console.error("Erro ao verificar disponibilidade:", error);
      return true;
    }
  },

  listenToAvailability() {
    if (!database) return;

    database.ref("menuAvailability").on("value", () => {
      // Recarregar o menu quando a disponibilidade mudar
      if (AppState.cardapioData) {
        MenuUI.render(AppState.cardapioData);
      }
    });
  },

  // Carregar disponibilidade de ingredientes e adicionais
  listenToIngredientsAvailability() {
    if (!database) return;

    // Listener para ingredientes
    database.ref("ingredientsAvailability").on("value", (snapshot) => {
      AppState.ingredientsAvailability = snapshot.val() || {};
      console.log("📦 Disponibilidade de ingredientes atualizada");
    });

    // Listener para adicionais pagos
    database.ref("paidExtrasAvailability").on("value", (snapshot) => {
      AppState.paidExtrasAvailability = snapshot.val() || {};
      console.log("💰 Disponibilidade de adicionais pagos atualizada");
    });
  },

  // ================================
  // PRICE SYNC FROM FIREBASE - NEW ADDITION
  // ================================
  listenToPriceChanges() {
    if (!database) return;

    database.ref("cardapio").on("value", (snapshot) => {
      const firebaseMenu = snapshot.val();
      if (!firebaseMenu || !AppState.cardapioData) return;

      let pricesUpdated = false;

      // Atualizar preços do cardápio local com os preços do Firebase
      Object.entries(firebaseMenu).forEach(([category, items]) => {
        if (AppState.cardapioData[category]) {
          items.forEach((firebaseItem, index) => {
            const localItem = AppState.cardapioData[category][index];
            if (localItem && firebaseItem.precoBase !== undefined) {
              // Verificar se o preço realmente mudou
              const oldPrice = JSON.stringify(localItem.precoBase);
              const newPrice = JSON.stringify(firebaseItem.precoBase);

              if (oldPrice !== newPrice) {
                localItem.precoBase = firebaseItem.precoBase;
                pricesUpdated = true;
                console.log(
                  `💰 Preço atualizado: ${localItem.nome} = ${Array.isArray(firebaseItem.precoBase) ? firebaseItem.precoBase.join(", ") : firebaseItem.precoBase}`,
                );
              }
            }
          });
        }
      });

      // Re-renderizar o menu com os novos preços apenas se houve mudança
      if (pricesUpdated && AppState.cardapioData) {
        MenuUI.render(AppState.cardapioData);
        showToast("💰 Preços atualizados!");
      }
    });
  },

  async syncPricesFromFirebase() {
    if (!database) return;

    try {
      const snapshot = await database.ref("cardapio").once("value");
      const firebaseMenu = snapshot.val();

      if (!firebaseMenu || !AppState.cardapioData) return;

      // Atualizar preços do cardápio local
      Object.entries(firebaseMenu).forEach(([category, items]) => {
        if (AppState.cardapioData[category]) {
          items.forEach((firebaseItem, index) => {
            const localItem = AppState.cardapioData[category][index];
            if (localItem && firebaseItem.precoBase !== undefined) {
              localItem.precoBase = firebaseItem.precoBase;
            }
          });
        }
      });

      console.log("✅ Preços sincronizados do Firebase");
    } catch (error) {
      console.error("❌ Erro ao sincronizar preços:", error);
    }
  },
};

// ================================
// CART MANAGER
// ================================
const CartManager = {
  add(item) {
    const existingItemIndex = AppState.cart.findIndex(
      (cartItem) =>
        cartItem.nome === item.nome &&
        cartItem.selectedSize === item.selectedSize &&
        JSON.stringify(cartItem.selectedCaldas) ===
          JSON.stringify(item.selectedCaldas) &&
        JSON.stringify(cartItem.removed) === JSON.stringify(item.removed),
    );

    if (existingItemIndex > -1) {
      AppState.cart[existingItemIndex].quantity =
        (AppState.cart[existingItemIndex].quantity || 1) + 1;
    } else {
      AppState.cart.push({ ...item, quantity: 1 });
    }
    this.update();
  },

  updateQuantity(index, change) {
    const item = AppState.cart[index];
    if (!item) return;

    item.quantity = (item.quantity || 1) + change;

    if (item.quantity < 1) {
      this.remove(index);
    } else {
      this.update();
    }
  },

  remove(index) {
    AppState.cart.splice(index, 1);
    this.update();
  },

  clear() {
    AppState.cart = [];
    this.update();
  },

  getTotal() {
    const cartTotal = AppState.cart.reduce((sum, item) => {
      const quantity = item.quantity || 1;
      return sum + item.finalPrice * quantity;
    }, 0);

    // Adiciona taxa de entrega se for delivery e não for Campo Grande
    const deliveryFee =
      AppState.deliveryType === "delivery" &&
      AppState.selectedNeighborhood?.value !== "campo-grande"
        ? AppState.deliveryFee
        : 0;

    return cartTotal + deliveryFee;
  },

  update() {
    CartUI.render();
  },
};

// ================================
// CATEGORIES UI
// ================================
const CategoriesUI = {
  render(categories) {
    const container = DOM.elements.categoriesContainer;
    container.innerHTML = "";

    categories.forEach((category) => {
      const btn = DOM.create("button", "category-btn", {
        "data-category": category,
      });
      btn.textContent = category;
      btn.addEventListener("click", () => this.scrollToCategory(category));
      container.appendChild(btn);
    });

    setTimeout(() => {
      const firstBtn = container.querySelector(".category-btn");
      if (firstBtn) firstBtn.classList.add("active");
    }, 100);
  },

  scrollToCategory(categoryName) {
    const section = DOM.get(`[data-category-section="${categoryName}"]`);
    const carousel = DOM.get(".categories-carousel");
    const btn = DOM.get(`.category-btn[data-category="${categoryName}"]`);

    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    DOM.getAll(".category-btn").forEach((b) => b.classList.remove("active"));
    if (btn) {
      btn.classList.add("active");

      const scrollPosition =
        btn.offsetLeft - carousel.offsetWidth / 2 + btn.offsetWidth / 2;
      carousel.scrollTo({ left: scrollPosition, behavior: "smooth" });
    }
  },

  updateActiveOnScroll: Utils.debounce(() => {
    const sections = DOM.getAll(".category-section");
    const scrollPos = window.scrollY + 250;

    sections.forEach((section) => {
      const sectionTop = section.offsetTop;
      const sectionBottom = sectionTop + section.offsetHeight;
      const categoryName = section.getAttribute("data-category-section");
      const btn = DOM.get(`.category-btn[data-category="${categoryName}"]`);

      if (scrollPos >= sectionTop && scrollPos < sectionBottom) {
        DOM.getAll(".category-btn").forEach((b) =>
          b.classList.remove("active"),
        );
        if (btn) btn.classList.add("active");
      }
    });
  }, 100),
};

// ================================
// MENU UI
// ================================
const MenuUI = {
  render(data) {
    const container = DOM.elements.menuContainer;
    container.innerHTML = "";

    Object.entries(data).forEach(([category, items]) => {
      const section = this.createCategorySection(category, items);
      container.appendChild(section);
    });
  },

  createCategorySection(category, items) {
    const section = DOM.create("section", "category-section", {
      "data-category-section": category,
    });

    const title = DOM.create("h2", "category-title");
    title.textContent = category;
    section.appendChild(title);

    const grid = DOM.create("div", "grid");
    items.forEach((item) => {
      const card = this.createProductCard(item, category);
      grid.appendChild(card);
    });

    section.appendChild(grid);
    return section;
  },

  createProductCard(item, category) {
    const card = DOM.create("div", "card");
    card.dataset.category = category;
    card.dataset.itemName = item.nome;

    const img = DOM.create("img");
    img.src = item.img || this.getPlaceholderImage();
    img.onerror = () => (img.src = this.getPlaceholderImage());

    const info = DOM.create("div", "info");

    const textDiv = DOM.create("div");
    const h3 = DOM.create("h3");
    h3.textContent = item.nome;
    const p = DOM.create("p");
    p.textContent = item.descricao || "";

    textDiv.appendChild(h3);
    textDiv.appendChild(p);

    const optionsContainer = DOM.create("div", "options-container");

    if (item.opcoes && Array.isArray(item.opcoes)) {
      item.opcoes.forEach((size, index) => {
        const price =
          item.precoBase && item.precoBase[index] ? item.precoBase[index] : 0;

        const btn = DOM.create("button", "opt-btn");
        btn.innerHTML = `${size}<span class="price-tag">${Utils.formatPrice(price)}</span>`;

        btn.addEventListener("click", () =>
          OrderFlow.start(item, category, size, price),
        );
        optionsContainer.appendChild(btn);
      });
    }

    info.appendChild(textDiv);
    info.appendChild(optionsContainer);

    card.appendChild(img);
    card.appendChild(info);

    // Verificar disponibilidade após criar o card
    this.checkItemAvailability(card, category, item.nome);

    return card;
  },

  async checkItemAvailability(card, category, itemName) {
    const isAvailable = await MenuService.checkAvailability(category, itemName);

    if (!isAvailable) {
      card.classList.add("unavailable");
      card.style.opacity = "0.5";
      card.style.pointerEvents = "none";

      const info = card.querySelector(".info");
      if (info) {
        const unavailableTag = DOM.create("div", "unavailable-tag");
        unavailableTag.textContent = "⚠️ Indisponível no momento";
        unavailableTag.style.cssText = `
          color: #f44336;
          font-weight: bold;
          font-size: 0.85rem;
          margin-top: 8px;
        `;
        info.appendChild(unavailableTag);
      }
    }
  },

  getPlaceholderImage() {
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23333' width='100' height='100'/%3E%3Ctext fill='%23666' x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-family='Arial' font-size='14'%3ESem imagem%3C/text%3E%3C/svg%3E";
  },

  renderError() {
    const container = DOM.elements.menuContainer;
    container.innerHTML = `
      <div class="error-message">
        <h3>Erro ao carregar o cardápio 😕</h3>
        <p>Não foi possível carregar os itens. Tente novamente.</p>
        <button onclick="location.reload()">Recarregar Página</button>
      </div>
    `;
  },
};

// ================================
// ORDER FLOW - GERENCIADOR PRINCIPAL
// ================================
const OrderFlow = {
  start(item, category, selectedSize, selectedPrice) {
    // Combos COMPLETOS (burger + batata + bebida) - Categoria "Combos"
    if (item.combo && category === "Combos" && item.upgrades) {
      this.startFullCombo(item, category, selectedSize, selectedPrice);
    }
    // Combos SIMPLES (apenas burgers) - Promoções e Clones
    else if (item.combo && item.burgers && item.burgers.length > 0) {
      this.startSimpleCombo(item, category, selectedSize, selectedPrice);
    }
    // Item único
    else {
      this.startSingleItem(item, category, selectedSize, selectedPrice);
    }
  },

  // Item único (Artesanais, Batata, Bebidas, etc)
  startSingleItem(item, category, selectedSize, selectedPrice) {
    AppState.isCombo = false;
    AppState.isFullCombo = false;
    AppState.tempItem = {
      nome: item.nome,
      img: item.img,
      categoria: category,
      selectedSize,
      selectedPrice,
      opcoes: item.opcoes,
      meatPoint: null,
      selectedCaldas: [],
      removed: [],
      added: [],
      obs: "",
      finalPrice: selectedPrice,
    };

    AppState.stepsData = this.buildStepsForItem(item, selectedSize);
    AppState.currentStep = 0;

    if (AppState.stepsData.length === 0) {
      CartManager.add(AppState.tempItem);
      showToast("✅ Item adicionado!");
      return;
    }

    ModalUI.open();
    this.renderCurrentStep();
  },

  // Combo SIMPLES (apenas burgers) - Promoções e Clones
  startSimpleCombo(item, category, selectedSize, selectedPrice) {
    AppState.isCombo = true;
    AppState.isFullCombo = false;
    AppState.comboData = {
      nomeCombo: item.nome,
      categoria: category,
      selectedSize,
      basePrice: selectedPrice,
      itemRef: item,
    };
    AppState.currentBurgerIndex = 0;
    AppState.comboItems = [];

    this.startNextBurgerInCombo();
  },

  // Combo COMPLETO (burger + batata + bebida) - Categoria "Combos"
  startFullCombo(item, category, selectedSize, selectedPrice) {
    AppState.isCombo = true;
    AppState.isFullCombo = true;
    AppState.comboData = {
      nomeCombo: item.nome,
      categoria: category,
      selectedSize,
      basePrice: selectedPrice,
      itemRef: item,
      upgrades: item.upgrades,
      selectedBatata: null,
      selectedBebida: null,
      batataPriceAdjust: 0,
      bebidaPriceAdjust: 0,
    };
    AppState.currentBurgerIndex = 0;
    AppState.comboItems = [];

    this.startNextBurgerInCombo();
  },

  // Personalização do próximo burger do combo
  startNextBurgerInCombo() {
    const { burgers } = AppState.comboData.itemRef;
    const burgerName = burgers[AppState.currentBurgerIndex];

    const ingredients = this.getIngredientsForBurger(
      AppState.comboData.itemRef,
      burgerName,
    );

    AppState.tempItem = {
      nome: burgerName,
      isPartOfCombo: true,
      comboName: AppState.comboData.nomeCombo,
      meatPoint: null,
      selectedCaldas: [],
      removed: [],
      added: [],
      obs: "",
      finalPrice: 0,
    };

    AppState.stepsData = this.buildStepsForBurger(
      AppState.comboData.itemRef,
      burgerName,
      ingredients,
    );
    AppState.currentStep = 0;

    ModalUI.open();
    this.renderCurrentStep();
  },

  getIngredientsForBurger(item, burgerName) {
    const lowerName = burgerName.toLowerCase();

    if (lowerName.includes("simples")) {
      return item.simplesIngredients || item.ingredientesPadrao || [];
    } else if (lowerName.includes("duplo")) {
      return item.duploIngredients || item.ingredientesPadrao || [];
    } else if (lowerName.includes("triplo")) {
      return item.triploIngredients || item.ingredientesPadrao || [];
    } else if (lowerName.includes("cremoso")) {
      return item.PromoIngredients || item.ingredientesPadrao || [];
    } else if (lowerName.includes("calabreso")) {
      return item.duploIngredients || item.ingredientesPadrao || [];
    }

    return (
      item.ingredientesPadrao ||
      item.duploIngredients ||
      item.simplesIngredients ||
      []
    );
  },

  buildStepsForBurger(item, burgerName, ingredients) {
    const steps = [];

    // SEMPRE adiciona o step de ponto da carne para burgers
    const pontosPadrao = ["Mal passado", "Ao ponto", "Bem passado"];
    steps.push({ type: "meatPoint", data: pontosPadrao, burgerName });

    if (item.caldas && Array.isArray(item.caldas)) {
      steps.push({ type: "caldas", data: item.caldas, burgerName });
    }

    if (ingredients && ingredients.length > 0) {
      steps.push({
        type: "retiradas",
        data: ingredients,
        burgerName: burgerName,
      });
    }

    const extras = Utils.getExtras(item);
    if (extras.length > 0) {
      steps.push({
        type: "extras",
        data: extras,
        burgerName: burgerName,
      });
    }

    steps.push({
      type: "observacoes",
      burgerName: burgerName,
    });

    return steps;
  },

  buildStepsForItem(item, selectedSize) {
    const steps = [];

    // Adiciona ponto da carne se for categoria Artesanais
    const pontosPadrao = ["Mal passado", "Ao ponto", "Bem passado"];
    if (item.categoria === "Artesanais" || item.pontoCarne) {
      steps.push({ type: "meatPoint", data: item.pontoCarne || pontosPadrao });
    }

    if (item.caldas && Array.isArray(item.caldas)) {
      steps.push({ type: "caldas", data: item.caldas });
    }

    let ingredients = [];

    if (item.ingredientesPorOpcao && item.ingredientesPorOpcao[selectedSize]) {
      ingredients = item.ingredientesPorOpcao[selectedSize];
    } else if (item.ingredientesPadrao) {
      ingredients = item.ingredientesPadrao;
    } else {
      if (Array.isArray(item.retiradas)) ingredients.push(...item.retiradas);
      if (Array.isArray(item.ingredientes))
        ingredients.push(...item.ingredientes);
      if (Array.isArray(item.simplesIngredients))
        ingredients.push(...item.simplesIngredients);
      if (Array.isArray(item.duploIngredients))
        ingredients.push(...item.duploIngredients);
    }

    const uniqueIngredients = [...new Set(ingredients)].filter(
      (i) => i && i.trim() !== "",
    );

    if (uniqueIngredients.length > 0) {
      steps.push({ type: "retiradas", data: uniqueIngredients });
    }

    const extras = Utils.getExtras(item);
    if (extras.length > 0) {
      steps.push({ type: "extras", data: extras });
    }

    steps.push({ type: "observacoes" });

    return steps;
  },

  renderCurrentStep() {
    const step = AppState.stepsData[AppState.currentStep];
    const { modalTitle, modalBody, progressDots, btnBack, btnNext } =
      DOM.elements;

    progressDots.innerHTML = AppState.stepsData
      .map(
        (_, i) =>
          `<div class="dot ${i === AppState.currentStep ? "active" : ""}"></div>`,
      )
      .join("");

    btnBack.style.display = AppState.currentStep > 0 ? "block" : "none";

    const isLastStep = AppState.currentStep === AppState.stepsData.length - 1;

    if (AppState.isCombo) {
      const isLastBurger =
        AppState.currentBurgerIndex ===
        AppState.comboData.itemRef.burgers.length - 1;

      if (isLastStep && isLastBurger) {
        btnNext.textContent = AppState.isFullCombo
          ? "PRÓXIMO"
          : "ADICIONAR COMBO AO CARRINHO";
      } else if (isLastStep) {
        btnNext.textContent = "PRÓXIMO ITEM DO COMBO";
      } else {
        btnNext.textContent = "PRÓXIMO";
      }
    } else {
      btnNext.textContent = isLastStep ? "ADICIONAR AO CARRINHO" : "PRÓXIMO";
    }

    switch (step.type) {
      case "meatPoint":
        this.renderMeatPoint(modalTitle, modalBody, step.data, step.burgerName);
        break;
      case "caldas":
        this.renderCaldas(modalTitle, modalBody, step.data, step.burgerName);
        break;
      case "retiradas":
        this.renderRetiradas(modalTitle, modalBody, step.data, step.burgerName);
        break;
      case "extras":
        this.renderExtras(modalTitle, modalBody, step.data, step.burgerName);
        break;
      case "observacoes":
        this.renderObservacoes(modalTitle, modalBody, step.burgerName);
        break;
      case "batataUpgrade":
        this.renderBatataUpgrade(modalTitle, modalBody, step.data);
        break;
      case "bebidaUpgrade":
        this.renderBebidaUpgrade(modalTitle, modalBody, step.data);
        break;
    }
  },

  renderMeatPoint(title, body, options, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Ponto da Carne 🥩`;

    body.innerHTML = options
      .map(
        (opt, i) => `
      <div class="option-row">
        <label for="meat-${i}" style="flex:1; cursor:pointer;">${opt}</label>
        <input type="radio" id="meat-${i}" name="meatPoint" value="${opt}" ${AppState.tempItem.meatPoint === opt ? "checked" : ""}>
      </div>
    `,
      )
      .join("");

    body.querySelectorAll("input").forEach((input) => {
      input.onchange = (e) => (AppState.tempItem.meatPoint = e.target.value);
    });
  },

  renderCaldas(title, body, options, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Escolha as Caldas 🍯`;

    if (!AppState.tempItem.selectedCaldas)
      AppState.tempItem.selectedCaldas = [];

    body.innerHTML = options
      .map((opt, index) => {
        const isChecked = AppState.tempItem.selectedCaldas.includes(opt);
        const id = `calda-${index}`;
        return `
          <div class="option-row">
            <label for="${id}" style="flex: 1; cursor: pointer;">${opt}</label>
            <input type="checkbox" id="${id}" value="${opt}" ${isChecked ? "checked" : ""}>
          </div>
        `;
      })
      .join("");

    body.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.onchange = (e) => {
        const value = e.target.value;
        if (e.target.checked) {
          if (!AppState.tempItem.selectedCaldas.includes(value)) {
            AppState.tempItem.selectedCaldas.push(value);
          }
        } else {
          const idx = AppState.tempItem.selectedCaldas.indexOf(value);
          if (idx > -1) AppState.tempItem.selectedCaldas.splice(idx, 1);
        }
      };
    });
  },

  renderRetiradas(title, body, ingredients, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Retirar Ingredientes ❌`;

    if (!AppState.tempItem.removed) AppState.tempItem.removed = [];

    // Filtrar apenas ingredientes disponíveis
    const availableIngredients = ingredients.filter(
      (ing) => AppState.ingredientsAvailability[ing] !== false,
    );

    if (availableIngredients.length === 0) {
      body.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-muted);">
          <p>Nenhum ingrediente disponível para retirar no momento.</p>
        </div>
      `;
      return;
    }

    body.innerHTML = availableIngredients
      .map((ing, index) => {
        const isChecked = AppState.tempItem.removed.includes(ing);
        const id = `remove-${index}`;
        return `
          <div class="option-row">
            <label for="${id}" style="flex: 1; cursor: pointer;">${ing}</label>
            <input type="checkbox" id="${id}" value="${ing}" ${isChecked ? "checked" : ""}>
          </div>
        `;
      })
      .join("");

    body.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.onchange = (e) => {
        const value = e.target.value;
        if (e.target.checked) {
          if (!AppState.tempItem.removed.includes(value)) {
            AppState.tempItem.removed.push(value);
          }
        } else {
          const idx = AppState.tempItem.removed.indexOf(value);
          if (idx > -1) AppState.tempItem.removed.splice(idx, 1);
        }
      };
    });
  },

  renderExtras(title, body, extras, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Adicionais Pagos 💰`;

    if (!AppState.tempItem.added) AppState.tempItem.added = [];

    // Filtrar apenas adicionais disponíveis
    const availableExtras = extras.filter(
      (extra) => AppState.paidExtrasAvailability[extra.nome] !== false,
    );

    if (availableExtras.length === 0) {
      body.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-muted);">
          <p>Nenhum adicional disponível no momento.</p>
        </div>
      `;
      return;
    }

    body.innerHTML = availableExtras
      .map((extra, index) => {
        const isChecked = AppState.tempItem.added.some(
          (a) => a.nome === extra.nome,
        );
        const id = `extra-${index}`;
        return `
          <div class="option-row">
            <label for="${id}" style="flex: 1; cursor: pointer;">
              ${extra.nome} <span style="color: var(--primary);">+ ${Utils.formatPrice(extra.preco)}</span>
            </label>
            <input type="checkbox" id="${id}" value="${index}" ${isChecked ? "checked" : ""}>
          </div>
        `;
      })
      .join("");

    body.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.onchange = (e) => {
        const extraIndex = parseInt(e.target.value);
        const extra = availableExtras[extraIndex]; // Usar availableExtras ao invés de extras

        if (e.target.checked) {
          const alreadyAdded = AppState.tempItem.added.some(
            (a) => a.nome === extra.nome,
          );
          if (!alreadyAdded) {
            AppState.tempItem.added.push({
              nome: extra.nome,
              preco: extra.preco,
            });
          }
        } else {
          const idx = AppState.tempItem.added.findIndex(
            (a) => a.nome === extra.nome,
          );
          if (idx > -1) AppState.tempItem.added.splice(idx, 1);
        }
      };
    });
  },

  renderObservacoes(title, body, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Observações 💬`;

    body.innerHTML = `
      <textarea
        id="obs-input"
        placeholder="Adicione alguma observação especial..."
        style="
          width: 100%;
          min-height: 120px;
          padding: 15px;
          background: #111;
          border: 1px solid var(--border);
          border-radius: 12px;
          color: white;
          font-size: 0.95rem;
          resize: vertical;
          outline: none;
        "
      >${AppState.tempItem.obs || ""}</textarea>
    `;

    const textarea = body.querySelector("#obs-input");
    textarea.oninput = (e) => (AppState.tempItem.obs = e.target.value);
  },

  renderBatataUpgrade(title, body, upgrades) {
    title.textContent = "Escolha a Batata 🍟";

    const currentSelection = AppState.comboData.selectedBatata;

    body.innerHTML = upgrades
      .map((opt, i) => {
        const isSelected = currentSelection === opt.nome;
        const priceText =
          opt.adicional > 0
            ? `+${Utils.formatPrice(opt.adicional)}`
            : opt.adicional < 0
              ? Utils.formatPrice(opt.adicional)
              : "Inclusa";

        return `
          <div class="option-row">
            <label for="batata-${i}" style="flex:1; cursor:pointer;">
              ${opt.nome} <span style="color: var(--primary);">${priceText}</span>
            </label>
            <input type="radio" id="batata-${i}" name="batataUpgrade" value="${i}" ${isSelected ? "checked" : ""}>
          </div>
        `;
      })
      .join("");

    body.querySelectorAll("input").forEach((input) => {
      input.onchange = (e) => {
        const selectedIndex = parseInt(e.target.value);
        const selected = upgrades[selectedIndex];
        AppState.comboData.selectedBatata = selected.nome;
        AppState.comboData.batataPriceAdjust = selected.adicional || 0;
      };
    });
  },

  renderBebidaUpgrade(title, body, upgrades) {
    title.textContent = "Escolha a Bebida 🥤";

    const currentSelection = AppState.comboData.selectedBebida;

    body.innerHTML = upgrades
      .map((opt, i) => {
        const isSelected = currentSelection === opt.nome;
        const priceText =
          opt.adicional > 0
            ? `+${Utils.formatPrice(opt.adicional)}`
            : opt.adicional < 0
              ? Utils.formatPrice(opt.adicional)
              : "Inclusa";

        return `
          <div class="option-row">
            <label for="bebida-${i}" style="flex:1; cursor:pointer;">
              ${opt.nome} <span style="color: var(--primary);">${priceText}</span>
            </label>
            <input type="radio" id="bebida-${i}" name="bebidaUpgrade" value="${i}" ${isSelected ? "checked" : ""}>
          </div>
        `;
      })
      .join("");

    body.querySelectorAll("input").forEach((input) => {
      input.onchange = (e) => {
        const selectedIndex = parseInt(e.target.value);
        const selected = upgrades[selectedIndex];
        AppState.comboData.selectedBebida = selected.nome;
        AppState.comboData.bebidaPriceAdjust = selected.adicional || 0;
      };
    });
  },

  nextStep() {
    if (AppState.currentStep < AppState.stepsData.length - 1) {
      AppState.currentStep++;
      this.renderCurrentStep();
    } else {
      this.completeCurrentItem();
    }
  },

  prevStep() {
    if (AppState.currentStep > 0) {
      AppState.currentStep--;
      this.renderCurrentStep();
    }
  },

  completeCurrentItem() {
    if (AppState.isCombo) {
      this.saveComboItem();

      AppState.currentBurgerIndex++;

      if (
        AppState.currentBurgerIndex < AppState.comboData.itemRef.burgers.length
      ) {
        this.startNextBurgerInCombo();
      } else if (AppState.isFullCombo) {
        this.showComboUpgrades();
      } else {
        this.finalizeCombo();
      }
    } else {
      this.finalizeSingleItem();
    }
  },

  saveComboItem() {
    const extrasTotal = (AppState.tempItem.added || []).reduce(
      (sum, extra) => sum + extra.preco,
      0,
    );
    AppState.tempItem.finalPrice = extrasTotal;

    AppState.comboItems.push({ ...AppState.tempItem });
  },

  showComboUpgrades() {
    const { upgrades } = AppState.comboData;

    AppState.stepsData = [
      { type: "batataUpgrade", data: upgrades.batata },
      { type: "bebidaUpgrade", data: upgrades.bebida },
    ];

    AppState.currentStep = 0;
    this.renderCurrentStep();

    DOM.elements.btnNext.onclick = () => {
      if (AppState.currentStep === 0) {
        AppState.currentStep = 1;
        this.renderCurrentStep();
      } else {
        this.finalizeCombo();
      }
    };
  },

  finalizeCombo() {
    const totalExtras = AppState.comboItems.reduce(
      (sum, item) => sum + item.finalPrice,
      0,
    );

    const finalPrice =
      AppState.comboData.basePrice +
      totalExtras +
      (AppState.comboData.batataPriceAdjust || 0) +
      (AppState.comboData.bebidaPriceAdjust || 0);

    const comboItem = {
      nome: AppState.comboData.nomeCombo,
      img: AppState.comboData.itemRef.img,
      categoria: AppState.comboData.categoria,
      selectedSize: AppState.comboData.selectedSize,
      selectedPrice: AppState.comboData.basePrice,
      isCombo: true,
      burgers: AppState.comboItems,
      selectedBatata: AppState.comboData.selectedBatata || null,
      selectedBebida: AppState.comboData.selectedBebida || null,
      finalPrice: finalPrice,
    };

    CartManager.add(comboItem);
    showToast("✅ Combo adicionado!");
    ModalUI.close();
  },

  finalizeSingleItem() {
    const extrasTotal = (AppState.tempItem.added || []).reduce(
      (sum, extra) => sum + extra.preco,
      0,
    );

    AppState.tempItem.finalPrice =
      AppState.tempItem.selectedPrice + extrasTotal;

    CartManager.add(AppState.tempItem);
    showToast("✅ Item adicionado!");
    ModalUI.close();
  },
};

// ================================
// CART UI
// ================================
const CartUI = {
  render() {
    const { cartItems, cartCount, totalCart } = DOM.elements;

    cartCount.textContent = AppState.cart.length;
    totalCart.textContent = Utils.formatPrice(CartManager.getTotal());

    cartItems.innerHTML = "";

    if (AppState.cart.length === 0) {
      cartItems.innerHTML = `
        <div style="text-align: center; padding: 40px 0; color: #666;">
          <p>Seu carrinho está vazio 🛒</p>
        </div>
      `;
      return;
    }

    AppState.cart.forEach((item, index) => {
      const itemElement = this.renderCartItem(item, index);
      cartItems.appendChild(itemElement);
    });
  },

  renderCartItem(item, index) {
    const div = DOM.create("div", "cart-item");
    div.style.display = "flex";
    div.style.gap = "15px";
    div.style.alignItems = "start";
    div.style.padding = "15px 0";
    div.style.borderBottom = "1px solid #222";

    const imgContainer = document.createElement("div");
    imgContainer.style.flexShrink = "0";
    imgContainer.innerHTML = `<img src="${item.img || "./img/placeholder.png"}" alt="${item.nome}" style="width: 70px; height: 70px; object-fit: cover; border-radius: 10px; border: 2px solid var(--primary); box-shadow: 0 2px 8px rgba(255, 193, 7, 0.2);">`;
    div.appendChild(imgContainer);

    const contentContainer = DOM.create("div");
    contentContainer.style.flex = "1";

    const nomeComOpcao = item.selectedSize
      ? `${item.nome} - ${item.selectedSize}`
      : item.nome;

    const header = DOM.create("div", "cart-item-header");
    header.innerHTML = `
    <div style="font-weight: bold; font-size: 1.05rem; color: #fff;">${nomeComOpcao}</div>
    <div style="color: var(--primary); margin: 2px 0; font-weight: 600;">${Utils.formatPrice(item.finalPrice * (item.quantity || 1))}</div>
  `;
    contentContainer.appendChild(header);

    const detailsDiv = document.createElement("div");
    detailsDiv.style.fontSize = "0.85rem";
    detailsDiv.style.color = "#aaa";
    let detailsHtml = "";

    if (item.isCombo && item.burgers) {
      detailsHtml += `<div style="color: var(--primary); font-weight: bold; margin-top: 5px;">Itens do Combo:</div>`;
      item.burgers.forEach((burger) => {
        detailsHtml += `<div style="margin-left: 10px; margin-top: 5px;">• <strong>${burger.nome}</strong></div>`;

        // Mostrar ponto da carne
        if (burger.meatPoint) {
          detailsHtml += `<div style="margin-left: 20px; font-size: 0.8rem; color: #ccc;">Ponto: ${burger.meatPoint}</div>`;
        }

        // Mostrar ingredientes removidos
        if (burger.removed && burger.removed.length > 0) {
          detailsHtml += `<div style="margin-left: 20px; font-size: 0.8rem; color: #ff4444;">Sem: ${burger.removed.join(", ")}</div>`;
        }

        // Mostrar adicionais pagos
        if (burger.added && burger.added.length > 0) {
          const addedNames = burger.added.map((a) => a.nome).join(", ");
          detailsHtml += `<div style="margin-left: 20px; font-size: 0.8rem; color: #4CAF50;">➕ ${addedNames}</div>`;
        }

        // Mostrar observações
        if (burger.obs) {
          detailsHtml += `<div style="margin-left: 20px; font-size: 0.8rem; color: #aaa;">💬 ${burger.obs}</div>`;
        }
      });
      if (item.selectedBatata) {
        detailsHtml += `<div style="margin-top: 3px;">🍟 ${item.selectedBatata}</div>`;
      }
      if (item.selectedBebida) {
        detailsHtml += `<div>🥤 ${item.selectedBebida}</div>`;
      }
    } else {
      // Mostrar ponto da carne para itens individuais
      if (item.meatPoint) {
        detailsHtml += `<div style="margin-top: 3px;">🥩 Ponto: ${item.meatPoint}</div>`;
      }

      if (item.selectedCaldas?.length)
        detailsHtml += `<div>🍯 Calda: ${item.selectedCaldas.join(", ")}</div>`;

      if (item.removed?.length)
        detailsHtml += `<div style="color: #ff4444;">❌ Sem: ${item.removed.join(", ")}</div>`;

      if (item.added?.length) {
        const addedNames = item.added.map((a) => a.nome).join(", ");
        detailsHtml += `<div style="color: #4CAF50;">➕ Adicionais: ${addedNames}</div>`;
      }

      if (item.obs) {
        detailsHtml += `<div style="margin-top: 3px; color: #aaa;">💬 ${item.obs}</div>`;
      }
    }

    detailsDiv.innerHTML = detailsHtml;
    contentContainer.appendChild(detailsDiv);

    const controls = DOM.create("div", "cart-controls");
    controls.style.display = "flex";
    controls.style.alignItems = "center";
    controls.style.gap = "12px";
    controls.style.marginTop = "10px";

    controls.innerHTML = `
    <div class="quantity-selector">
      <button onclick="CartManager.updateQuantity(${index}, -1)">-</button>
      <span>${item.quantity || 1}</span>
      <button onclick="CartManager.updateQuantity(${index}, 1)">+</button>
    </div>
    <button class="btn-remove-link" onclick="CartManager.remove(${index})">Remover</button>
  `;
    contentContainer.appendChild(controls);

    div.appendChild(contentContainer);
    return div;
  },
};

// ================================
// MODAL UI
// ================================
const ModalUI = {
  open() {
    DOM.elements.modal.classList.add("active");
    DOM.elements.overlay.classList.add("active");
  },

  close() {
    DOM.elements.modal.classList.remove("active");
    DOM.elements.overlay.classList.remove("active");
  },
};

// ================================
// SIDEBAR UI
// ================================
const SidebarUI = {
  open() {
    DOM.elements.sidebar.classList.add("active");
    DOM.elements.overlay.classList.add("active");
  },

  close() {
    DOM.elements.sidebar.classList.remove("active");
    DOM.elements.overlay.classList.remove("active");
  },

  toggle() {
    const isActive = DOM.elements.sidebar.classList.contains("active");
    isActive ? this.close() : this.open();
  },
};

// ================================
// CHECKOUT
// ================================
const CheckoutManager = {
  init() {
    const form = DOM.elements.checkoutForm;
    if (!form) return;

    DOM.getAll("[data-delivery-type]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const type = e.target.dataset.deliveryType;
        AppState.deliveryType = type;

        DOM.getAll("[data-delivery-type]").forEach((b) =>
          b.classList.remove("active"),
        );
        e.target.classList.add("active");

        const deliveryFields = DOM.elements.deliveryFields;
        if (type === "delivery") {
          deliveryFields.style.display = "block";
          deliveryFields.querySelectorAll("input").forEach((input) => {
            input.required = true;
          });
          deliveryFields.querySelectorAll("select").forEach((select) => {
            select.required = true;
          });
        } else {
          deliveryFields.style.display = "none";
          deliveryFields.querySelectorAll("input").forEach((input) => {
            input.required = false;
          });
          deliveryFields.querySelectorAll("select").forEach((select) => {
            select.required = false;
          });
        }

        CartUI.render();
      });
    });

    const neighborhoodSelect = form.querySelector("[data-neighborhood-select]");
    if (neighborhoodSelect) {
      neighborhoodSelect.addEventListener("change", (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const fee = parseFloat(selectedOption.dataset.fee) || 0;
        const neighborhoodValue = e.target.value;
        const neighborhoodText =
          selectedOption.textContent.split(" - ")[0] || "";

        AppState.deliveryFee = fee;
        AppState.selectedNeighborhood = {
          value: neighborhoodValue,
          text: neighborhoodText,
        };

        const feeDisplay = DOM.get("[data-delivery-fee-display]");
        const feeValue = DOM.get("[data-delivery-fee-value]");

        if (neighborhoodValue === "campo-grande") {
          feeDisplay.style.display = "flex";
          feeDisplay.classList.add("campo-grande");
          feeValue.textContent = "A combinar";
        } else if (fee > 0) {
          feeDisplay.style.display = "flex";
          feeDisplay.classList.remove("campo-grande");
          feeValue.textContent = Utils.formatPrice(fee);
        } else {
          feeDisplay.style.display = "none";
        }

        CartUI.render();
      });
    }

    const paymentSelect = form.querySelector('[name="paymentMethod"]');
    if (paymentSelect) {
      paymentSelect.addEventListener("change", (e) => {
        const changeField = DOM.elements.changeField;
        if (e.target.value === "dinheiro") {
          changeField.style.display = "block";
          changeField.querySelector("input").required = false;
        } else {
          changeField.style.display = "none";
          changeField.querySelector("input").required = false;
        }
      });
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.processCheckout(new FormData(form));
    });
  },

  processCheckout(formData) {
    const data = Object.fromEntries(formData.entries());

    if (AppState.cart.length === 0) {
      showToast("⚠️ Carrinho vazio");
      return;
    }

    if (AppState.deliveryType === "delivery") {
      if (!data.neighborhood) {
        showToast("⚠️ Selecione o bairro de entrega");
        return;
      }

      const selectedOption = DOM.get(
        `[data-neighborhood-select] option[value="${data.neighborhood}"]`,
      );
      data.neighborhoodInfo = {
        value: data.neighborhood,
        text: selectedOption?.textContent.split(" - ")[0] || "",
      };
    }

    OrderSender.sendToWhatsApp(data);
    OrderSender.sendToKDS(data);
  },
};

// ================================
// ORDER SENDER
// ================================
const OrderSender = {
  sendToWhatsApp(data) {
    let message = `🔥 *PEDIDO RIBBS ZN* 🔥\n\n`;
    message += `━━━━━━━━━━━━━━━━━━\n`;
    message += `📦 *TIPO:* ${AppState.deliveryType === "delivery" ? "🛵 ENTREGA" : "🏪 RETIRADA"}\n`;

    if (AppState.deliveryType === "delivery") {
      message += `📍 *Bairro:* ${data.neighborhoodInfo.text}\n`;
      message += `📍 *Endereço:* ${data.address}\n`;
      if (data.complement) message += `   ${data.complement}\n`;
      if (
        AppState.deliveryFee > 0 &&
        AppState.selectedNeighborhood?.value !== "campo-grande"
      ) {
        message += `🛵 *Taxa de Entrega:* ${Utils.formatPrice(AppState.deliveryFee)}\n`;
      } else if (AppState.selectedNeighborhood?.value === "campo-grande") {
        message += `🛵 *Taxa de Entrega:* A combinar\n`;
      }
    }

    message += `👤 *Cliente:* ${data.customerName}\n`;
    message += `━━━━━━━━━━━━━━━━━━\n\n`;

    message += `🍔 *ITENS DO PEDIDO:*\n\n`;

    AppState.cart.forEach((item, idx) => {
      message += `${idx + 1}. *${item.nome}*\n`;

      if (item.isCombo && item.burgers) {
        item.burgers.forEach((burger) => {
          message += `   --- ${burger.nome} ---\n`;
          if (burger.meatPoint) message += `   🥩 Ponto: ${burger.meatPoint}\n`;
          if (burger.selectedCaldas && burger.selectedCaldas.length)
            message += `   🍯 Caldas: ${burger.selectedCaldas.join(", ")}\n`;
          if (burger.removed && burger.removed.length) {
            message += `   ❌ Sem: ${burger.removed.join(", ")}\n`;
          }
          if (burger.added && burger.added.length) {
            message += `   ➕ Adicionais: ${burger.added.map((a) => a.nome).join(", ")}\n`;
          }
          if (burger.obs) message += `   💬 Obs: ${burger.obs}\n`;
        });
        if (item.selectedBatata) {
          message += `   🍟 Batata: ${item.selectedBatata}\n`;
        }
        if (item.selectedBebida) {
          message += `   🥤 Bebida: ${item.selectedBebida}\n`;
        }
      } else {
        if (item.selectedSize) message += `   Tamanho: ${item.selectedSize}\n`;
        if (item.meatPoint) message += `   🥩 Ponto: ${item.meatPoint}\n`;
        if (item.selectedCaldas && item.selectedCaldas.length)
          message += `   🍯 Caldas: ${item.selectedCaldas.join(", ")}\n`;
        if (item.removed && item.removed.length) {
          message += `   ❌ Sem: ${item.removed.join(", ")}\n`;
        }
        if (item.added && item.added.length) {
          message += `   ➕ Adicionais: ${item.added.map((a) => a.nome).join(", ")}\n`;
        }
        if (item.obs) message += `   💬 Obs: ${item.obs}\n`;
      }

      message += `   💰 ${Utils.formatPrice(item.finalPrice)}\n`;
      if (item.quantity > 1) {
        message += `   Quantidade: ${item.quantity}x\n`;
      }
      message += `\n`;
    });

    message += `━━━━━━━━━━━━━━━━━━\n`;
    message += `💳 *Pagamento:* ${this.getPaymentName(data.paymentMethod)}\n`;

    if (data.paymentMethod === "dinheiro" && data.changeFor) {
      message += `💵 *Troco para:* R$ ${data.changeFor}\n`;
    }

    message += `\n💰 *TOTAL: ${Utils.formatPrice(CartManager.getTotal())}*`;

    const encodedMessage = encodeURIComponent(message);
    const whatsappURL = `https://wa.me/${CONFIG.whatsappNumber}?text=${encodedMessage}`;

    window.open(whatsappURL, "_blank");
  },

  getPaymentName(method) {
    const names = {
      pix: "💚 PIX",
      dinheiro: "💵 Dinheiro",
      debito: "💳 Cartão de Débito",
      credito: "💳 Cartão de Crédito",
    };
    return names[method] || method;
  },

  async sendToKDS(data) {
    if (!database) {
      console.warn("⚠️ Firebase não conectado");
      return;
    }

    try {
      const paymentNames = {
        pix: "PIX",
        dinheiro: "Dinheiro",
        debito: "Débito",
        credito: "Crédito",
      };

      const itens = AppState.cart.map((item) => {
        const itemFormatado = {
          nome: item.nome,
          preco: item.selectedPrice || 0,
          quantidade: item.quantity || 1,
          qtd: item.quantity || 1,
        };

        const observacoes = [];

        if (item.isCombo && item.burgers) {
          item.burgers.forEach((burger) => {
            observacoes.push(`--- ${burger.nome} ---`);
            if (burger.meatPoint)
              observacoes.push(`Ponto: ${burger.meatPoint}`);
            if (burger.selectedCaldas && burger.selectedCaldas.length)
              observacoes.push(`Caldas: ${burger.selectedCaldas.join(", ")}`);
            if (burger.removed && burger.removed.length) {
              observacoes.push(`Sem: ${burger.removed.join(", ")}`);
            }
            if (burger.added && burger.added.length) {
              observacoes.push(
                `Adicionais: ${burger.added.map((a) => a.nome).join(", ")}`,
              );
            }
            if (burger.obs) observacoes.push(burger.obs);
          });
          if (item.selectedBatata) {
            observacoes.push(`Batata: ${item.selectedBatata}`);
          }
          if (item.selectedBebida) {
            observacoes.push(`Bebida: ${item.selectedBebida}`);
          }
        } else {
          if (item.selectedSize)
            observacoes.push(`Tamanho: ${item.selectedSize}`);
          if (item.meatPoint) observacoes.push(`Ponto: ${item.meatPoint}`);
          if (item.selectedCaldas && item.selectedCaldas.length)
            observacoes.push(`Caldas: ${item.selectedCaldas.join(", ")}`);
          if (item.removed && item.removed.length) {
            observacoes.push(`Sem: ${item.removed.join(", ")}`);
          }
          if (item.added && item.added.length) {
            const adicionaisNomes = item.added.map((a) => a.nome).join(", ");
            observacoes.push(`Adicionais: ${adicionaisNomes}`);
            itemFormatado.adicionais = item.added.map((a) => ({
              nome: a.nome,
              preco: a.preco,
            }));
          }
          if (item.obs) observacoes.push(item.obs);
        }

        if (observacoes.length > 0) {
          itemFormatado.observacao = observacoes.join(" | ");
        }

        return itemFormatado;
      });

      const pedido = {
        tipo: "delivery",
        tipoOrigem: "delivery",
        status: "pending",
        nomeCliente: data.customerName,
        cliente: data.customerName,
        nome: data.customerName,
        pagamento: paymentNames[data.paymentMethod],
        itens: itens,
        total: CartManager.getTotal(),
        timestamp: Date.now(),
        dataHora: new Date().toLocaleString("pt-BR"),
      };

      if (AppState.deliveryType === "delivery") {
        pedido.modoConsumo = "🛵 ENTREGA";
        pedido.endereco = `${data.address}`;
        if (data.complement) {
          pedido.endereco += ` - ${data.complement}`;
        }
        // Adicionar bairro
        if (data.neighborhoodInfo) {
          pedido.bairro = data.neighborhoodInfo.text;
        }
        // Adicionar taxa de entrega
        if (AppState.deliveryFee > 0) {
          pedido.taxaEntrega = AppState.deliveryFee;
        }
      } else {
        pedido.modoConsumo = "🏪 RETIRADA";
        pedido.endereco = "RETIRADA NO LOCAL";
      }

      if (data.paymentMethod === "dinheiro" && data.changeFor) {
        pedido.troco = `Troco para R$ ${data.changeFor}`;
      }

      const newOrderRef = database.ref("pedidos").push();
      await newOrderRef.set(pedido);

      console.log("✅ Pedido enviado ao KDS!");
      showToast("✅ Pedido enviado para a cozinha!");

      setTimeout(() => {
        CartManager.clear();
        SidebarUI.close();
      }, 1500);
    } catch (error) {
      console.error("❌ Erro ao enviar pedido:", error);
      showToast("⚠️ Erro ao enviar para a cozinha");
    }
  },
};

// ================================
// SEARCH
// ================================
const SearchManager = {
  init() {
    DOM.elements.searchInput.addEventListener(
      "input",
      Utils.debounce((e) => {
        this.handleSearch(e.target.value);
      }, 300),
    );
  },

  handleSearch(query) {
    if (!AppState.cardapioData) return;

    const lowerQuery = query.toLowerCase();

    if (!lowerQuery.trim()) {
      MenuUI.render(AppState.cardapioData);
      return;
    }

    const filtered = {};

    Object.entries(AppState.cardapioData).forEach(([category, items]) => {
      const matches = items.filter(
        (item) =>
          item.nome.toLowerCase().includes(lowerQuery) ||
          item.descricao?.toLowerCase().includes(lowerQuery),
      );

      if (matches.length) {
        filtered[category] = matches;
      }
    });

    MenuUI.render(filtered);
  },
};

// ================================
// EVENT LISTENERS
// ================================
const EventListeners = {
  init() {
    DOM.get("[data-close-modal]")?.addEventListener("click", () =>
      ModalUI.close(),
    );
    DOM.get("[data-btn-next]")?.addEventListener("click", () =>
      OrderFlow.nextStep(),
    );
    DOM.get("[data-btn-back]")?.addEventListener("click", () =>
      OrderFlow.prevStep(),
    );

    DOM.get("[data-action='toggle-sidebar']")?.addEventListener("click", () =>
      SidebarUI.toggle(),
    );
    DOM.get("[data-close-sidebar]")?.addEventListener("click", () =>
      SidebarUI.close(),
    );

    DOM.elements.overlay?.addEventListener("click", () => {
      const modalActive = DOM.elements.modal.classList.contains("active");
      const sidebarActive = DOM.elements.sidebar.classList.contains("active");

      if (modalActive) ModalUI.close();
      else if (sidebarActive) SidebarUI.close();
    });

    window.addEventListener("scroll", CategoriesUI.updateActiveOnScroll);

    CheckoutManager.init();
    SearchManager.init();
  },
};

// ================================
// APP INITIALIZATION
// ================================
const App = {
  async init() {
    try {
      initFirebase();
      AppState.cardapioData = await MenuService.loadMenu();
      CategoriesUI.render(Object.keys(AppState.cardapioData));
      MenuUI.render(AppState.cardapioData);
      CartUI.render();
      EventListeners.init();

      // Iniciar listener de disponibilidade
      MenuService.listenToAvailability();

      // Iniciar listener de disponibilidade de insumos
      MenuService.listenToIngredientsAvailability();

      // Iniciar listener de mudanças de preço - NEW
      MenuService.listenToPriceChanges();

      // Sincronizar preços inicialmente do Firebase - NEW
      await MenuService.syncPricesFromFirebase();

      console.log("✅ Sistema de sincronização de preços ativado");
    } catch (error) {
      MenuUI.renderError();
    }
  },
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => App.init());
} else {
  App.init();
}
