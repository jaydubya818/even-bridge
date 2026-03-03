import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import { convert as htmlToText } from "html-to-text";
import type { Messenger, Contact, Message, Folder, FolderMessage } from "./types.js";
import { getCredential } from "../services/settings.js";

export function isGmailConfigured(): boolean {
  return !!(getCredential("gmail.address") && getCredential("gmail.appPassword"));
}

export function createGmailMessenger(): Messenger {
  const email = getCredential("gmail.address")!;
  const appPassword = getCredential("gmail.appPassword")!;

  let imapClient: ImapFlow | null = null;

  // Cache reply metadata when messages are fetched
  const replyMeta = new Map<string, {
    from: string;
    subject: string;
    messageId: string;
    references: string;
  }>();

  // Map message-id → UID for direct fetch
  const uidCache = new Map<string, { folderId: string; uid: number }>();

  const smtpTransport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: email, pass: appPassword },
  });

  async function getImap(): Promise<ImapFlow> {
    if (imapClient && imapClient.usable) return imapClient;

    imapClient = new ImapFlow({
      host: "imap.gmail.com",
      port: 993,
      secure: true,
      auth: { user: email, pass: appPassword },
      logger: false,
    });

    await imapClient.connect();
    return imapClient;
  }

  function stripHtml(html: string): string {
    return htmlToText(html, {
      wordwrap: 60,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
      ],
    });
  }

  function truncate(text: string, maxLen: number): string {
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen) + "...";
  }

  // Standard Gmail special-use folders to show (keyed by IMAP special-use attribute)
  const specialUseMap: Record<string, string> = {
    "\\Flagged": "Starred",
    "\\Sent": "Sent",
    "\\Drafts": "Drafts",
    "\\Important": "Important",
    "\\Junk": "Spam",
    "\\Trash": "Trash",
    "\\All": "Archive",
  };

  return {
    name: "Gmail",
    hasFolders: true,

    async init() {
      await getImap();
      await smtpTransport.verify();
      console.log(`Gmail authenticated as ${email}`);
    },

    async getContacts(): Promise<Contact[]> {
      return [];
    },

    async getMessages(_entityId: string, _limit?: number): Promise<Message[]> {
      return [];
    },

    async sendMessage(_text: string, _recipient: string): Promise<void> {
      throw new Error("Gmail uses replyToMessage() instead of sendMessage()");
    },

    async getFolders(): Promise<Folder[]> {
      const client = await getImap();
      const mailboxes = await client.list();

      const folders: Folder[] = [];

      for (const mb of mailboxes) {
        // Match Inbox by path, others by special-use attribute
        let displayName: string | undefined;
        if (mb.path === "INBOX") {
          displayName = "Inbox";
        } else if (mb.specialUse) {
          displayName = specialUseMap[mb.specialUse];
        }
        if (!displayName) continue;

        let unreadCount = 0;
        try {
          const status = await client.status(mb.path, { unseen: true });
          unreadCount = status.unseen || 0;
        } catch {
          // Some folders may not support status
        }

        folders.push({
          id: mb.path,
          name: displayName,
          unreadCount,
        });
      }

      // Inbox first, then alphabetical
      folders.sort((a, b) => {
        if (a.id === "INBOX") return -1;
        if (b.id === "INBOX") return 1;
        return a.name.localeCompare(b.name);
      });

      return folders;
    },

    async getFolderMessages(folderId: string, limit = 10): Promise<FolderMessage[]> {
      const client = await getImap();
      const lock = await client.getMailboxLock(folderId);

      try {
        const mailbox = client.mailbox;
        const total = (mailbox && mailbox.exists) || 0;
        if (total === 0) return [];

        const messages: FolderMessage[] = [];
        const startSeq = Math.max(1, total - limit + 1);

        for await (const msg of client.fetch(`${startSeq}:*`, {
          envelope: true,
          flags: true,
          bodyParts: ["1"],
          uid: true,
        }, { uid: false })) {
          const envelope = msg.envelope;
          const subject = envelope?.subject || "(no subject)";
          const fromAddr = envelope?.from?.[0]?.address || "";
          const fromName = envelope?.from?.[0]?.name || fromAddr || "Unknown";
          const date = envelope?.date
            ? Math.floor(new Date(envelope.date).getTime() / 1000)
            : 0;
          const isRead = msg.flags?.has("\\Seen") || false;
          const messageId = envelope?.messageId || String(msg.seq);

          if (msg.uid) {
            uidCache.set(messageId, { folderId, uid: msg.uid });
          }

          let bodyRaw = "";
          const bodyPart = msg.bodyParts?.get("1");
          if (bodyPart) {
            bodyRaw = bodyPart.toString();
          }

          const body = bodyRaw.includes("<") ? stripHtml(bodyRaw) : bodyRaw;
          const snippet = truncate(body.replace(/\s+/g, " ").trim(), 80);

          // Cache for reply
          replyMeta.set(messageId, {
            from: fromAddr,
            subject,
            messageId,
            references: envelope?.inReplyTo || "",
          });

          messages.push({
            id: messageId,
            subject,
            snippet,
            body: truncate(body, 2000),
            from: fromName,
            fromAddress: fromAddr,
            date,
            isRead,
          });
        }

        return messages.reverse();
      } finally {
        lock.release();
      }
    },

    async getFolderMessage(folderId: string, messageId: string): Promise<FolderMessage> {
      const client = await getImap();
      const lock = await client.getMailboxLock(folderId);

      try {
        // Use cached UID from list fetch; fall back to header search
        let uid: number | undefined;
        const cached = uidCache.get(messageId);
        if (cached && cached.folderId === folderId) {
          uid = cached.uid;
        } else {
          const searchResult = await client.search({ header: { "message-id": messageId } });
          const uidList = searchResult as number[];
          if (uidList && uidList.length > 0) {
            uid = uidList[0];
          }
        }

        if (!uid) {
          throw new Error("Message not found");
        }

        const fetchResult = await client.fetchOne(uid, {
          envelope: true,
          source: true,
          flags: true,
        }, { uid: true });

        if (!fetchResult) {
          throw new Error("Failed to fetch message");
        }

        const msg = fetchResult;

        // Mark as read
        await client.messageFlagsAdd(uid, ["\\Seen"], { uid: true });

        const envelope = msg.envelope;
        const subject = envelope?.subject || "(no subject)";
        const fromAddr = envelope?.from?.[0]?.address || "";
        const fromName = envelope?.from?.[0]?.name || fromAddr || "Unknown";
        const date = envelope?.date
          ? Math.floor(new Date(envelope.date).getTime() / 1000)
          : 0;

        // Parse body from full source
        let body = msg.source?.toString() || "";
        const bodyStart = body.indexOf("\r\n\r\n");
        if (bodyStart > -1) {
          body = body.slice(bodyStart + 4);
        }
        if (body.includes("<")) {
          body = stripHtml(body);
        }

        // Cache for reply
        replyMeta.set(messageId, {
          from: fromAddr,
          subject,
          messageId,
          references: envelope?.inReplyTo || "",
        });

        return {
          id: messageId,
          subject,
          snippet: truncate(body.replace(/\s+/g, " ").trim(), 80),
          body: truncate(body.trim(), 2000),
          from: fromName,
          fromAddress: fromAddr,
          date,
          isRead: true,
        };
      } finally {
        lock.release();
      }
    },

    async replyToMessage(messageId: string, text: string): Promise<void> {
      const meta = replyMeta.get(messageId);
      if (!meta) {
        throw new Error("Message metadata not found. View the message first.");
      }

      const subject = meta.subject.startsWith("Re:")
        ? meta.subject
        : `Re: ${meta.subject}`;

      await smtpTransport.sendMail({
        from: email,
        to: meta.from,
        subject,
        text,
        inReplyTo: meta.messageId,
        references: meta.references
          ? `${meta.references} ${meta.messageId}`
          : meta.messageId,
      });

      console.log(`Gmail reply sent to ${meta.from}`);
    },
  };
}
