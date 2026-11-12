"use client";

import { useEffect, useRef, useState } from "react";
import { buildJpegPdf } from "@/lib/documents/images-to-pdf";
import { cameraFileName } from "@/lib/documents/source";

type PageShot = { jpeg: Uint8Array; width: number; height: number };

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (file: File) => Promise<void> | void;
};

function cameraErrorMessage(error: unknown): string {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return "הדפדפן לא תומך בפתיחת מצלמה.";
  }
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") {
    return "הגישה למצלמה נחסמה. יש לאשר את ההרשאה בהגדרות הדפדפן.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "לא נמצאה מצלמה מחוברת. חברו מצלמת USB או בדקו את המצלמה המובנית.";
  }
  if (name === "NotReadableError") return "המצלמה בשימוש ביישום אחר.";
  return "לא ניתן לפתוח את המצלמה.";
}

function stopStream(stream: MediaStream | null, video: HTMLVideoElement | null) {
  stream?.getTracks().forEach((track) => track.stop());
  if (video) video.srcObject = null;
}

export function DocumentCameraModal({ open, onClose, onSave }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [format, setFormat] = useState<"jpg" | "png">("jpg");
  const [busy, setBusy] = useState(false);
  const [pages, setPages] = useState<PageShot[]>([]);
  const [cropping, setCropping] = useState(false);
  const [crop, setCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const video = videoRef.current;
    async function start() {
      setError(null);
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(cameraErrorMessage(null));
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
        });
        if (cancelled) {
          stopStream(stream, null);
          return;
        }
        stopStream(streamRef.current, video);
        streamRef.current = stream;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        const listed = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          const cameras = listed.filter((item) => item.kind === "videoinput");
          setDevices(cameras);
          const active = stream.getVideoTracks()[0]?.getSettings().deviceId;
          if (active && !deviceId) setDeviceId(active);
        }
      } catch (err) {
        if (!cancelled) setError(cameraErrorMessage(err));
      }
    }
    void start();
    return () => {
      cancelled = true;
      stopStream(streamRef.current, videoRef.current);
      streamRef.current = null;
    };
  }, [open, deviceId]);

  useEffect(() => {
    if (open) return;
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setPages([]);
    setCropping(false);
    setCrop(null);
    setError(null);
  }, [open]);

  if (!open) return null;

  function replacePreview(blob: Blob) {
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(blob);
    });
    setCrop(null);
    setCropping(false);
  }

  function capture() {
    const video = videoRef.current;
    if (!video || video.videoWidth < 2) {
      setError("התצוגה החיה עדיין לא מוכנה.");
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
          setError("הצילום נכשל.");
          return;
        }
        replacePreview(blob);
      },
      "image/jpeg",
      0.92,
    );
  }

  async function currentCanvas(): Promise<HTMLCanvasElement | null> {
    if (!previewUrl) return null;
    const image = new Image();
    image.src = previewUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return canvas;
  }

  async function rotate() {
    const canvas = await currentCanvas();
    if (!canvas) return;
    const next = document.createElement("canvas");
    next.width = canvas.height;
    next.height = canvas.width;
    const ctx = next.getContext("2d");
    if (!ctx) return;
    ctx.translate(next.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => next.toBlob(resolve, "image/jpeg", 0.92));
    if (blob) replacePreview(blob);
  }

  async function applyCrop(target: HTMLImageElement) {
    if (!crop || crop.w < 0.02 || crop.h < 0.02) {
      setError("סמנו אזור לחיתוך.");
      return;
    }
    const canvas = document.createElement("canvas");
    const sx = Math.round(crop.x * target.naturalWidth);
    const sy = Math.round(crop.y * target.naturalHeight);
    const sw = Math.max(1, Math.round(crop.w * target.naturalWidth));
    const sh = Math.max(1, Math.round(crop.h * target.naturalHeight));
    canvas.width = sw;
    canvas.height = sh;
    canvas.getContext("2d")?.drawImage(target, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (blob) replacePreview(blob);
  }

  async function addPage() {
    const canvas = await currentCanvas();
    if (!canvas) return;
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return;
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    setPages((current) => [...current, { jpeg, width: canvas.width, height: canvas.height }]);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const canvas = await currentCanvas();
      const shots = [...pages];
      if (canvas) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
        if (blob) {
          shots.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height });
        }
      }
      if (shots.length === 0) {
        setError("אין צילום לשמירה.");
        return;
      }
      const now = new Date();
      if (shots.length > 1) {
        const pdf = new Uint8Array(buildJpegPdf(shots));
        const file = new File([pdf], cameraFileName(now, "pdf"), { type: "application/pdf" });
        await onSave(file);
      } else if (format === "png" && canvas) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("שמירת התמונה נכשלה");
        await onSave(new File([blob], cameraFileName(now, "png"), { type: "image/png" }));
      } else {
        const file = new File([new Uint8Array(shots[0].jpeg)], cameraFileName(now, "jpg"), { type: "image/jpeg" });
        await onSave(file);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "שמירת הצילום נכשלה");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="adm-cam" role="dialog" aria-modal="true" aria-label="צילום מסמך" dir="rtl">
      <button type="button" className="adm-cam__backdrop" aria-label="סגירה" onClick={onClose} />
      <div className="adm-cam__panel">
        <header className="adm-cam__head">
          <strong>צילום מסמך</strong>
          <button type="button" onClick={onClose}>סגירה</button>
        </header>
        {error ? <p className="adm-cam__err">{error}</p> : null}
        <label className="adm-cam__device">
          מצלמה
          <select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
            {devices.length === 0 ? <option value="">ממתין למצלמה…</option> : null}
            {devices.map((device, index) => (
              <option key={device.deviceId || index} value={device.deviceId}>
                {device.label || `מצלמה ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
        <div className="adm-cam__stage">
          <video ref={videoRef} className={previewUrl ? "adm-cam__video is-hidden" : "adm-cam__video"} playsInline muted />
          {previewUrl ? (
            <div className="adm-cam__shot">
            <img
              src={previewUrl}
              alt="תצוגה מקדימה של המסמך"
              className="adm-cam__preview"
              onPointerDown={(event) => {
                if (!cropping) return;
                const rect = event.currentTarget.getBoundingClientRect();
                dragRef.current = {
                  x: (event.clientX - rect.left) / rect.width,
                  y: (event.clientY - rect.top) / rect.height,
                };
              }}
              onPointerMove={(event) => {
                if (!cropping || !dragRef.current) return;
                const rect = event.currentTarget.getBoundingClientRect();
                const x = (event.clientX - rect.left) / rect.width;
                const y = (event.clientY - rect.top) / rect.height;
                const start = dragRef.current;
                setCrop({
                  x: Math.min(start.x, x),
                  y: Math.min(start.y, y),
                  w: Math.abs(x - start.x),
                  h: Math.abs(y - start.y),
                });
              }}
              onPointerUp={(event) => {
                dragRef.current = null;
                if (cropping && crop) void applyCrop(event.currentTarget);
              }}
            />
            {crop && cropping ? (
              <span
                className="adm-cam__crop"
                style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }}
              />
            ) : null}
            </div>
          ) : null}
        </div>
        <p className="adm-cam__note">
          {pages.length > 0 ? `${pages.length} עמודים נשמרו לצילום. עמוד נוסף יישמר יחד כ־PDF.` : "הצילום נשמר באיכות המצלמה, בלי דחיסה שפוגעת בקריאות."}
        </p>
        <footer className="adm-cam__actions">
          {!previewUrl ? (
            <button type="button" className="adm-cam__primary" onClick={capture} disabled={Boolean(error) || busy}>צלם מסמך</button>
          ) : (
            <>
              <button type="button" onClick={() => setPreviewUrl((current) => { if (current) URL.revokeObjectURL(current); return null; })}>צילום מחדש</button>
              <button type="button" onClick={() => void rotate()}>סיבוב</button>
              <button type="button" onClick={() => setCropping((value) => !value)}>{cropping ? "סיום חיתוך" : "חיתוך"}</button>
              <label>פורמט
                <select value={format} onChange={(event) => setFormat(event.target.value === "png" ? "png" : "jpg")}>
                  <option value="jpg">JPG</option>
                  <option value="png">PNG</option>
                </select>
              </label>
              <button type="button" onClick={() => void addPage()}>הוסף עמוד</button>
              <button type="button" className="adm-cam__primary" onClick={() => void save()} disabled={busy}>
                {busy ? "שומר…" : pages.length > 0 ? "שמור PDF" : "שמור צילום"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
