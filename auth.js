const authManager = {
  // Remote password source URL - Replace with the actual URL or GitHub Gist URL
  remotePasswordUrl:
    "https://raw.githubusercontent.com/stevencodeblooded/password-repo/refs/heads/main/password.txt",

  // Authentication timeout in days (how long until re-authentication is required)
  authTimeoutDays: 7,

  // Initialize auth module
  async initialize() {
    await this.checkRemotePassword();
    return this.isAuthenticated();
  },

  // Check if the user is currently authenticated
  async isAuthenticated() {
    try {
      const authData = await this.getAuthData();
      if (!authData) return false;

      // Check if auth has expired
      if (authData.expiry && new Date(authData.expiry) > new Date()) {
        return true;
      } else {
        // Auth expired, clear it
        await this.clearAuthData();
        return false;
      }
    } catch (error) {
      console.error("Error checking authentication:", error);
      return false;
    }
  },

  // Verify provided password
  async verifyPassword(password) {
    try {
      const currentPassword = await this.getCurrentPassword();
      return password === currentPassword;
    } catch (error) {
      console.error("Error verifying password:", error);
      // Fallback to default password if remote check fails
      return password === this.defaultPassword;
    }
  },

  // Login with password and remember option
  async login(password, remember) {
    const isValid = await this.verifyPassword(password);

    if (isValid) {
      const expiryDate = new Date();
      if (remember) {
        // Set expiry to X days in the future
        expiryDate.setDate(expiryDate.getDate() + this.authTimeoutDays);
      } else {
        // Set expiry to browser session (when popup closes)
        expiryDate.setDate(expiryDate.getDate() + 1); // 1 day max
      }

      await this.setAuthData({
        authenticated: true,
        expiry: expiryDate.toISOString(),
        remember: remember,
      });

      return true;
    }

    return false;
  },

  // Logout user
  async logout() {
    await this.clearAuthData();
  },

  // Get current active password (from remote or default)
  async getCurrentPassword() {
    const remotePasswordData = await this.getRemotePasswordData();
    if (remotePasswordData && remotePasswordData.password) {
      return remotePasswordData.password;
    }

    throw new Error("Remote password not available");
  },

  // Check remote password source for updates
  async checkRemotePassword() {
    try {
      const response = await fetch(this.remotePasswordUrl, {
        method: "GET",
        cache: "no-cache",
        headers: {
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
      });

      if (response.ok) {
        const password = await response.text();
        await this.saveRemotePasswordData({
          password: password.trim(),
          lastUpdated: new Date().toISOString(),
        });
        return true;
      }
    } catch (error) {
      console.log("Error checking remote password:", error);
    }

    return false;
  },

  // Storage methods
  async getAuthData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["authData"], (result) => {
        resolve(result.authData || null);
      });
    });
  },

  async setAuthData(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ authData: data }, () => {
        resolve(true);
      });
    });
  },

  async clearAuthData() {
    return new Promise((resolve) => {
      chrome.storage.local.remove(["authData"], () => {
        resolve(true);
      });
    });
  },

  async getRemotePasswordData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["remotePasswordData"], (result) => {
        resolve(result.remotePasswordData || null);
      });
    });
  },

  async saveRemotePasswordData(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ remotePasswordData: data }, () => {
        resolve(true);
      });
    });
  },
};

// Function to handle authentication UI
async function initializeAuthUI() {
  const loginPage = document.getElementById("login-page");
  const appContainer = document.getElementById("app-container");
  const passwordInput = document.getElementById("password");
  const rememberCheckbox = document.getElementById("remember");
  const loginBtn = document.getElementById("login-btn");
  const logoutBtn = document.getElementById("logout-btn");
  const loginErrorEl = document.getElementById("login-error");

  if (!loginPage || !appContainer) {
    console.error("Required DOM elements not found");
    return;
  }

  // Check if already authenticated
  await authManager.checkRemotePassword();
  const isAuthenticated = await authManager.isAuthenticated();

  if (isAuthenticated) {
    loginPage.style.display = "none";
    appContainer.style.display = "block";
  } else {
    loginPage.style.display = "block";
    appContainer.style.display = "none";
  }

  // Handle login
  loginBtn.addEventListener("click", async () => {
    const password = passwordInput.value;
    const remember = rememberCheckbox.checked;

    if (!password) {
      loginErrorEl.textContent = "Please enter a password";
      return;
    }

    // Show loading state
    loginBtn.textContent = "Logging in...";
    loginBtn.disabled = true;

    const success = await authManager.login(password, remember);

    if (success) {
      loginPage.style.display = "none";
      appContainer.style.display = "block";
      passwordInput.value = "";
      loginErrorEl.textContent = "";
    } else {
      loginErrorEl.textContent = "Invalid password";
      passwordInput.select();
    }

    // Reset button state
    loginBtn.textContent = "Login";
    loginBtn.disabled = false;
  });

  // Handle logout
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      await authManager.logout();
      loginPage.style.display = "block";
      appContainer.style.display = "none";
    });
  }

  // Handle enter key in password field
  passwordInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      loginBtn.click();
    }
  });
}

// Initialize authentication when the DOM is loaded
document.addEventListener("DOMContentLoaded", initializeAuthUI);

// Export the authManager
export default authManager;
