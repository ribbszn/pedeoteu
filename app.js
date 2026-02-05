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

function initFirebase() {
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
    console.log("✅ Firebase inicializado com sucesso");
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
          margin-top: 10px;
          background: rgba(244, 67, 54, 0.1);
          padding: 5px 10px;
          border-radius: 5px;
        `;
        info.appendChild(unavailableTag);
      }
    }
  },

  getPlaceholderImage() {
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='140'%3E%3Crect fill='%23222' width='200' height='140'/%3E%3Ctext fill='%23666' x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-family='sans-serif' font-size='14'%3ESem imagem%3C/text%3E%3C/svg%3E";
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

    if (item.pontoCarne && Array.isArray(item.pontoCarne)) {
      steps.push({ type: "meatPoint", data: item.pontoCarne, burgerName });
    }

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

    if (item.pontoCarne && Array.isArray(item.pontoCarne)) {
      steps.push({ type: "meatPoint", data: item.pontoCarne });
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

    // Torna toda a linha clicável
    body.querySelectorAll(".option-row").forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      row.addEventListener("click", (e) => {
        // Se clicar no checkbox, deixa ele lidar naturalmente
        // Se clicar em qualquer outro lugar (label, div), toggle o checkbox
        if (e.target.tagName !== "INPUT") {
          e.preventDefault();
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event("change"));
        }
      });
    });

    body.querySelectorAll('input[type="checkbox"]').forEach((input) => {
      input.onchange = (e) => {
        const val = e.target.value;
        if (e.target.checked) {
          if (!AppState.tempItem.selectedCaldas.includes(val))
            AppState.tempItem.selectedCaldas.push(val);
        } else {
          AppState.tempItem.selectedCaldas =
            AppState.tempItem.selectedCaldas.filter((c) => c !== val);
        }
      };
    });
  },

  renderRetiradas(title, body, options, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Remover algo?`;

    body.innerHTML = options
      .map(
        (opt, i) => `
      <div class="option-row">
        <label for="rem-${i}" style="flex:1; cursor:pointer;">${opt}</label>
        <input type="checkbox" id="rem-${i}" value="${opt}" ${AppState.tempItem.removed.includes(opt) ? "checked" : ""}>
      </div>
    `,
      )
      .join("");

    // Torna toda a linha clicável
    body.querySelectorAll(".option-row").forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      row.addEventListener("click", (e) => {
        // Se clicar no checkbox, deixa ele lidar naturalmente
        // Se clicar em qualquer outro lugar (label, div), toggle o checkbox
        if (e.target.tagName !== "INPUT") {
          e.preventDefault();
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event("change"));
        }
      });
    });

    body.querySelectorAll("input").forEach((input) => {
      input.onchange = (e) => {
        const val = e.target.value;
        if (e.target.checked) {
          if (!AppState.tempItem.removed.includes(val))
            AppState.tempItem.removed.push(val);
        } else {
          AppState.tempItem.removed = AppState.tempItem.removed.filter(
            (item) => item !== val,
          );
        }
      };
    });
  },

  renderExtras(title, body, extras, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Adicionais (pagos) 🍔`;

    body.innerHTML = extras
      .map(
        (extra, i) => `
      <div class="option-row">
        <label for="extra-${i}" style="flex:1; cursor:pointer;">${extra.nome} (+${Utils.formatPrice(extra.preco)})</label>
        <input type="checkbox" id="extra-${i}" value="${extra.nome}" data-price="${extra.preco}"
          ${AppState.tempItem.added.some((a) => a.nome === extra.nome) ? "checked" : ""}>
      </div>
    `,
      )
      .join("");

    // Torna toda a linha clicável
    body.querySelectorAll(".option-row").forEach((row) => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      row.addEventListener("click", (e) => {
        // Se clicar no checkbox, deixa ele lidar naturalmente
        // Se clicar em qualquer outro lugar (label, div), toggle o checkbox
        if (e.target.tagName !== "INPUT") {
          e.preventDefault();
          checkbox.checked = !checkbox.checked;
          checkbox.dispatchEvent(new Event("change"));
        }
      });
    });

    body.querySelectorAll("input").forEach((input) => {
      input.onchange = (e) => {
        const nome = e.target.value;
        const preco = parseFloat(e.target.dataset.price);
        if (e.target.checked) {
          AppState.tempItem.added.push({ nome, preco });
          AppState.tempItem.finalPrice += preco;
        } else {
          AppState.tempItem.added = AppState.tempItem.added.filter(
            (a) => a.nome !== nome,
          );
          AppState.tempItem.finalPrice -= preco;
        }
      };
    });
  },

  renderObservacoes(title, body, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Alguma observação? 💬`;

    body.innerHTML = `
      <textarea 
        class="obs-textarea" 
        placeholder="Se precisar de alguma observação, digite aqui. Caso contrário, prossiga com o pedido."
        style="width:100%; min-height:120px; padding:12px; background:#111; color:#fff; border:1px solid #333; border-radius:8px; font-family:inherit;"
      >${AppState.tempItem.obs || ""}</textarea>
    `;

    body.querySelector("textarea").oninput = (e) => {
      AppState.tempItem.obs = e.target.value;
    };
  },

  renderBatataUpgrade(title, body, options) {
    title.textContent = "Escolha a Batata 🍟";

    body.innerHTML = options
      .map((opt, i) => {
        const isChecked = AppState.comboData.selectedBatata === opt.nome;
        return `
      <div class="option-row">
        <label for="batata-${i}" style="flex:1; cursor:pointer;">
          ${opt.nome} 
          ${opt.adicional !== 0 ? `(${opt.adicional > 0 ? "+" : ""}${Utils.formatPrice(opt.adicional)})` : ""}
        </label>
        <input type="radio" id="batata-${i}" name="batataUpgrade" value="${opt.nome}" 
          data-price="${opt.adicional}" ${isChecked ? "checked" : ""}>
      </div>
    `;
      })
      .join("");

    body.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.onchange = (e) => {
        AppState.comboData.selectedBatata = e.target.value;
        AppState.comboData.batataPriceAdjust = parseFloat(
          e.target.dataset.price,
        );
      };
    });

    // Seleciona a primeira opção por padrão
    if (!AppState.comboData.selectedBatata && options.length > 0) {
      AppState.comboData.selectedBatata = options[0].nome;
      AppState.comboData.batataPriceAdjust = options[0].adicional;
      body.querySelector('input[type="radio"]').checked = true;
    }
  },

  renderBebidaUpgrade(title, body, options) {
    title.textContent = "Escolha a Bebida 🥤";

    body.innerHTML = options
      .map((opt, i) => {
        const isChecked = AppState.comboData.selectedBebida === opt.nome;
        return `
      <div class="option-row">
        <label for="bebida-${i}" style="flex:1; cursor:pointer;">
          ${opt.nome} 
          ${opt.adicional !== 0 ? `(${opt.adicional > 0 ? "+" : ""}${Utils.formatPrice(opt.adicional)})` : ""}
        </label>
        <input type="radio" id="bebida-${i}" name="bebidaUpgrade" value="${opt.nome}" 
          data-price="${opt.adicional}" ${isChecked ? "checked" : ""}>
      </div>
    `;
      })
      .join("");

    body.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.onchange = (e) => {
        AppState.comboData.selectedBebida = e.target.value;
        AppState.comboData.bebidaPriceAdjust = parseFloat(
          e.target.dataset.price,
        );
      };
    });

    // Seleciona a primeira opção por padrão
    if (!AppState.comboData.selectedBebida && options.length > 0) {
      AppState.comboData.selectedBebida = options[0].nome;
      AppState.comboData.bebidaPriceAdjust = options[0].adicional;
      body.querySelector('input[type="radio"]').checked = true;
    }
  },

  nextStep() {
    if (AppState.currentStep < AppState.stepsData.length - 1) {
      AppState.currentStep++;
      this.renderCurrentStep();
    } else {
      if (AppState.isCombo) this.finishCurrentBurger();
      else this.finishSingleItem();
    }
  },

  finishCurrentBurger() {
    AppState.comboItems.push({ ...AppState.tempItem });

    const isLastBurger =
      AppState.currentBurgerIndex ===
      AppState.comboData.itemRef.burgers.length - 1;

    if (!isLastBurger) {
      // Ainda tem burgers para personalizar
      AppState.currentBurgerIndex++;
      this.startNextBurgerInCombo();
    } else if (AppState.isFullCombo) {
      // Último burger de um combo COMPLETO - vai para batata
      this.startBatataStep();
    } else {
      // Último burger de um combo SIMPLES - finaliza
      this.finishCombo();
    }
  },

  startBatataStep() {
    const { upgrades } = AppState.comboData;

    AppState.stepsData = [
      { type: "batataUpgrade", data: upgrades.batata },
      { type: "bebidaUpgrade", data: upgrades.bebida },
    ];
    AppState.currentStep = 0;

    this.renderCurrentStep();
  },

  finishCombo() {
    let totalAddedPrice = 0;
    AppState.comboItems.forEach((burger) => {
      totalAddedPrice += burger.finalPrice;
    });

    // Adiciona ajustes de batata e bebida se for combo completo
    if (AppState.isFullCombo) {
      totalAddedPrice +=
        AppState.comboData.batataPriceAdjust +
        AppState.comboData.bebidaPriceAdjust;
    }

    const comboFinalPrice = AppState.comboData.basePrice + totalAddedPrice;

    const comboItem = {
      nome: AppState.comboData.nomeCombo,
      categoria: AppState.comboData.categoria,
      selectedSize: AppState.comboData.selectedSize,
      selectedPrice: AppState.comboData.basePrice,
      isCombo: true,
      burgers: AppState.comboItems,
      finalPrice: comboFinalPrice,
    };

    // Adiciona info de batata e bebida se for combo completo
    if (AppState.isFullCombo) {
      comboItem.selectedBatata = AppState.comboData.selectedBatata;
      comboItem.selectedBebida = AppState.comboData.selectedBebida;
      comboItem.batataPriceAdjust = AppState.comboData.batataPriceAdjust;
      comboItem.bebidaPriceAdjust = AppState.comboData.bebidaPriceAdjust;
    }

    CartManager.add(comboItem);
    showToast("✅ Combo adicionado ao carrinho!");
    ModalUI.close();

    AppState.isCombo = false;
    AppState.isFullCombo = false;
    AppState.comboData = null;
    AppState.currentBurgerIndex = 0;
    AppState.comboItems = [];
  },

  finishSingleItem() {
    CartManager.add(AppState.tempItem);
    showToast("✅ Adicionado ao carrinho!");
    ModalUI.close();
  },

  prevStep() {
    if (AppState.currentStep > 0) {
      AppState.currentStep--;
      this.renderCurrentStep();
    }
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
        detailsHtml += `<div style="margin-left: 10px;">• ${burger.nome}</div>`;
      });
      if (item.selectedBatata) {
        detailsHtml += `<div style="margin-top: 3px;">🍟 ${item.selectedBatata}</div>`;
      }
      if (item.selectedBebida) {
        detailsHtml += `<div>🥤 ${item.selectedBebida}</div>`;
      }
    } else {
      if (item.selectedCaldas?.length)
        detailsHtml += `<div>Calda: ${item.selectedCaldas.join(", ")}</div>`;
      if (item.removed?.length)
        detailsHtml += `<div style="color: #ff4444;">Sem: ${item.removed.join(", ")}</div>`;
      if (item.added?.length) {
        const addedNames = item.added.map((a) => a.nome).join(", ");
        detailsHtml += `<div style="color: #4CAF50;">➕ Adicionais: ${addedNames}</div>`;
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
      });
    });

    const paymentSelect = form.querySelector('[name="paymentMethod"]');
    if (paymentSelect) {
      paymentSelect.addEventListener("change", (e) => {
        const changeField = DOM.elements.changeField;
        if (e.target.value === "dinheiro") {
          changeField.style.display = "block";
        } else {
          changeField.style.display = "none";
        }
      });
    }

    // Listener para seleção de bairro
    const neighborhoodSelect = form.querySelector("[data-neighborhood-select]");
    if (neighborhoodSelect) {
      neighborhoodSelect.addEventListener("change", (e) => {
        this.handleNeighborhoodChange(e.target);
      });
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleCheckout(new FormData(form));
    });
  },

  handleNeighborhoodChange(select) {
    const selectedOption = select.options[select.selectedIndex];
    const fee = parseFloat(selectedOption.dataset.fee || 0);
    const neighborhoodValue = select.value;
    const neighborhoodText = selectedOption.text;

    AppState.deliveryFee = fee;
    AppState.selectedNeighborhood = {
      value: neighborhoodValue,
      text: neighborhoodText,
      fee: fee,
    };

    // Atualizar display da taxa
    const feeDisplay = document.querySelector("[data-delivery-fee-display]");
    const feeValue = document.querySelector("[data-delivery-fee-value]");

    if (feeDisplay && feeValue) {
      if (neighborhoodValue) {
        feeDisplay.style.display = "flex";

        if (neighborhoodValue === "campo-grande") {
          feeValue.textContent = "A combinar";
          feeDisplay.classList.add("campo-grande");
          // Mostrar alert
          alert(
            "⚠️ ATENÇÃO: A taxa de entrega para Campo Grande será informada via WhatsApp.",
          );
        } else {
          feeValue.textContent = `R$ ${fee.toFixed(2).replace(".", ",")}`;
          feeDisplay.classList.remove("campo-grande");
        }
      } else {
        feeDisplay.style.display = "none";
        feeDisplay.classList.remove("campo-grande");
      }
    }

    // Atualizar total
    CartUI.render();
  },

  handleCheckout(formData) {
    if (AppState.cart.length === 0) {
      showToast("⚠️ Seu carrinho está vazio!");
      return;
    }

    const data = {
      customerName: formData.get("customerName"),
      paymentMethod: formData.get("paymentMethod"),
      changeFor: formData.get("changeFor"),
    };

    if (AppState.deliveryType === "delivery") {
      data.neighborhood = formData.get("neighborhood");
      data.address = formData.get("address");
      data.complement = formData.get("complement");
      data.deliveryFee = AppState.deliveryFee;
      data.neighborhoodInfo = AppState.selectedNeighborhood;

      if (!data.neighborhood || !data.address) {
        showToast("⚠️ Preencha o bairro e o endereço!");
        return;
      }
    }

    if (!data.customerName || !data.paymentMethod) {
      showToast("⚠️ Preencha todos os campos obrigatórios!");
      return;
    }

    this.sendToWhatsApp(data);
    this.sendToKDS(data);
  },

  sendToWhatsApp(data) {
    let message = `🍔 *NOVO PEDIDO - RIBBS ZN* 🍔\n\n`;
    message += `━━━━━━━━━━━━━━━━━━\n`;
    message += `👤 *CLIENTE*\n`;
    message += `━━━━━━━━━━━━━━━━━━\n`;
    message += `Nome: *${data.customerName}*\n`;

    if (AppState.deliveryType === "delivery") {
      message += `📍 Tipo: *ENTREGA*\n`;
      message += `Endereço: ${data.address}, ${data.number}\n`;
      if (data.complement) {
        message += `Complemento: ${data.complement}\n`;
      }
    } else {
      message += `📍 Tipo: *RETIRADA NO LOCAL*\n`;
    }

    message += `\n━━━━━━━━━━━━━━━━━━\n`;
    message += `📦 *ITENS DO PEDIDO:*\n`;
    message += `━━━━━━━━━━━━━━━━━━\n\n`;

    AppState.cart.forEach((item, idx) => {
      message += `${idx + 1}. *${item.nome}*\n`;

      if (item.isCombo && item.burgers) {
        message += `   📦 Combo contém:\n`;
        item.burgers.forEach((burger) => {
          message += `   • *${burger.nome}*\n`;
          if (burger.meatPoint) message += `     Ponto: ${burger.meatPoint}\n`;
          if (burger.selectedCaldas && burger.selectedCaldas.length)
            message += `     Caldas: ${burger.selectedCaldas.join(", ")}\n`;
          if (burger.removed && burger.removed.length) {
            message += `     ❌ Sem: ${burger.removed.join(", ")}\n`;
          }
          if (burger.added && burger.added.length) {
            message += `     ➕ Adicionais: ${burger.added.map((a) => a.nome).join(", ")}\n`;
          }
          if (burger.obs) message += `     💬 Obs: ${burger.obs}\n`;
        });
        if (item.selectedBatata) {
          message += `   🍟 Batata: ${item.selectedBatata}\n`;
        }
        if (item.selectedBebida) {
          message += `   🥤 Bebida: ${item.selectedBebida}\n`;
        }
      } else {
        if (item.selectedSize) message += `   Tamanho: ${item.selectedSize}\n`;
        if (item.meatPoint) message += `   Ponto: ${item.meatPoint}\n`;
        if (item.selectedCaldas && item.selectedCaldas.length)
          message += `   Caldas: ${item.selectedCaldas.join(", ")}\n`;
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
