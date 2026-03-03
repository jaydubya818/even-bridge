import { S } from "../state.js";
import { log, sanitizeG2Name, formatTime } from "../utils.js";

// --- G2 text centering (calibrated character widths) ---
const _cw = {};
for (const c of "jliI!|.:;',`/") _cw[c] = 1;
for (const c of "()[]{}↓↑↕") _cw[c] = 1.3;
for (const c of "abcdefghknopqrstuvxyz") _cw[c] = 1.75;
for (const c of "0123456789$") _cw[c] = 1.8;
for (const c of "ABCDEFGHJKLNOPQRSTUVXYZmMwW★※") _cw[c] = 2.5;
_cw["─"] = 4;
const SPACE_PX = 5.3;

function visualWidth(text) {
  let w = 0;
  for (let i = 0; i < text.length; i++) w += _cw[text[i]] ?? 1;
  return w;
}

function centerText(text, containerPx) {
  const widthInSpaces = containerPx / SPACE_PX;
  const pad = Math.max(0, Math.round((widthInSpaces - visualWidth(text)) / 2));
  return " ".repeat(pad) + text;
}

function getMessengerSelectText() {
  return S.availableMessengers.map((m, i) => {
    const name = m.charAt(0).toUpperCase() + m.slice(1);
    const prefix = i === S.messengerSelectIndex ? ">" : " ";
    return `${prefix} ${name}`;
  }).join("\n\n");
}

export async function showStartupScreen() {
  if (!S.bridge || !S.logoData) return;
  try {
    const imgX = Math.floor((576 - S.logoData.width) / 2);
    const textLabel = "Loading...";
    const textHeight = 30;
    const totalHeight = S.logoData.height + 10 + textHeight;
    const imgY = Math.floor((288 - totalHeight) / 2);
    const textY = imgY + S.logoData.height + 10;
    const rowWidth = textLabel.length * 9;
    const rowX = Math.floor((576 - rowWidth) / 2);

    S.bridge.createStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        {
          containerID: 1,
          containerName: "evt",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          isEventCapture: 1,
          borderWidth: 0,
          borderColor: 0,
          borderRdaius: 0,
          paddingLength: 0,
          content: " ",
        },
        {
          containerID: 3,
          containerName: "label",
          xPosition: rowX,
          yPosition: textY,
          width: 350,
          height: 40,
          isEventCapture: 0,
          borderWidth: 0,
          borderColor: 0,
          borderRdaius: 0,
          paddingLength: 0,
          content: textLabel,
        },
      ],
      imageObject: [
        {
          containerID: 2,
          containerName: "logo",
          xPosition: imgX,
          yPosition: imgY,
          width: S.logoData.width,
          height: S.logoData.height,
        },
      ],
    });

    await S.bridge.updateImageRawData({
      containerID: 2,
      containerName: "logo",
      imageData: S.logoData.data,
    });

    S.startupShown = true;
    log("Startup loading screen displayed");
  } catch (e) {
    log("Startup screen error: " + e.message);
    S.bridge.createStartUpPageContainer({
      containerTotalNum: 1,
      textObject: [
        {
          containerID: 1,
          containerName: "main",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          isEventCapture: 1,
          borderWidth: 0,
          borderColor: 0,
          borderRdaius: 0,
          paddingLength: 16,
          content: "Loading...",
        },
      ],
    });
    S.startupShown = true;
  }
}

export async function showGlassesMessengerSelect() {
  if (!S.bridge || S.availableMessengers.length === 0) return;
  try {
    const charWidth = 9;
    const rowHeight = 40;
    const logoW = S.logoData?.width || 200;
    const logoH = S.logoData?.height || 72;
    const logoGap = 25;

    const longestName = S.availableMessengers.reduce((max, m) =>
      Math.max(max, m.length), 0);
    const textWidth = (2 + longestName) * charWidth;

    const listHeight = S.availableMessengers.length * rowHeight;
    const totalHeight = logoH + logoGap + listHeight;
    const logoY = Math.floor((288 - totalHeight) / 2);
    const selectY = logoY + logoH + logoGap;

    const logoX = Math.floor((576 - logoW) / 2);
    const textX = Math.floor((576 - textWidth) / 2);
    const textContainerHeight = 288 - selectY;

    const imageObjects = [];

    if (S.logoData) {
      imageObjects.push({
        containerID: 3,
        containerName: "logo",
        xPosition: logoX,
        yPosition: logoY,
        width: S.logoData.width,
        height: S.logoData.height,
      });
    }

    // Invisible event capture container prevents scroll effect on text
    S.bridge.rebuildPageContainer({
      containerTotalNum: 2 + imageObjects.length,
      textObject: [
        {
          containerID: 1,
          containerName: "evt",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          isEventCapture: 1,
          borderWidth: 0,
          borderColor: 0,
          borderRdaius: 0,
          paddingLength: 0,
          content: " ",
        },
        {
          containerID: 2,
          containerName: "select",
          xPosition: textX,
          yPosition: selectY,
          width: textWidth + 10,
          height: textContainerHeight,
          isEventCapture: 0,
          borderWidth: 0,
          borderColor: 0,
          borderRdaius: 0,
          paddingLength: 0,
          content: getMessengerSelectText(),
        },
      ],
      imageObject: imageObjects,
    });

    if (S.logoData) {
      await S.bridge.updateImageRawData({
        containerID: 3,
        containerName: "logo",
        imageData: S.logoData.data,
      });
    }

    S.messengerSelectBuilt = true;
    log("Messenger selection displayed on glasses");
  } catch (e) {
    log("Messenger select display error: " + e.message);
  }
}

export function updateGlassesMessengerSelection() {
  if (!S.bridge || !S.messengerSelectBuilt) return;
  try {
    S.bridge.textContainerUpgrade({
      containerID: 2,
      containerName: "select",
      content: getMessengerSelectText(),
    });
  } catch (e) {
    log("Messenger select update error: " + e.message);
  }
}

export function showGlassesContactList() {
  if (!S.bridge || !S.session?.contacts?.length) {
    log(`showGlassesContactList skipped: bridge=${!!S.bridge}, contacts=${S.session?.contacts?.length ?? 0}`);
    return;
  }
  try {
    const names = S.session.contacts.slice(0, 15).map((c) => sanitizeG2Name(c.name));
    log(`G2 contact list: ${names.length} names, first="${names[0]}"`);
    const listPayload = {
      containerTotalNum: 1,
      listObject: [
        {
          containerID: 1,
          containerName: "contacts",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          isEventCapture: 1,
          borderWidth: 1,
          borderColor: 13,
          borderRdaius: 6,
          paddingLength: 5,
          itemContainer: {
            itemCount: names.length,
            itemWidth: 560,
            isItemSelectBorderEn: 1,
            itemName: names,
          },
        },
      ],
    };
    log(`Sending rebuildPageContainer with list (${JSON.stringify(names).slice(0, 100)})`);
    const result = S.bridge.rebuildPageContainer(listPayload);
    log(`rebuildPageContainer result: ${JSON.stringify(result)}`);
    log("Contact list displayed on glasses");
  } catch (e) {
    log("Contact list display error: " + (e?.message || e));
    log("Error stack: " + (e?.stack || "none"));
  }
}

export function showGlassesFolderList() {
  if (!S.bridge || !S.session?.folders?.length) return;
  try {
    const names = S.session.folders.slice(0, 15).map((f) => {
      const unread = f.unreadCount > 0 ? ` (${f.unreadCount})` : "";
      return sanitizeG2Name(f.name + unread);
    });

    S.bridge.rebuildPageContainer({
      containerTotalNum: 1,
      listObject: [
        {
          containerID: 1,
          containerName: "folders",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          isEventCapture: 1,
          borderWidth: 1,
          borderColor: 13,
          borderRdaius: 6,
          paddingLength: 0,
          itemContainer: {
            itemCount: names.length,
            itemWidth: 560,
            isItemSelectBorderEn: 1,
            itemName: names,
          },
        },
      ],
    });
    log("Folder list displayed on glasses");
  } catch (e) {
    log("Folder list display error: " + (e?.message || e));
  }
}

export function showGlassesMessageList() {
  if (!S.bridge || !S.session?.folderMessages?.length) return;
  try {
    const names = S.session.folderMessages.slice(0, 10).map((m) => {
      const unreadMark = m.isRead ? "" : "* ";
      const label = `${unreadMark}${m.from}: ${m.subject}`;
      return sanitizeG2Name(label);
    });

    S.bridge.rebuildPageContainer({
      containerTotalNum: 1,
      listObject: [
        {
          containerID: 1,
          containerName: "emails",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          isEventCapture: 1,
          borderWidth: 1,
          borderColor: 13,
          borderRdaius: 6,
          paddingLength: 5,
          itemContainer: {
            itemCount: names.length,
            itemWidth: 560,
            isItemSelectBorderEn: 1,
            itemName: names,
          },
        },
      ],
    });
    log("Message list displayed on glasses");
  } catch (e) {
    log("Message list display error: " + (e?.message || e));
  }
}

export function showGlassesMessageView(forceRebuild = true) {
  if (!S.bridge || !S.session?.selectedMessage) return;
  try {
    const m = S.session.selectedMessage;
    const divider = String.fromCharCode(9472).repeat(28);
    const titleBlock = `From: ${(m.from || "").slice(0, 30)}\nSubject: ${(m.subject || "").slice(0, 40)}\n${divider}\n`;
    const body = (m.body || m.snippet || "").slice(0, 2300);

    S.messageViewPages = paginateText(body, 380 - titleBlock.length, 6);
    if (forceRebuild) S.messageViewPage = 0;

    const page = Math.min(S.messageViewPage, S.messageViewPages.length - 1);
    const total = S.messageViewPages.length;
    const pageLabel = total > 1 ? `[${page + 1}/${total}] ` : "";
    const content = pageLabel + titleBlock + S.messageViewPages[page];

    S.displayRebuilt = false;

    // Invisible evt container captures events; text container displays content
    S.bridge.rebuildPageContainer({
      containerTotalNum: 2,
      textObject: [
        {
          containerID: 1,
          containerName: "evt",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          isEventCapture: 1,
          borderWidth: 0,
          borderColor: 0,
          borderRdaius: 0,
          paddingLength: 0,
          content: " ",
        },
        {
          containerID: 2,
          containerName: "msgv",
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 288,
          isEventCapture: 0,
          borderWidth: 0,
          borderColor: 0,
          borderRdaius: 0,
          paddingLength: 4,
          content: content,
        },
      ],
    });
    S.displayRebuilt = true;
    log(`Message view page ${page + 1}/${total}`);
  } catch (e) {
    log("Message view display error: " + (e?.message || e));
  }
}

export function updateGlassesMessageViewPage() {
  if (!S.bridge || !S.messageViewPages?.length || !S.session?.selectedMessage) return;
  try {
    const m = S.session.selectedMessage;
    const divider = String.fromCharCode(9472).repeat(28);
    const titleBlock = `From: ${(m.from || "").slice(0, 30)}\nSubject: ${(m.subject || "").slice(0, 40)}\n${divider}\n`;

    const page = Math.min(S.messageViewPage, S.messageViewPages.length - 1);
    const total = S.messageViewPages.length;
    const pageLabel = total > 1 ? `[${page + 1}/${total}] ` : "";
    S.bridge.textContainerUpgrade({
      containerID: 2,
      containerName: "msgv",
      content: pageLabel + titleBlock + S.messageViewPages[page],
    });
    log(`Msg page ${page + 1}/${total}`);
  } catch (e) {
    log("Msg page update error: " + e.message);
  }
}

export function rebuildGlassesDisplay(text, centered = false) {
  if (!S.bridge) return;
  try {
    // Center each line with calibrated space-padding for G2 font
    const content = centered
      ? text.split("\n").map((l) => centerText(l, 596)).join("\n")
      : text;

    if (!S.displayRebuilt) {
      const lineHeight = 30;
      let y, cH;
      if (centered) {
        const lineCount = text.split("\n").length;
        cH = lineCount * lineHeight + 10;
        y = Math.floor((288 - cH) / 2);
      } else {
        y = 0; cH = 288;
      }
      S.bridge.rebuildPageContainer({
        containerTotalNum: 1,
        textObject: [
          {
            containerID: 1,
            containerName: "main",
            xPosition: 0,
            yPosition: y,
            width: 576,
            height: cH,
            isEventCapture: 1,
            borderWidth: 0,
            borderColor: 0,
            borderRdaius: 0,
            paddingLength: centered ? 0 : 4,
            content: content,
          },
        ],
      });
      S.displayRebuilt = true;
    } else {
      S.bridge.textContainerUpgrade({
        containerID: 1,
        containerName: "main",
        content: content,
      });
    }
    log("Display updated: " + text.slice(0, 40));
  } catch (e) {
    log("Display error: " + e.message);
  }
}

function paginateText(text, maxChars = 380, maxLines = 9) {
  // Collapse 3+ consecutive blank lines into 1
  const cleaned = text.replace(/\n{3,}/g, "\n\n");
  const lines = cleaned.split("\n");
  const pages = [];
  let current = "";
  let lineCount = 0;

  for (const line of lines) {
    if (line.length > maxChars) {
      if (current) { pages.push(current); current = ""; lineCount = 0; }
      for (let i = 0; i < line.length; i += maxChars) {
        pages.push(line.slice(i, i + maxChars));
      }
      continue;
    }
    const newLen = current ? current.length + 1 + line.length : line.length;
    const newLines = lineCount + 1;
    if ((newLen > maxChars || newLines > maxLines) && current) {
      pages.push(current);
      current = line;
      lineCount = 1;
    } else {
      current += (current ? "\n" : "") + line;
      lineCount++;
    }
  }
  if (current) pages.push(current);
  return pages.length > 0 ? pages : [""];
}

export function showGlassesConversation(forceRebuild = false) {
  if (!S.bridge) return;
  try {
    const divider = String.fromCharCode(9472).repeat(28);
    const title = `To: ${S.session.selectedContact.name}`;
    const titleBlock = title + "\n" + divider + "\n";

    const msgLines = [];
    const msgs = S.session.conversationMessages.slice(0, 6);
    for (const m of msgs) {
      const sender = m.out ? "Me" : (m.senderName || S.session.selectedContact.name);
      const time = formatTime(m.date);
      const text = (m.text || "").slice(0, 2300);
      msgLines.push(`${sender} (${time}): ${text}`);
    }

    if (msgs.length === 0) {
      msgLines.push("No messages yet");
    }

    // Paginate message body, leaving room for title on each page
    S.conversationPages = paginateText(msgLines.join("\n"), 380 - titleBlock.length, 7);
    if (forceRebuild) S.conversationPage = 0;

    const page = Math.min(S.conversationPage, S.conversationPages.length - 1);
    const total = S.conversationPages.length;
    const pageLabel = total > 1 ? `[${page + 1}/${total}] ` : "";
    const content = pageLabel + titleBlock + S.conversationPages[page];

    if (forceRebuild) S.displayRebuilt = false;

    if (!S.displayRebuilt) {
      // Invisible evt container captures events; text container displays content
      S.bridge.rebuildPageContainer({
        containerTotalNum: 2,
        textObject: [
          {
            containerID: 1,
            containerName: "evt",
            xPosition: 0,
            yPosition: 0,
            width: 576,
            height: 288,
            isEventCapture: 1,
            borderWidth: 0,
            borderColor: 0,
            borderRdaius: 0,
            paddingLength: 0,
            content: " ",
          },
          {
            containerID: 2,
            containerName: "conv",
            xPosition: 0,
            yPosition: 0,
            width: 576,
            height: 288,
            isEventCapture: 0,
            borderWidth: 0,
            borderColor: 0,
            borderRdaius: 0,
            paddingLength: 4,
            content: content,
          },
        ],
      });
      S.displayRebuilt = true;
    } else {
      S.bridge.textContainerUpgrade({
        containerID: 2,
        containerName: "conv",
        content: content,
      });
    }
    log(`Conversation page ${page + 1}/${total}`);
  } catch (e) {
    log("Conversation display error: " + e.message);
  }
}

export function updateGlassesConversationPage() {
  if (!S.bridge || !S.conversationPages?.length || !S.session?.selectedContact) return;
  try {
    const divider = String.fromCharCode(9472).repeat(28);
    const title = `To: ${S.session.selectedContact.name}`;
    const titleBlock = title + "\n" + divider + "\n";

    const page = Math.min(S.conversationPage, S.conversationPages.length - 1);
    const total = S.conversationPages.length;
    const pageLabel = total > 1 ? `[${page + 1}/${total}] ` : "";
    S.bridge.textContainerUpgrade({
      containerID: 2,
      containerName: "conv",
      content: pageLabel + titleBlock + S.conversationPages[page],
    });
    log(`Conv page ${page + 1}/${total}`);
  } catch (e) {
    log("Page update error: " + e.message);
  }
}

export function showGlassesPreview(text) {
  if (!S.bridge) return;
  try {
    const preview = text.length > 200 ? text.slice(0, 200) + "..." : text;
    const lines = [
      "Preview:",
      "",
      `"${preview}"`,
      "",
      "Tap to send | Swipe to cancel",
    ];
    S.displayRebuilt = false;
    rebuildGlassesDisplay(lines.join("\n"));
    log("Preview displayed on glasses");
  } catch (e) {
    log("Preview display error: " + e.message);
  }
}
