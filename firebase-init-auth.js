// ================================================================
// FIREBASE INITIALIZATION WITH AUTHENTICATION
// ================================================================

const firebaseConfig = {
  apiKey: "AIzaSyDFFbaZmX80QezLfozPAIaIGEhIJm9z43E",
  authDomain: "ribbsznmesas.firebaseapp.com",
  databaseURL: "https://ribbsznmesas-default-rtdb.firebaseio.com",
  projectId: "ribbsznmesas",
  storageBucket: "ribbsznmesas.firebasestorage.app",
  messagingSenderId: "970185571294",
  appId: "1:970185571294:web:25e8552bd72d852283bb4f",
};

// Initialize Firebase
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
  console.log("✅ Firebase inicializado");
}

// Get Firebase services
const auth = firebase.auth();
const database = firebase.database();

// ================================================================
// AUTHENTICATION STATE MANAGEMENT
// ================================================================

let isAuthenticated = false;

// Check if this is the KDS page
const isKDSPage = window.location.pathname.includes("kds.html");

if (isKDSPage) {
  console.log("🔐 KDS - Autenticação necessária");

  // Check authentication state
  auth.onAuthStateChanged((user) => {
    if (user) {
      console.log("✅ Usuário autenticado:", user.email);
      isAuthenticated = true;

      // Hide login screen if it exists
      const loginScreen = document.getElementById("login-screen");
      if (loginScreen) {
        loginScreen.style.display = "none";
      }

      // Show main content
      const mainContent = document.querySelector(".kds-header");
      const kdsMain = document.querySelector(".kds-main");
      if (mainContent) mainContent.style.display = "flex";
      if (kdsMain) kdsMain.style.display = "flex";

      // Initialize KDS if the init function exists
      if (typeof window.initKDS === "function") {
        window.initKDS();
      }
    } else {
      console.log("❌ Usuário não autenticado");
      isAuthenticated = false;

      // Show login screen
      const loginScreen = document.getElementById("login-screen");
      if (loginScreen) {
        loginScreen.style.display = "flex";
      }

      // Hide main content
      const mainContent = document.querySelector(".kds-header");
      const kdsMain = document.querySelector(".kds-main");
      if (mainContent) mainContent.style.display = "none";
      if (kdsMain) kdsMain.style.display = "none";
    }
  });
} else {
  console.log("📱 Index/Totem - Sem autenticação necessária");
  isAuthenticated = true; // Index e Totem não precisam de autenticação
}

// ================================================================
// LOGIN FUNCTION FOR KDS
// ================================================================

window.loginWithPin = async function (pin) {
  try {
    // Validate PIN format
    if (!/^\d{6}$/.test(pin)) {
      throw new Error("PIN deve ter exatamente 6 dígitos");
    }

    // Email fixo (oculto do usuário no código)
    const email = "rbnacena@gmail.com";
    // O PIN digitado pelo usuário É a senha do Firebase
    const password = pin;

    console.log("🔐 Tentando autenticação...");

    // Faz login no Firebase: email fixo + PIN como senha
    await auth.signInWithEmailAndPassword(email, password);
    console.log("✅ Login bem-sucedido!");
    return { success: true };
  } catch (error) {
    console.error("❌ Erro no login:", error);

    let errorMessage = "PIN incorreto";

    switch (error.code) {
      case "auth/wrong-password":
        errorMessage = "PIN incorreto. Tente novamente.";
        break;
      case "auth/user-not-found":
        errorMessage = "Usuário não encontrado no Firebase.";
        break;
      case "auth/too-many-requests":
        errorMessage = "Muitas tentativas. Aguarde um momento.";
        break;
      default:
        errorMessage = "Erro ao autenticar: " + error.message;
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
};

// ================================================================
// LOGOUT FUNCTION
// ================================================================

window.logoutKDS = async function () {
  try {
    await auth.signOut();
    console.log("✅ Logout realizado");

    // Reload page to show login screen
    window.location.reload();
  } catch (error) {
    console.error("❌ Erro ao fazer logout:", error);
  }
};

// Export for use in other scripts
window.firebaseAuth = auth;
window.firebaseDatabase = database;
window.isAuthenticated = () => isAuthenticated;
