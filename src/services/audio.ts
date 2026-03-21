import OpenAI from "openai";
import { getCredential } from "./settings.js";

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI {
  const apiKey = getCredential("openai.apiKey");
  if (!apiKey) {
    throw new Error("OpenAI API key not configured. Add it in Settings.");
  }
  if (!openai) {
    openai = new OpenAI({ apiKey });
  }
  return openai;
}

function pcmToWav(pcmData: Buffer): Buffer {
  const sampleRate = 16000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const headerSize = 44;

  const header = Buffer.alloc(headerSize);

  header.write("RIFF", 0);
  header.writeUInt32LE(dataSize + headerSize - 8, 4);
  header.write("WAVE", 8);

  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);

  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);

  return Buffer.concat([header, pcmData]);
}

export async function transcribeAudio(pcmBuffer: Buffer): Promise<string> {
  const wavBuffer = pcmToWav(pcmBuffer);

  const client = getOpenAI();
  const response = await client.audio.transcriptions.create({
    model: "whisper-1",
    file: new File(
      [wavBuffer.buffer.slice(wavBuffer.byteOffset, wavBuffer.byteOffset + wavBuffer.byteLength)] as BlobPart[],
      "audio.wav",
      { type: "audio/wav" }
    ),
  });

  return response.text;
}

/**
 * Transcribe with optional interim results for overlay/streaming.
 * Returns final transcription. Today: one-shot; calls callback(fullText, true) once.
 * When streaming STT is available: call callback(partial, false) for each interim,
 * then callback(fullText, true) for the final.
 */
export async function transcribeWithInterim(
  pcmBuffer: Buffer,
  callback: (text: string, isFinal: boolean) => void
): Promise<string> {
  const full = (await transcribeAudio(pcmBuffer)).trim();
  if (full) callback(full, true);
  return full;
}
