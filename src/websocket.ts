import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import { transcribeAudio, transcribeWithInterim } from "./services/audio.js";
import { saveLastRecipient } from "./services/lastRecipient.js";
import { createMessenger } from "./messengers/index.js";
import type { Messenger } from "./messengers/types.js";

interface WebSocketContext {
  getActiveMessenger: () => Messenger | null;
  setActiveMessenger: (m: Messenger) => void;
}

export function attachWebSocket(server: Server, ctx: WebSocketContext): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws: WebSocket) => {
    console.log("Client connected");
    const audioChunks: Buffer[] = [];

    ws.on("message", async (data: Buffer, isBinary: boolean) => {
      if (!isBinary) {
        const raw = data.toString();
        let parsed: any = null;
        try {
          parsed = JSON.parse(raw);
        } catch {}

        if (parsed && parsed.type === "select-messenger") {
          const name = parsed.name;
          const displayName = name.charAt(0).toUpperCase() + name.slice(1);
          try {
            const messenger = createMessenger(name);
            ws.send(JSON.stringify({ type: "status", text: `Connecting to ${displayName}...` }));
            await messenger.init();
            ctx.setActiveMessenger(messenger);
            ws.send(JSON.stringify({ type: "messenger-selected", name: messenger.name, hasFolders: !!messenger.hasFolders }));
            console.log(`Messenger selected: ${messenger.name}`);
          } catch (err) {
            console.error(`Error initializing ${name}:`, err);
            ws.send(JSON.stringify({ type: "error", text: `Failed to connect to ${displayName}` }));
          }
        } else if (raw === "stop" || (parsed && parsed.type === "stop")) {
          console.log(
            `Recording stopped. Received ${audioChunks.length} audio chunks.`
          );

          if (audioChunks.length === 0) {
            ws.send(JSON.stringify({ type: "error", text: "No audio recorded" }));
            return;
          }

          const pcmBuffer = Buffer.concat(audioChunks);
          audioChunks.length = 0;

          const durationSec = pcmBuffer.length / (16000 * 2);
          console.log(
            `Processing ${pcmBuffer.length} bytes (${durationSec.toFixed(1)}s) of audio...`
          );

          ws.send(JSON.stringify({ type: "status", text: "Transcribing..." }));

          try {
            if (process.env.DEV_MEETING_ASSISTANT_OVERLAY === "true") {
              // Single transcription path: interims (when streaming STT exists) then final; send preview on final.
              const transcription = await transcribeWithInterim(pcmBuffer, (text, isFinal) => {
                ws.send(JSON.stringify({ type: "bridge_transcript", text, isFinal }));
              });
              if (transcription) {
                ws.send(JSON.stringify({ type: "preview", text: transcription }));
                console.log(`Transcription: "${transcription}"`);
              } else {
                ws.send(JSON.stringify({ type: "error", text: "No speech detected" }));
              }
            } else {
              const transcription = await transcribeAudio(pcmBuffer);
              console.log(`Transcription: "${transcription}"`);
              if (transcription.trim()) {
                ws.send(JSON.stringify({ type: "preview", text: transcription }));
              } else {
                ws.send(JSON.stringify({ type: "error", text: "No speech detected" }));
              }
            }
          } catch (err) {
            console.error("Transcription error:", err);
            ws.send(JSON.stringify({ type: "error", text: "Error transcribing audio" }));
          }
        } else if (parsed && parsed.type === "send") {
          const { text, recipient, recipientId, recipientName, recipientUsername } = parsed;
          if (!text || !recipient) {
            ws.send(JSON.stringify({ type: "error", text: "Missing text or recipient" }));
            return;
          }

          const activeMessenger = ctx.getActiveMessenger();
          if (!activeMessenger) {
            ws.send(JSON.stringify({ type: "error", text: "No messenger selected" }));
            return;
          }

          try {
            await activeMessenger.sendMessage(text, recipient);
            if (recipientId) {
              saveLastRecipient(activeMessenger.name.toLowerCase(), {
                id: recipientId,
                name: recipientName || "Unknown",
                username: recipientUsername || null,
              });
            }
            ws.send(JSON.stringify({ type: "sent", text }));
            console.log(`Sent to ${recipient} successfully`);
          } catch (err) {
            console.error("Send error:", err);
            ws.send(JSON.stringify({ type: "error", text: "Error sending message" }));
          }
        } else if (parsed && parsed.type === "reply") {
          const { text, messageId } = parsed;
          if (!text || !messageId) {
            ws.send(JSON.stringify({ type: "error", text: "Missing text or messageId" }));
            return;
          }

          const activeMessenger = ctx.getActiveMessenger();
          if (!activeMessenger) {
            ws.send(JSON.stringify({ type: "error", text: "No messenger selected" }));
            return;
          }

          if (!activeMessenger.replyToMessage) {
            ws.send(JSON.stringify({ type: "error", text: "Messenger does not support replies" }));
            return;
          }

          try {
            await activeMessenger.replyToMessage(messageId, text);
            ws.send(JSON.stringify({ type: "sent", text }));
            console.log(`Replied to ${messageId} successfully`);
          } catch (err) {
            console.error("Reply error:", err);
            ws.send(JSON.stringify({ type: "error", text: "Error sending reply" }));
          }
        }
      } else {
        audioChunks.push(Buffer.from(data));
      }
    });

    ws.on("close", () => {
      console.log("Client disconnected");
      audioChunks.length = 0;
    });
  });
}
