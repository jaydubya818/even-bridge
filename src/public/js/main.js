import { S } from "./state.js";
import { initUtils, log, setStatus, getStatusText } from "./utils.js";
import { initHistory, renderHistory } from "./history.js";
import { initBrowserUI } from "./ui/browser.js";
import { connectWebSocket } from "./ws.js";
import { toggleRecording } from "./recording.js";
import { loadLogoData, saveServiceSettings, deleteServiceSettings, startTelegramAuth, submitTelegramCode, submitTelegramPassword, fetchSettingsStatus } from "./api.js";
import {
  goToMessengerSelect, goToContacts, goToConversation,
  selectMessenger, sendPendingMessage, cancelPreview,
  refreshConversation, requestWakeLock,
  goToFolderSelect, goToMessageList, goToMessageView,
  goToSettings, leaveSettings,
} from "./state.js";
import { showStartupScreen, updateGlassesMessengerSelection, updateGlassesConversationPage, updateGlassesMessageViewPage } from "./ui/glasses.js";

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Bridge not detected within ${ms}ms`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

// --- Visibility change handler ---
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    S.pageAbort.abort();
    log("Page hidden — aborted in-flight fetches");
  } else if (document.visibilityState === "visible") {
    S.pageAbort = new AbortController();
    requestWakeLock();
    log("Page visible — resuming");

    const status = getStatusText();
    if (status.startsWith("Loading folders")) {
      log("Resuming from lock — retrying folders");
      goToFolderSelect();
    } else if (status.startsWith("Loading contacts") || status === "Initializing...") {
      log("Resuming from lock — retrying contacts");
      goToContacts();
    } else if (status.startsWith("Loading conversation") && S.session?.selectedContact) {
      log("Resuming from lock — retrying conversation");
      goToConversation(S.session.selectedContact);
    } else if (S.appState === "conversation" && S.session?.selectedContact) {
      log("Resuming from lock — refreshing conversation");
      refreshConversation();
    }

    if (!S.ws || S.ws.readyState === WebSocket.CLOSED || S.ws.readyState === WebSocket.CLOSING) {
      log("WebSocket dead after wake — reconnecting");
      connectWebSocket();
    }
  }
});

// --- Initialize ---
async function init() {
  const appTitleEl = document.getElementById("appTitle");
  const statusEl = document.getElementById("status");
  const messengerListEl = document.getElementById("messengerList");
  const contactListEl = document.getElementById("contactList");
  const conversationViewEl = document.getElementById("conversationView");
  const previewViewEl = document.getElementById("previewView");
  const recordBtn = document.getElementById("recordBtn");
  const historyEl = document.getElementById("history");
  const logEl = document.getElementById("log");
  const folderListEl = document.getElementById("folderList");
  const messageListEl = document.getElementById("messageList");
  const messageViewEl = document.getElementById("messageView");
  const settingsViewEl = document.getElementById("settingsView");
  const settingsBtn = document.getElementById("settingsBtn");
  const settingsBackBtn = document.getElementById("settingsBackBtn");

  initUtils({ statusEl, logEl });
  initHistory(historyEl);
  initBrowserUI({
    messengerListEl,
    contactListEl,
    conversationViewEl,
    previewViewEl,
    recordBtn,
    appTitleEl,
    folderListEl,
    messageListEl,
    messageViewEl,
    settingsViewEl,
  });

  log(`Even Bridge ${S.BUILD_VERSION} starting`);

  // Detect G2 bridge
  try {
    const sdk = await import(
      "https://cdn.jsdelivr.net/npm/@evenrealities/even_hub_sdk@latest/dist/index.js"
    );
    S.bridge = await withTimeout(sdk.waitForEvenAppBridge(), 2000);
    S.isG2 = true;
    log("G2 bridge detected (SDK)");
  } catch {
    if (typeof window.EvenAppBridge?.getInstance === "function") {
      S.bridge = window.EvenAppBridge.getInstance();
      S.isG2 = true;
      log("G2 bridge detected (raw)");
    }
  }

  if (S.isG2) {
    log("Running in G2 glasses mode");

    S.logoData = await loadLogoData();
    await showStartupScreen();

    // G2 event handler
    S.bridge.onEvenHubEvent((event) => {
      // Audio streaming during recording
      if (event.audioEvent?.audioPcm && S.isRecording) {
        if (S.ws && S.ws.readyState === WebSocket.OPEN) {
          S.ws.send(event.audioEvent.audioPcm);
        }
        return;
      }

      // List events (contact/folder/message selection)
      if (event.listEvent) {
        const { currentSelectItemIndex, eventType } = event.listEvent;
        if (eventType === 0 || eventType === undefined) {
          const idx = currentSelectItemIndex ?? 0;
          if (S.appState === "contacts") {
            const contact = S.session?.contacts[idx];
            if (contact) goToConversation(contact);
          } else if (S.appState === "folderSelect") {
            const folder = S.session?.folders[idx];
            if (folder) goToMessageList(folder);
          } else if (S.appState === "messageList") {
            const msg = S.session?.folderMessages[idx];
            if (msg) goToMessageView(msg);
          }
        } else if (eventType === 3) {
          if (S.appState === "contacts") goToMessengerSelect();
          else if (S.appState === "folderSelect") goToMessengerSelect();
          else if (S.appState === "messageList") goToFolderSelect();
        }
        return;
      }

      // Debug logging
      if (!event.audioEvent) {
        log("G2 event: " + JSON.stringify(Object.keys(event)) + " state=" + S.appState);
        const ev2 = event.textEvent || event.sysEvent;
        if (ev2) log("  eventType=" + ev2.eventType);
      }

      // Text/sys events (taps, double taps, scrolls)
      const ev = event.textEvent || event.sysEvent;
      if (!ev) return;

      const eventType = ev.eventType;

      // Single tap (0 or undefined)
      if (eventType === 0 || eventType === undefined) {
        if (S.appState === "messengerSelect") {
          const name = S.availableMessengers[S.messengerSelectIndex];
          if (name) selectMessenger(name);
          else goToMessengerSelect();
        } else if (S.appState === "recording") {
          toggleRecording();
        } else if (S.appState === "preview") {
          sendPendingMessage();
        } else if (S.appState === "conversation") {
          toggleRecording();
        } else if (S.appState === "messageView") {
          toggleRecording();
        }
      }
      // Double tap (3)
      else if (eventType === 3) {
        if (S.appState === "contacts") {
          goToMessengerSelect();
        } else if (S.appState === "conversation") {
          goToContacts();
        } else if (S.appState === "messageView") {
          goToMessageList(S.session?.selectedFolder);
        } else if (S.appState === "messageList") {
          goToFolderSelect();
        } else if (S.appState === "folderSelect") {
          goToMessengerSelect();
        }
      }
      // Scroll (1 or 2)
      else if (eventType === 1 || eventType === 2) {
        if (S.appState === "messengerSelect" && S.availableMessengers.length > 1) {
          S.messengerSelectIndex = eventType === 1
            ? Math.min(S.messengerSelectIndex + 1, S.availableMessengers.length - 1)
            : Math.max(S.messengerSelectIndex - 1, 0);
          updateGlassesMessengerSelection();
        } else if (S.appState === "conversation") {
          const maxPage = (S.conversationPages?.length || 1) - 1;
          if (eventType === 1 && S.conversationPage < maxPage) {
            S.conversationPage++;
            updateGlassesConversationPage();
          } else if (eventType === 2 && S.conversationPage > 0) {
            S.conversationPage--;
            updateGlassesConversationPage();
          }
        } else if (S.appState === "messageView") {
          const maxPage = (S.messageViewPages?.length || 1) - 1;
          if (eventType === 1 && S.messageViewPage < maxPage) {
            S.messageViewPage++;
            updateGlassesMessageViewPage();
          } else if (eventType === 2 && S.messageViewPage > 0) {
            S.messageViewPage--;
            updateGlassesMessageViewPage();
          }
        } else if (S.appState === "preview") {
          cancelPreview();
        }
      }
    });
  } else {
    log("Running in browser fallback mode (no G2 detected)");
  }

  connectWebSocket();
  renderHistory();
  requestWakeLock();

  goToMessengerSelect();

  // Browser event listeners
  conversationViewEl.querySelector(".back").addEventListener("click", () => {
    goToContacts();
  });
  messageViewEl.querySelector(".back").addEventListener("click", () => {
    goToMessageList(S.session?.selectedFolder);
  });
  recordBtn.addEventListener("click", toggleRecording);
  previewViewEl.querySelector(".send-btn").addEventListener("click", sendPendingMessage);
  previewViewEl.querySelector(".cancel-btn").addEventListener("click", cancelPreview);

  // Settings event listeners
  settingsBtn.addEventListener("click", () => goToSettings());
  settingsBackBtn.addEventListener("click", () => leaveSettings());

  // Delegated save/remove handlers for settings cards
  settingsViewEl.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    const service = btn.dataset.service;
    if (!service) return;

    if (btn.classList.contains("settings-save")) {
      const card = btn.closest(".settings-card");
      const inputs = card.querySelectorAll("input[data-field]");
      const data = {};
      for (const input of inputs) {
        data[input.dataset.field] = input.value.trim();
      }

      const hasValue = Object.values(data).some((v) => v);
      if (!hasValue) {
        log("No values to save");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Saving...";
      try {
        await saveServiceSettings(service, data);
        log(`${service} settings saved`);
        const status = await fetchSettingsStatus();
        const { showBrowserSettings } = await import("./ui/browser.js");
        showBrowserSettings(status);
      } catch (err) {
        log(`Error saving ${service}: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = "Save";
      }
    } else if (btn.classList.contains("settings-remove")) {
      btn.disabled = true;
      btn.textContent = "Removing...";
      try {
        await deleteServiceSettings(service);
        log(`${service} settings removed`);
        const card = btn.closest(".settings-card");
        card.querySelectorAll("input[data-field]").forEach((input) => {
          input.value = "";
        });
        const status = await fetchSettingsStatus();
        const { showBrowserSettings } = await import("./ui/browser.js");
        showBrowserSettings(status);
      } catch (err) {
        log(`Error removing ${service}: ${err.message}`);
      } finally {
        btn.disabled = false;
        btn.textContent = "Remove";
      }
    }
  });

  // Telegram auth flow handlers
  function updateTelegramAuthUI(result) {
    const phoneStep = document.getElementById("telegramPhoneStep");
    const codeStep = document.getElementById("telegramCodeStep");
    const passwordStep = document.getElementById("telegramPasswordStep");
    const authStatus = document.getElementById("telegramAuthStatus");

    phoneStep.style.display = "none";
    codeStep.style.display = "none";
    passwordStep.style.display = "none";
    authStatus.style.display = "none";

    if (result.state === "idle") {
      phoneStep.style.display = "block";
    } else if (result.state === "awaiting_code") {
      codeStep.style.display = "block";
    } else if (result.state === "awaiting_password") {
      passwordStep.style.display = "block";
    } else if (result.state === "authenticated") {
      authStatus.style.display = "block";
      authStatus.textContent = "Authenticated";
      authStatus.style.color = "var(--tc-green)";
      authStatus.style.background = "rgba(75, 185, 86, 0.1)";
    } else if (result.state === "error") {
      authStatus.style.display = "block";
      authStatus.textContent = result.error || "Authentication failed";
      authStatus.style.color = "var(--tc-red)";
      authStatus.style.background = "rgba(255, 69, 58, 0.1)";
      phoneStep.style.display = "block";
    }
  }

  document.getElementById("telegramAuthStart").addEventListener("click", async (e) => {
    const phone = document.getElementById("telegramPhone").value.trim();
    if (!phone) return;
    e.target.disabled = true;
    e.target.textContent = "Sending code...";
    try {
      const result = await startTelegramAuth(phone);
      log("Telegram auth: " + result.state);
      updateTelegramAuthUI(result);
    } catch (err) {
      log("Telegram auth error: " + err.message);
      updateTelegramAuthUI({ state: "error", error: err.message });
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Authenticate";
    }
  });

  document.getElementById("telegramCodeSubmit").addEventListener("click", async (e) => {
    const code = document.getElementById("telegramCode").value.trim();
    if (!code) return;
    e.target.disabled = true;
    e.target.textContent = "Verifying...";
    try {
      const result = await submitTelegramCode(code);
      log("Telegram code result: " + result.state);
      updateTelegramAuthUI(result);
    } catch (err) {
      log("Telegram code error: " + err.message);
      updateTelegramAuthUI({ state: "error", error: err.message });
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Submit Code";
    }
  });

  document.getElementById("telegramPasswordSubmit").addEventListener("click", async (e) => {
    const password = document.getElementById("telegramPassword").value.trim();
    if (!password) return;
    e.target.disabled = true;
    e.target.textContent = "Verifying...";
    try {
      const result = await submitTelegramPassword(password);
      log("Telegram password result: " + result.state);
      updateTelegramAuthUI(result);
    } catch (err) {
      log("Telegram password error: " + err.message);
      updateTelegramAuthUI({ state: "error", error: err.message });
    } finally {
      e.target.disabled = false;
      e.target.textContent = "Submit Password";
    }
  });
}

init().catch((err) => {
  log("Init error: " + err.message);
  setStatus("Error: " + err.message, "error");
});
