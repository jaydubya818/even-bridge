import { log, setStatus } from "./utils.js";
import { fetchAvailableMessengers, fetchContacts, fetchLastRecipient, fetchMessages, loadMessengerIcons, fetchFolders, fetchFolderMessages, fetchFolderMessage, fetchSettingsStatus } from "./api.js";
import { showBrowserMessengerList, hideBrowserMessengerList, showBrowserContacts, hideBrowserContacts, showBrowserConversation, hideBrowserConversation, showBrowserPreview, hideBrowserPreview, updateAppTitle, updateRecordButton, showBrowserFolderList, hideBrowserFolderList, showBrowserMessageList, hideBrowserMessageList, showBrowserMessageView, hideBrowserMessageView, showBrowserSettings, hideBrowserSettings } from "./ui/browser.js";
import { showGlassesMessengerSelect, showGlassesContactList, showGlassesConversation, showGlassesPreview, rebuildGlassesDisplay, showGlassesFolderList, showGlassesMessageList, showGlassesMessageView } from "./ui/glasses.js";
import { saveMessage, renderHistory } from "./history.js";

// --- Messenger session factories ---
// Each messenger type gets its own session shape.
// Add new factory when adding a messenger with different navigation.

function createChatSession() {
  return {
    type: "chat",
    contacts: [],
    selectedContact: null,
    conversationMessages: [],
  };
}

function createFolderSession() {
  return {
    type: "folder",
    folders: [],
    selectedFolder: null,
    folderMessages: [],
    selectedMessage: null,
  };
}

export const S = {
  // --- Hardware & connection ---
  ws: null,
  isRecording: false,
  bridge: null,
  isG2: false,
  audioContext: null,
  scriptProcessor: null,
  mediaStream: null,

  // --- App UI state ---
  appState: "startup",
  pendingText: "",
  logoData: null,
  messengerIconData: {},
  startupShown: false,
  conversationPollTimer: null,
  wakeLock: null,
  pageAbort: new AbortController(),
  displayRebuilt: false,
  conversationPages: [],
  conversationPage: 0,
  messageViewPages: [],
  messageViewPage: 0,

  // --- Messenger selection ---
  availableMessengers: [],
  selectedMessengerName: null,
  messengerSelectIndex: 0,
  messengerSelectBuilt: false,

  // --- Active messenger session (created on select, null on switch) ---
  // Shape depends on messenger type — see createChatSession / createFolderSession
  session: null,

  BUILD_VERSION: "v1.3.3",
};

// --- Wake lock ---
export async function requestWakeLock() {
  if (S.wakeLock) return;
  try {
    if ("wakeLock" in navigator) {
      S.wakeLock = await navigator.wakeLock.request("screen");
      S.wakeLock.addEventListener("release", () => {
        S.wakeLock = null;
      });
      log("Wake lock acquired");
    }
  } catch (e) {
    log("Wake lock failed: " + e.message);
  }
}

// --- Conversation polling ---
export function startConversationPolling() {
  stopConversationPolling();
  S.conversationPollTimer = setInterval(async () => {
    if (S.appState !== "conversation" || !S.session?.selectedContact) {
      stopConversationPolling();
      return;
    }
    try {
      const entityId = S.session.selectedContact.username || S.session.selectedContact.id;
      const msgs = await fetchMessages(entityId);
      if (S.appState !== "conversation") return;
      const newKey = JSON.stringify(msgs);
      const changed = newKey !== S._lastConvKey;
      S._lastConvKey = newKey;
      S.session.conversationMessages = msgs;
      if (S.isG2 && changed && S.conversationPage === 0) {
        showGlassesConversation();
      }
      showBrowserConversation();
    } catch {}
  }, 5000);
}

export function stopConversationPolling() {
  if (S.conversationPollTimer) {
    clearInterval(S.conversationPollTimer);
    S.conversationPollTimer = null;
  }
}

// --- State transitions ---
export function selectMessenger(name) {
  S.appState = "processing";
  S.selectedMessengerName = name;
  const displayName = name.charAt(0).toUpperCase() + name.slice(1);

  hideBrowserMessengerList();
  setStatus(`Connecting to ${displayName}...`);
  if (S.isG2) {
    S.displayRebuilt = false;
    rebuildGlassesDisplay(`Connecting to ${displayName}...`, true);
  }

  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify({ type: "select-messenger", name }));
  }
}

// --- Settings ---

export async function goToSettings() {
  S.appState = "settings";
  S.displayRebuilt = false;

  hideBrowserMessengerList();
  hideBrowserContacts();
  hideBrowserConversation();
  hideBrowserPreview();
  hideBrowserFolderList();
  hideBrowserMessageList();
  hideBrowserMessageView();

  setStatus("Settings");

  if (S.isG2) {
    rebuildGlassesDisplay("Configure in\nbrowser settings", true);
  }

  try {
    const status = await fetchSettingsStatus();
    showBrowserSettings(status);
  } catch (e) {
    log("Error loading settings: " + e.message);
    setStatus("Error loading settings", "error");
  }
}

export function leaveSettings() {
  hideBrowserSettings();
  goToMessengerSelect();
}

export async function goToMessengerSelect() {
  S.appState = "messengerSelect";
  S.selectedMessengerName = null;
  S.session = null;
  S.pendingText = "";
  S.displayRebuilt = false;
  S.messengerSelectIndex = 0;
  S.messengerSelectBuilt = false;
  stopConversationPolling();
  requestWakeLock();

  hideBrowserContacts();
  hideBrowserConversation();
  hideBrowserPreview();
  hideBrowserFolderList();
  hideBrowserMessageList();
  hideBrowserMessageView();
  hideBrowserSettings();

  setStatus("Loading messengers...");
  if (S.isG2) rebuildGlassesDisplay("Loading messengers...", true);

  try {
    S.availableMessengers = await fetchAvailableMessengers();
    S.messengerIconData = await loadMessengerIcons(S.availableMessengers);
    log(`Available messengers: ${S.availableMessengers.join(", ")}`);
  } catch (e) {
    log("Error loading messengers: " + e.message);
    setStatus("Error loading messengers", "error");
    if (S.isG2) rebuildGlassesDisplay("Connection error.\nTap to retry.", true);
    return;
  }

  if (S.availableMessengers.length === 0) {
    setStatus("No messengers configured");
    if (S.isG2) rebuildGlassesDisplay("Configure in\nbrowser settings", true);
    goToSettings();
    return;
  }

  setStatus("Select a messenger");

  if (S.isG2) {
    await showGlassesMessengerSelect();
  }
  showBrowserMessengerList((name) => selectMessenger(name));
}

// --- Chat messenger navigation (Telegram, Slack) ---

export async function goToContacts() {
  S.session = createChatSession();
  S.appState = "contacts";
  S.pendingText = "";
  S.displayRebuilt = false;
  stopConversationPolling();
  requestWakeLock();

  hideBrowserMessengerList();
  hideBrowserConversation();
  hideBrowserPreview();

  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    setStatus(attempt === 1 ? "Loading contacts..." : `Retrying contacts (${attempt - 1}/${maxRetries})...`);
    rebuildGlassesDisplay(attempt === 1 ? "Loading contacts..." : `Retrying... (${attempt - 1}/${maxRetries})`, true);

    try {
      const [fetchedContacts, lastRecipient] = await Promise.all([
        fetchContacts(),
        fetchLastRecipient(),
      ]);
      S.session.contacts = fetchedContacts;
      log(`Loaded ${S.session.contacts.length} contacts`);

      if (lastRecipient && lastRecipient.id) {
        const idx = S.session.contacts.findIndex((c) => c.id === lastRecipient.id);
        if (idx > 0) {
          const [contact] = S.session.contacts.splice(idx, 1);
          S.session.contacts.unshift(contact);
          log(`Last recipient "${lastRecipient.name}" moved to top`);
        }
      }
      break;
    } catch (e) {
      log(`Error loading contacts (attempt ${attempt}): ` + e.message);
      if (attempt > maxRetries) {
        setStatus("Connection failed", "error");
        rebuildGlassesDisplay("Connection failed.\nReturning to main screen...", true);
        setTimeout(() => goToMessengerSelect(), 3000);
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  if (S.session.contacts.length === 0) {
    setStatus("No contacts found", "error");
    rebuildGlassesDisplay("No contacts found", true);
    showBrowserContacts(() => {});
    return;
  }

  setStatus("Select a contact");
  log(`isG2=${S.isG2}, contacts=${S.session.contacts.length}, names=${S.session.contacts.slice(0,3).map(c=>c.name).join(",")}`);

  if (S.isG2) {
    await new Promise((r) => setTimeout(r, 150));
    log("Calling showGlassesContactList...");
    showGlassesContactList();
  }
  showBrowserContacts((contact) => goToConversation(contact));
}

export async function goToConversation(contact) {
  S.session.selectedContact = contact;
  S.appState = "conversation";
  S.conversationPage = 0;
  S._lastConvKey = null;
  log(`Selected contact: ${contact.name}`);
  requestWakeLock();

  hideBrowserContacts();
  hideBrowserPreview();

  S.displayRebuilt = false;

  const maxRetries = 3;
  let loaded = false;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    setStatus(attempt === 1 ? `Loading conversation with ${contact.name}...` : `Retrying (${attempt - 1}/${maxRetries})...`);
    rebuildGlassesDisplay(attempt === 1 ? "Loading conversation..." : `Retrying... (${attempt - 1}/${maxRetries})`, true);

    try {
      const entityId = contact.username || contact.id;
      S.session.conversationMessages = await fetchMessages(entityId);
      log(`Loaded ${S.session.conversationMessages.length} messages`);
      loaded = true;
      break;
    } catch (e) {
      log(`Error loading messages (attempt ${attempt}): ` + e.message);
      if (attempt > maxRetries) {
        setStatus("Connection failed", "error");
        rebuildGlassesDisplay("Connection failed.\nReturning to contacts...", true);
        setTimeout(() => goToContacts(), 3000);
        return;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
  if (!loaded) {
    S.session.conversationMessages = [];
  }

  S._lastConvKey = JSON.stringify(S.session.conversationMessages);
  setStatus(`Conversation with ${contact.name}`);

  if (S.isG2) {
    showGlassesConversation(true);
  }
  showBrowserConversation();
  startConversationPolling();
}

export async function refreshConversation() {
  if (!S.session?.selectedContact) return;
  S.conversationPage = 0;
  S.displayRebuilt = false;
  S._lastConvKey = null;
  try {
    const entityId = S.session.selectedContact.username || S.session.selectedContact.id;
    S.session.conversationMessages = await fetchMessages(entityId);
    log(`Refreshed conversation: ${S.session.conversationMessages.length} messages`);
  } catch (e) {
    log("Error refreshing messages: " + e.message);
  }

  S.appState = "conversation";
  setStatus(`Conversation with ${S.session.selectedContact.name}`);

  if (S.isG2) {
    showGlassesConversation();
  }
  showBrowserConversation();
  hideBrowserPreview();
  startConversationPolling();
}

// --- Folder messenger navigation (Gmail) ---

export async function goToFolderSelect() {
  S.session = createFolderSession();
  S.appState = "folderSelect";
  S.displayRebuilt = false;
  requestWakeLock();

  hideBrowserMessengerList();
  hideBrowserContacts();
  hideBrowserConversation();
  hideBrowserPreview();
  hideBrowserMessageList();
  hideBrowserMessageView();

  setStatus("Loading folders...");
  rebuildGlassesDisplay("Loading folders...", true);

  try {
    S.session.folders = await fetchFolders();
    log(`Loaded ${S.session.folders.length} folders`);
  } catch (e) {
    log("Error loading folders: " + e.message);
    setStatus("Connection failed", "error");
    rebuildGlassesDisplay("Connection failed.\nReturning...", true);
    setTimeout(() => goToMessengerSelect(), 3000);
    return;
  }

  if (S.session.folders.length === 0) {
    setStatus("No folders found", "error");
    rebuildGlassesDisplay("No folders found", true);
    return;
  }

  setStatus("Select a folder");

  if (S.isG2) {
    await new Promise((r) => setTimeout(r, 150));
    showGlassesFolderList();
  }
  showBrowserFolderList((folder) => goToMessageList(folder));
}

export async function goToMessageList(folder) {
  if (!folder) {
    goToFolderSelect();
    return;
  }
  S.session.selectedFolder = folder;
  S.session.selectedMessage = null;
  S.appState = "messageList";
  S.displayRebuilt = false;
  requestWakeLock();

  hideBrowserFolderList();
  hideBrowserMessageView();
  hideBrowserPreview();

  setStatus(`Loading ${folder.name}...`);
  rebuildGlassesDisplay(`Loading ${folder.name}...`, true);

  try {
    S.session.folderMessages = await fetchFolderMessages(folder.id, 10);
    log(`Loaded ${S.session.folderMessages.length} messages from ${folder.name}`);
  } catch (e) {
    log("Error loading messages: " + e.message);
    setStatus("Connection failed", "error");
    rebuildGlassesDisplay("Connection failed.\nReturning...", true);
    setTimeout(() => goToFolderSelect(), 3000);
    return;
  }

  if (S.session.folderMessages.length === 0) {
    setStatus("No messages", "error");
    rebuildGlassesDisplay("No messages in folder", true);
    showBrowserMessageList(() => {});
    return;
  }

  setStatus(`${folder.name} (${S.session.folderMessages.length})`);

  if (S.isG2) {
    await new Promise((r) => setTimeout(r, 150));
    showGlassesMessageList();
  }
  showBrowserMessageList((msg) => goToMessageView(msg));
}

export async function goToMessageView(folderMessage) {
  S.session.selectedMessage = folderMessage;
  S.appState = "messageView";
  S.displayRebuilt = false;
  requestWakeLock();

  hideBrowserMessageList();
  hideBrowserPreview();

  setStatus("Loading message...");
  rebuildGlassesDisplay("Loading message...", true);

  try {
    const fullMsg = await fetchFolderMessage(S.session.selectedFolder.id, folderMessage.id);
    S.session.selectedMessage = fullMsg;
  } catch (e) {
    log("Error loading message: " + e.message);
  }

  setStatus(`From: ${S.session.selectedMessage.from}`);

  if (S.isG2) {
    showGlassesMessageView();
  }
  showBrowserMessageView();
}

// --- Shared actions (work for both session types) ---

export function sendPendingMessage() {
  if (!S.pendingText) return;

  // Folder messenger: reply to message
  if (S.session?.type === "folder" && S.session.selectedMessage) {
    S.appState = "processing";
    setStatus("Sending reply...");
    if (S.isG2) {
      S.displayRebuilt = false;
      rebuildGlassesDisplay("Sending reply...", true);
    }
    if (S.ws && S.ws.readyState === WebSocket.OPEN) {
      S.ws.send(JSON.stringify({
        type: "reply",
        text: S.pendingText,
        messageId: S.session.selectedMessage.id,
      }));
    }
    return;
  }

  // Chat messenger: send to contact
  if (!S.session?.selectedContact) return;

  S.appState = "processing";
  setStatus("Sending...");
  if (S.isG2) {
    S.displayRebuilt = false;
    rebuildGlassesDisplay("Sending...", true);
  }

  const recipient = S.session.selectedContact.username || S.session.selectedContact.id;
  if (S.ws && S.ws.readyState === WebSocket.OPEN) {
    S.ws.send(JSON.stringify({
      type: "send",
      text: S.pendingText,
      recipient,
      recipientId: S.session.selectedContact.id,
      recipientName: S.session.selectedContact.name,
      recipientUsername: S.session.selectedContact.username,
    }));
  }
}

export async function cancelPreview() {
  log("Preview cancelled");
  S.pendingText = "";
  hideBrowserPreview();
  if (S.session?.type === "folder" && S.session.selectedMessage) {
    goToMessageView(S.session.selectedMessage);
  } else {
    await refreshConversation();
  }
}

// --- Handle messages from server via WebSocket ---
export function handleServerMessage(msg) {
  if (msg.type === "messenger-selected") {
    const displayName = msg.name;
    log(`Messenger selected: ${displayName}`);
    updateAppTitle(`Even Bridge → ${displayName}`);
    if (msg.hasFolders) {
      goToFolderSelect();
    } else {
      goToContacts();
    }
  } else if (msg.type === "status") {
    setStatus(msg.text);
    if (S.isG2 && S.displayRebuilt) {
      rebuildGlassesDisplay(msg.text, true);
    }
    log("Status: " + msg.text);
  } else if (msg.type === "preview") {
    S.pendingText = msg.text;
    S.appState = "preview";
    setStatus("Preview — tap to send, swipe to cancel");
    log(`Preview: ${msg.text}`);

    if (S.isG2) {
      showGlassesPreview(msg.text);
    }

    updateRecordButton("hidden");
    showBrowserPreview(msg.text);
  } else if (msg.type === "sent") {
    if (S.session?.type === "folder" && S.session.selectedMessage) {
      const senderName = S.session.selectedMessage.from || "Unknown";
      saveMessage(msg.text, senderName);
      renderHistory();
      log(`Reply sent to ${senderName}: ${msg.text}`);
      S.pendingText = "";
      goToMessageView(S.session.selectedMessage);
    } else {
      const contactName = S.session?.selectedContact?.name || "Unknown";
      saveMessage(msg.text, contactName);
      renderHistory();
      log(`Sent to ${contactName}: ${msg.text}`);
      S.pendingText = "";
      refreshConversation();
    }
  } else if (msg.type === "error") {
    setStatus(msg.text, "error");
    log("Error: " + msg.text);

    if (S.isG2) {
      S.displayRebuilt = false;
      rebuildGlassesDisplay("Error:\n" + msg.text, true);
    }

    setTimeout(() => {
      if (S.session?.type === "folder") {
        if (S.session.selectedMessage) {
          goToMessageView(S.session.selectedMessage);
        } else if (S.session.selectedFolder) {
          goToMessageList(S.session.selectedFolder);
        } else if (S.selectedMessengerName) {
          goToFolderSelect();
        } else {
          goToMessengerSelect();
        }
      } else if (S.session?.selectedContact) {
        refreshConversation();
      } else if (S.selectedMessengerName) {
        goToContacts();
      } else {
        goToMessengerSelect();
      }
    }, 3000);
  }
}
