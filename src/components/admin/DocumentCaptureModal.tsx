"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, RotateCcw, RotateCw, Upload, X } from "lucide-react";
import { DOCUMENT_DOC_TYPES, formatFileSize } from "@/lib/documents/constants";
import {
  INTAKE_CAPTURE_ACCEPT,
  INTAKE_CAPTURE_MAX_FILES,
  isAllowedIntakeCaptureFile,
} from "@/lib/documents/intake-capture";
import { formatCaptureStamp, uploadDocumentsClient } from "@/lib/documents/upload-client";
import type { DocumentDto } from "@/app/admin/documents/actions";

type Mode = "choose" | "camera" | "review" | "files";

type Props = {
  open: boolean;
  entityType: string;
  entityId: string;
  defaultDocType?: string;
  disabled?: boolean;
  onClose: () => void;
  onUploaded: (docs: DocumentDto[]) => void;
};

function cameraAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function DocumentCaptureModal({
  open,
  entityType,
  entityId,
  defaultDocType = "",
  disabled = false,
  onClose,
  onUploaded,
}: Props) {
  const [mode, setMode] = useState<Mode>("choose");
  const [docType, setDocType] = useState(defaultDocType);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [cameraOk, setCameraOk] = useState(true);
  const [streamReady, setStreamReady] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [cropPct, setCropPct] = useState(0);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [reviewBlob, setReviewBlob] = useState<Blob | null>(null);
  const [picked, setPicked] = useState<File[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreamReady(false);
  }, []);

  const reset = useCallback(() => {
    stopCamera();
    if (reviewUrl) URL.revokeObjectURL(reviewUrl);
    setMode("choose");
    setError(null);
    setBusy(false);
    setProgress(null);
    setRotation(0);
    setCropPct(0);
    setReviewUrl(null);
    setReviewBlob(null);
    setPicked([]);
    submittingRef.current = false;
  }, [reviewUrl, stopCamera]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    setDocType(defaultDocType);
    setCameraOk(cameraAvailable());
    // reset intentionally omitted — נקרא רק בסגירה
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultDocType]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  async function startCamera() {
    setError(null);
    if (!cameraAvailable()) {
      setCameraOk(false);
      setMode("files");
      return;
    }
    setMode("camera");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setStreamReady(true);
    } catch {
      stopCamera();
      setCameraOk(false);
      setError("המצלמה אינה זמינה. ניתן להעלות קובץ מהמכשיר.");
      setMode("files");
    }
  }

  function captureFrame() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setError("אין תמונה מהמצלמה");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError("צילום נכשל");
          return;
        }
        const url = URL.createObjectURL(blob);
        if (reviewUrl) URL.revokeObjectURL(reviewUrl);
        setReviewBlob(blob);
        setReviewUrl(url);
        setRotation(0);
        setCropPct(0);
        stopCamera();
        setMode("review");
      },
      "image/jpeg",
      0.92,
    );
  }

  async function confirmCapture() {
    if (!reviewBlob || submittingRef.current) return;
    const processed = await renderEditedImage(reviewBlob, rotation, cropPct);
    const file = new File([processed], `capture-${formatCaptureStamp()}.jpg`, { type: "image/jpeg" });
    await uploadFiles([file]);
  }

  function onPickFiles(list: FileList | null) {
    if (!list) return;
    const next: File[] = [];
    for (const file of Array.from(list)) {
      if (!isAllowedIntakeCaptureFile(file.name, file.type)) {
        setError(`סוג קובץ לא נתמך: ${file.name}`);
        continue;
      }
      next.push(file);
    }
    if (next.length === 0) return;
    setPicked((cur) => [...cur, ...next].slice(0, INTAKE_CAPTURE_MAX_FILES));
    setMode("files");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function uploadFiles(files: File[]) {
    if (!entityId || disabled || submittingRef.current || files.length === 0) return;
    submittingRef.current = true;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const res = await uploadDocumentsClient({
        entityType,
        entityId,
        docType: docType || null,
        files,
        onProgress: setProgress,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onUploaded(res.documents);
      onClose();
    } finally {
      setBusy(false);
      setProgress(null);
      submittingRef.current = false;
    }
  }

  if (!open) return null;

  return (
    <div className="adm-doccap" role="dialog" aria-modal="true" aria-labelledby="adm-doccap-title">
      <div className="adm-doccap__backdrop" onClick={() => (!busy ? onClose() : undefined)} />
      <div className="adm-doccap__panel" dir="rtl">
        <header className="adm-doccap__head">
          <h2 id="adm-doccap-title">הוספת מסמך</h2>
          <button type="button" className="adm-docs__iconbtn" onClick={onClose} disabled={busy} aria-label="סגירה">
            <X size={16} />
          </button>
        </header>

        <label className="adm-doccap__type">
          <span>סוג מסמך</span>
          <select value={docType} onChange={(e) => setDocType(e.target.value)} disabled={busy}>
            <option value="">ללא סוג</option>
            {DOCUMENT_DOC_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>

        {error ? <div className="adm-docs__err">{error}</div> : null}
        {progress != null ? (
          <div className="adm-doccap__progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${progress}%` }} />
            <em>מעלה… {progress}%</em>
          </div>
        ) : null}

        {mode === "choose" ? (
          <div className="adm-doccap__choices">
            <button type="button" className="adm-doccap__choice" onClick={() => void startCamera()} disabled={busy || disabled}>
              <Camera size={22} aria-hidden />
              <strong>צלם מסמך</strong>
              <span>{cameraOk ? "מצלמת הטלפון או המחשב" : "המצלמה אינה זמינה במכשיר זה"}</span>
            </button>
            <button type="button" className="adm-doccap__choice" onClick={() => fileRef.current?.click()} disabled={busy || disabled}>
              <Upload size={22} aria-hidden />
              <strong>העלה קובץ</strong>
              <span>PDF, JPG, JPEG, PNG, WEBP</span>
            </button>
          </div>
        ) : null}

        {mode === "camera" ? (
          <div className="adm-doccap__camera">
            <video ref={videoRef} className="adm-doccap__video" playsInline muted autoPlay />
            <div className="adm-doccap__actions">
              <button type="button" className="adm-docs__btn" onClick={() => { stopCamera(); setMode("choose"); }} disabled={busy}>
                חזרה
              </button>
              <button type="button" className="adm-docs__btn adm-docs__btn--primary" onClick={captureFrame} disabled={!streamReady || busy}>
                צלם
              </button>
            </div>
          </div>
        ) : null}

        {mode === "review" && reviewUrl ? (
          <div className="adm-doccap__review">
            <div className="adm-doccap__preview-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={reviewUrl}
                alt="תצוגה מקדימה"
                className="adm-doccap__preview"
                style={{ transform: `rotate(${rotation}deg) scale(${1 + cropPct / 200})` }}
              />
            </div>
            <div className="adm-doccap__edit">
              <button type="button" className="adm-docs__iconbtn" onClick={() => setRotation((r) => r - 90)} title="סיבוב שמאלה">
                <RotateCcw size={16} />
              </button>
              <button type="button" className="adm-docs__iconbtn" onClick={() => setRotation((r) => r + 90)} title="סיבוב ימינה">
                <RotateCw size={16} />
              </button>
              <label className="adm-doccap__crop">
                חיתוך
                <input
                  type="range"
                  min={0}
                  max={28}
                  value={cropPct}
                  onChange={(e) => setCropPct(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="adm-doccap__actions">
              <button type="button" className="adm-docs__btn" onClick={() => void startCamera()} disabled={busy}>
                צילום מחדש
              </button>
              <button type="button" className="adm-docs__btn adm-docs__btn--primary" onClick={() => void confirmCapture()} disabled={busy}>
                אישור צילום
              </button>
            </div>
          </div>
        ) : null}

        {mode === "files" ? (
          <div className="adm-doccap__files">
            {picked.length === 0 ? (
              <p className="adm-docs__empty">לא נבחרו קבצים.</p>
            ) : (
              <ul className="adm-doccap__filelist">
                {picked.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    <strong title={f.name}>{f.name}</strong>
                    <span dir="ltr">{formatFileSize(f.size)}</span>
                    <button type="button" onClick={() => setPicked((cur) => cur.filter((_, idx) => idx !== i))} disabled={busy}>
                      הסר
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="adm-doccap__actions">
              <button type="button" className="adm-docs__btn" onClick={() => fileRef.current?.click()} disabled={busy}>
                הוסף קבצים
              </button>
              <button
                type="button"
                className="adm-docs__btn adm-docs__btn--primary"
                onClick={() => void uploadFiles(picked)}
                disabled={busy || picked.length === 0}
              >
                {busy ? "מעלה…" : `שמור ${picked.length || ""}`.trim()}
              </button>
            </div>
          </div>
        ) : null}

        <input
          ref={fileRef}
          type="file"
          accept={INTAKE_CAPTURE_ACCEPT}
          multiple
          className="adm-docs__file"
          onChange={(e) => onPickFiles(e.target.files)}
        />
      </div>
    </div>
  );
}

async function renderEditedImage(blob: Blob, rotationDeg: number, cropPct: number): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const turns = ((rotationDeg % 360) + 360) % 360;
  const swap = turns === 90 || turns === 270;
  const srcW = bitmap.width;
  const srcH = bitmap.height;
  const insetX = Math.round((srcW * cropPct) / 200);
  const insetY = Math.round((srcH * cropPct) / 200);
  const cropW = Math.max(1, srcW - insetX * 2);
  const cropH = Math.max(1, srcH - insetY * 2);
  const canvas = document.createElement("canvas");
  canvas.width = swap ? cropH : cropW;
  canvas.height = swap ? cropW : cropH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return blob;
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((turns * Math.PI) / 180);
  ctx.drawImage(bitmap, insetX, insetY, cropW, cropH, -cropW / 2, -cropH / 2, cropW, cropH);
  return new Promise((resolve) => {
    canvas.toBlob((out) => resolve(out ?? blob), "image/jpeg", 0.92);
  });
}

export default DocumentCaptureModal;
