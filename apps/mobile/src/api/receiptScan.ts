import { useCallback, useEffect, useRef, useState } from "react";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
// SDK 57: uploadAsync, getInfoAsync and deleteAsync live under the legacy entry point
import * as FileSystem from "expo-file-system/legacy";
import { apiFetch } from "./client";
import type { ReceiptSuggestion, ReceiptUpload } from "./types";
import { ReceiptUploadError } from "../lib/receipt";

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.7;

export type ScanStage = "idle" | "uploading" | "reading";

// Resize so the long side is at most 1600px and always re-encode as JPEG (camera photos can be HEIC).
// Returns the new temporary file in the cache and its size in bytes.
async function prepareReceiptImage(sourceUri: string, width: number, height: number): Promise<{ uri: string; byteSize: number }> {
  const context = ImageManipulator.manipulate(sourceUri);
  const longSide = Math.max(width, height);
  // the picker can report 0 for an unknown size: then resize by width, which caps the common portrait photo too
  if (longSide === 0) context.resize({ width: MAX_SIDE });
  else if (longSide > MAX_SIDE) context.resize(width >= height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  const image = await context.renderAsync();
  const result = await image.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  const info = await FileSystem.getInfoAsync(result.uri);
  if (!info.exists || !info.size) {
    await deleteTemp(result.uri);
    throw new Error("Prepared image is missing");
  }
  return { uri: result.uri, byteSize: info.size };
}

// PUT the raw bytes to the presigned URL. Not through apiFetch and without an Authorization header: the signature is
// in the URL. Never log the URL or the response (it can echo the signature).
async function uploadToS3(uploadUrl: string, fileUri: string): Promise<void> {
  let status: number;
  try {
    const response = await FileSystem.uploadAsync(uploadUrl, fileUri, {
      httpMethod: "PUT",
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: FileSystem.FileSystemSessionType.FOREGROUND,
      headers: { "Content-Type": "image/jpeg" },
    });
    status = response.status;
  } catch {
    throw new ReceiptUploadError();
  }
  if (status !== 200) throw new ReceiptUploadError();
}

async function deleteTemp(uri: string) {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // the cache is cleared by the system eventually
  }
}

// One scan: prepare the photo, ask for an upload URL, upload, then analyze right away. Each call runs the whole
// sequence (the backend deletes the image after every analysis, so a key can't be analyzed twice).
// Resolves to null when the screen was left (or a newer scan started) before the result came back.
export function useReceiptScan(householdId: number | null) {
  const [stage, setStage] = useState<ScanStage>("idle");
  const mounted = useRef(true);
  const running = useRef(false);
  const runId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      runId.current += 1; // anything still in flight is ignored
    };
  }, []);

  const scan = useCallback(
    async (photo: { uri: string; width: number; height: number }): Promise<ReceiptSuggestion | null> => {
      if (householdId === null || running.current) return null; // blocks double taps
      running.current = true;
      const id = ++runId.current;
      const current = () => mounted.current && id === runId.current;
      let tempUri: string | null = null;
      setStage("uploading");
      try {
        const prepared = await prepareReceiptImage(photo.uri, photo.width, photo.height);
        tempUri = prepared.uri;
        if (!current()) return null;
        const upload = await apiFetch<ReceiptUpload>(`/households/${householdId}/receipts`, {
          method: "POST",
          body: { contentType: "image/jpeg", byteSize: prepared.byteSize },
        });
        if (!current()) return null;
        await uploadToS3(upload.uploadUrl, prepared.uri);
        if (!current()) return null;
        setStage("reading");
        const suggestion = await apiFetch<ReceiptSuggestion>(`/households/${householdId}/receipts/analyze`, {
          method: "POST",
          body: { key: upload.key },
        });
        return current() ? suggestion : null;
      } catch (err) {
        if (!current()) return null;
        throw err;
      } finally {
        if (tempUri) await deleteTemp(tempUri);
        running.current = false;
        if (mounted.current) setStage("idle");
      }
    },
    [householdId],
  );

  return { scan, stage, busy: stage !== "idle" };
}
