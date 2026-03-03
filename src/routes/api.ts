import { Router } from "express";
import type { Messenger } from "../messengers/types.js";
import { getAvailableMessengerNames } from "../messengers/index.js";
import { loadLastRecipient } from "../services/lastRecipient.js";

export function createApiRouter(getActiveMessenger: () => Messenger | null): Router {
  const router = Router();

  router.get("/available-messengers", (_req, res) => {
    res.json(getAvailableMessengerNames());
  });

  router.get("/contacts", async (_req, res) => {
    try {
      const messenger = getActiveMessenger();
      if (!messenger) {
        res.status(400).json({ error: "No messenger selected" });
        return;
      }
      console.time("api:contacts");
      const contacts = await messenger.getContacts();
      console.timeEnd("api:contacts");
      res.json(contacts);
    } catch (err) {
      console.error("Error fetching contacts:", err);
      res.status(500).json({ error: "Failed to fetch contacts" });
    }
  });

  router.get("/last-recipient", (_req, res) => {
    const messenger = getActiveMessenger();
    const name = messenger?.name?.toLowerCase() || "unknown";
    const last = loadLastRecipient(name);
    res.json(last);
  });

  router.get("/folders", async (_req, res) => {
    try {
      const messenger = getActiveMessenger();
      if (!messenger) {
        res.status(400).json({ error: "No messenger selected" });
        return;
      }
      if (!messenger.hasFolders || !messenger.getFolders) {
        res.status(400).json({ error: "Messenger does not support folders" });
        return;
      }
      console.time("api:folders");
      const folders = await messenger.getFolders();
      console.timeEnd("api:folders");
      res.json(folders);
    } catch (err) {
      console.error("Error fetching folders:", err);
      res.status(500).json({ error: "Failed to fetch folders" });
    }
  });

  router.get("/folders/:folderId/messages", async (req, res) => {
    try {
      const messenger = getActiveMessenger();
      if (!messenger) {
        res.status(400).json({ error: "No messenger selected" });
        return;
      }
      if (!messenger.getFolderMessages) {
        res.status(400).json({ error: "Messenger does not support folder messages" });
        return;
      }
      const limit = parseInt(req.query.limit as string) || 10;
      console.time("api:folder-messages");
      const messages = await messenger.getFolderMessages(decodeURIComponent(req.params.folderId), limit);
      console.timeEnd("api:folder-messages");
      res.json(messages);
    } catch (err) {
      console.error("Error fetching folder messages:", err);
      res.status(500).json({ error: "Failed to fetch folder messages" });
    }
  });

  router.get("/folders/:folderId/messages/:messageId", async (req, res) => {
    try {
      const messenger = getActiveMessenger();
      if (!messenger) {
        res.status(400).json({ error: "No messenger selected" });
        return;
      }
      if (!messenger.getFolderMessage) {
        res.status(400).json({ error: "Messenger does not support folder messages" });
        return;
      }
      const message = await messenger.getFolderMessage(
        decodeURIComponent(req.params.folderId),
        decodeURIComponent(req.params.messageId),
      );
      res.json(message);
    } catch (err) {
      console.error("Error fetching folder message:", err);
      res.status(500).json({ error: "Failed to fetch message" });
    }
  });

  router.get("/messages/:entityId", async (req, res) => {
    try {
      const messenger = getActiveMessenger();
      if (!messenger) {
        res.status(400).json({ error: "No messenger selected" });
        return;
      }
      const messages = await messenger.getMessages(req.params.entityId, 6);
      res.json(messages);
    } catch (err) {
      console.error("Error fetching messages:", err);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  return router;
}
