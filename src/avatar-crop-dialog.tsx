import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Minus, Plus, RotateCcw, Upload } from "lucide-react";
import { Button, Dialog, Spinner } from "./ui";

interface AvatarCropDialogProps {
  file: File;
  uploading: boolean;
  onCancel: () => void;
  onConfirm: (croppedFile: File) => void;
}

const STAGE_WIDTH = 420;
const STAGE_HEIGHT = 320;
const OUTPUT_SIZE = 512;
const MIN_CROP_RADIUS = 36;

interface CropState {
  imgX: number;
  imgY: number;
  zoom: number;
  cropX: number;
  cropY: number;
  cropR: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function renderCropToCanvas(
  canvas: HTMLCanvasElement,
  size: number,
  img: HTMLImageElement,
  baseScale: number,
  state: CropState,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const totalScale = baseScale * state.zoom;
  const dispW = img.naturalWidth * totalScale;
  const dispH = img.naturalHeight * totalScale;
  const imgLeft = state.imgX - dispW / 2;
  const imgTop = state.imgY - dispH / 2;

  const boxLeft = state.cropX - state.cropR;
  const boxTop = state.cropY - state.cropR;
  const boxSize = state.cropR * 2;
  const outRatio = size / boxSize;

  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  ctx.scale(outRatio, outRatio);
  ctx.translate(-boxLeft, -boxTop);
  ctx.drawImage(img, imgLeft, imgTop, dispW, dispH);
  ctx.restore();
}

export function AvatarCropDialog({ file, uploading, onCancel, onConfirm }: AvatarCropDialogProps) {
  const [imageUrl, setImageUrl] = useState<string>("");
  const [imageMeta, setImageMeta] = useState<{ img: HTMLImageElement; width: number; height: number; baseScale: number } | null>(null);
  const [loadError, setLoadError] = useState("");
  const [crop, setCrop] = useState<CropState>({
    imgX: STAGE_WIDTH / 2,
    imgY: STAGE_HEIGHT / 2,
    zoom: 1,
    cropX: STAGE_WIDTH / 2,
    cropY: STAGE_HEIGHT / 2,
    cropR: 88,
  });

  const stageRef = useRef<HTMLDivElement>(null);
  const previewLargeRef = useRef<HTMLCanvasElement>(null);
  const previewSmallRef = useRef<HTMLCanvasElement>(null);
  const dragModeRef = useRef<{
    type: "crop" | "image" | "resize";
    startX: number;
    startY: number;
    initial: CropState;
  } | null>(null);

  const resetView = useCallback((width: number, height: number, baseScale: number) => {
    const dispW = width * baseScale;
    const dispH = height * baseScale;
    const defaultRadius = Math.round(clamp(Math.min(dispW, dispH) * 0.42, MIN_CROP_RADIUS, 115));
    setCrop({
      imgX: STAGE_WIDTH / 2,
      imgY: STAGE_HEIGHT / 2,
      zoom: 1,
      cropX: STAGE_WIDTH / 2,
      cropY: STAGE_HEIGHT / 2,
      cropR: defaultRadius,
    });
  }, []);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    setImageUrl(objectUrl);
    setLoadError("");
    setImageMeta(null);

    const img = new Image();
    img.onload = () => {
      const nw = img.naturalWidth || 256;
      const nh = img.naturalHeight || 256;
      const baseScale = Math.min((STAGE_WIDTH * 0.9) / nw, (STAGE_HEIGHT * 0.9) / nh);
      setImageMeta({ img, width: nw, height: nh, baseScale });
      resetView(nw, nh, baseScale);
    };
    img.onerror = () => {
      setLoadError("无法读取选定的图片，请更换文件重试");
    };
    img.src = objectUrl;

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [file, resetView]);

  // 实时绘制右侧圆形预览
  useEffect(() => {
    if (!imageMeta) return;
    if (previewLargeRef.current) {
      renderCropToCanvas(previewLargeRef.current, 84, imageMeta.img, imageMeta.baseScale, crop);
    }
    if (previewSmallRef.current) {
      renderCropToCanvas(previewSmallRef.current, 36, imageMeta.img, imageMeta.baseScale, crop);
    }
  }, [imageMeta, crop]);

  const startDrag = (type: "crop" | "image" | "resize", clientX: number, clientY: number) => {
    if (uploading) return;
    dragModeRef.current = {
      type,
      startX: clientX,
      startY: clientY,
      initial: { ...crop },
    };
  };

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const drag = dragModeRef.current;
      if (!drag) return;
      const rect = stageRef.current?.getBoundingClientRect();
      const scaleX = rect && rect.width > 0 ? STAGE_WIDTH / rect.width : 1;
      const scaleY = rect && rect.height > 0 ? STAGE_HEIGHT / rect.height : 1;
      const dx = (e.clientX - drag.startX) * scaleX;
      const dy = (e.clientY - drag.startY) * scaleY;

      if (drag.type === "crop") {
        setCrop((prev) => ({
          ...prev,
          cropX: clamp(drag.initial.cropX + dx, prev.cropR, STAGE_WIDTH - prev.cropR),
          cropY: clamp(drag.initial.cropY + dy, prev.cropR, STAGE_HEIGHT - prev.cropR),
        }));
      } else if (drag.type === "image") {
        setCrop((prev) => ({
          ...prev,
          imgX: drag.initial.imgX + dx,
          imgY: drag.initial.imgY + dy,
        }));
      } else if (drag.type === "resize") {
        if (!rect) return;
        const px = (e.clientX - rect.left) * scaleX;
        const py = (e.clientY - rect.top) * scaleY;
        const dist = Math.hypot(px - drag.initial.cropX, py - drag.initial.cropY);
        const maxR = Math.min(
          drag.initial.cropX,
          STAGE_WIDTH - drag.initial.cropX,
          drag.initial.cropY,
          STAGE_HEIGHT - drag.initial.cropY,
          STAGE_HEIGHT / 2 - 4,
        );
        setCrop((prev) => ({
          ...prev,
          cropR: clamp(Math.round(dist), MIN_CROP_RADIUS, Math.max(MIN_CROP_RADIUS, maxR)),
        }));
      }
    };

    const onPointerUp = () => {
      dragModeRef.current = null;
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, []);

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (uploading) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.1 : -0.1;
    setCrop((prev) => ({
      ...prev,
      zoom: clamp(Number((prev.zoom + delta).toFixed(2)), 0.4, 4),
    }));
  };

  const handleConfirm = async () => {
    if (!imageMeta) {
      onConfirm(file);
      return;
    }

    const outCanvas = document.createElement("canvas");
    outCanvas.width = OUTPUT_SIZE;
    outCanvas.height = OUTPUT_SIZE;
    const ctx = outCanvas.getContext("2d");
    if (!ctx) {
      onConfirm(file);
      return;
    }

    renderCropToCanvas(outCanvas, OUTPUT_SIZE, imageMeta.img, imageMeta.baseScale, crop);

    outCanvas.toBlob(
      (blob) => {
        if (!blob) {
          onConfirm(file);
          return;
        }
        const baseName = file.name.replace(/\.[^.]+$/, "") || "avatar";
        const croppedFile = new File([blob], `${baseName}.png`, { type: "image/png" });
        onConfirm(croppedFile);
      },
      "image/png",
      0.95,
    );
  };

  const dispW = imageMeta ? imageMeta.width * imageMeta.baseScale * crop.zoom : 0;
  const dispH = imageMeta ? imageMeta.height * imageMeta.baseScale * crop.zoom : 0;
  const imgLeftPct = ((crop.imgX - dispW / 2) / STAGE_WIDTH) * 100;
  const imgTopPct = ((crop.imgY - dispH / 2) / STAGE_HEIGHT) * 100;
  const imgWidthPct = (dispW / STAGE_WIDTH) * 100;
  const imgHeightPct = (dispH / STAGE_HEIGHT) * 100;

  const cropLeftPct = ((crop.cropX - crop.cropR) / STAGE_WIDTH) * 100;
  const cropTopPct = ((crop.cropY - crop.cropR) / STAGE_HEIGHT) * 100;
  const cropWidthPct = ((crop.cropR * 2) / STAGE_WIDTH) * 100;
  const cropHeightPct = ((crop.cropR * 2) / STAGE_HEIGHT) * 100;

  return (
    <Dialog
      title="调整并预览头像"
      description="拖动圆形虚框选择截取区域，或拖拽、缩放背景图片"
      onClose={onCancel}
      dismissible={!uploading}
      medium
    >
      <div className="avatar-crop-layout">
        <div className="avatar-crop-main">
          <div
            ref={stageRef}
            className="avatar-crop-stage"
            onWheel={handleWheel}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains("avatar-crop-bg-img")) {
                e.preventDefault();
                startDrag("image", e.clientX, e.clientY);
              }
            }}
          >
            {loadError ? (
              <div className="avatar-crop-error">{loadError}</div>
            ) : !imageMeta ? (
              <div className="avatar-crop-loading"><Spinner label="正在加载图片" /></div>
            ) : (
              <>
                <img
                  src={imageUrl}
                  alt="待裁剪头像"
                  draggable={false}
                  className="avatar-crop-bg-img"
                  style={{
                    left: `${imgLeftPct}%`,
                    top: `${imgTopPct}%`,
                    width: `${imgWidthPct}%`,
                    height: `${imgHeightPct}%`,
                  }}
                />
                <div
                  className="avatar-crop-circle"
                  style={{
                    left: `${cropLeftPct}%`,
                    top: `${cropTopPct}%`,
                    width: `${cropWidthPct}%`,
                    height: `${cropHeightPct}%`,
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    startDrag("crop", e.clientX, e.clientY);
                  }}
                  title="拖动移动裁剪框"
                >
                  <span
                    className="avatar-crop-resize-handle"
                    title="拖动调整裁剪框大小"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      startDrag("resize", e.clientX, e.clientY);
                    }}
                  />
                </div>
              </>
            )}
          </div>

          <div className="avatar-crop-controls">
            <div className="avatar-crop-control-row">
              <span className="avatar-crop-control-label">背景缩放</span>
              <button
                type="button"
                className="avatar-crop-step-btn"
                aria-label="缩小背景图片"
                disabled={uploading || !imageMeta}
                onClick={() => setCrop((p) => ({ ...p, zoom: clamp(Number((p.zoom - 0.1).toFixed(2)), 0.4, 4) }))}
              >
                <Minus size={14} />
              </button>
              <input
                type="range"
                aria-label="背景图片缩放比例"
                min="0.4"
                max="4"
                step="0.02"
                value={crop.zoom}
                disabled={uploading || !imageMeta}
                onChange={(e) => setCrop((p) => ({ ...p, zoom: Number(e.target.value) }))}
              />
              <button
                type="button"
                className="avatar-crop-step-btn"
                aria-label="放大背景图片"
                disabled={uploading || !imageMeta}
                onClick={() => setCrop((p) => ({ ...p, zoom: clamp(Number((p.zoom + 0.1).toFixed(2)), 0.4, 4) }))}
              >
                <Plus size={14} />
              </button>
              <span className="avatar-crop-value">{Math.round(crop.zoom * 100)}%</span>
              <button
                type="button"
                className="avatar-crop-reset-btn"
                disabled={uploading || !imageMeta}
                onClick={() => imageMeta && resetView(imageMeta.width, imageMeta.height, imageMeta.baseScale)}
                title="重置图片和裁剪框位置"
              >
                <RotateCcw size={13} />
                <span>重置</span>
              </button>
            </div>
          </div>
        </div>

        <aside className="avatar-crop-sidebar">
          <div className="avatar-crop-preview-card">
            <span className="avatar-crop-preview-title">实时头像预览</span>
            <div className="avatar-crop-preview-circles">
              <div className="avatar-crop-preview-item">
                <canvas ref={previewLargeRef} width={84} height={84} className="avatar-crop-canvas-lg" />
                <span className="avatar-crop-preview-label">个人资料</span>
              </div>
              <div className="avatar-crop-preview-item">
                <canvas ref={previewSmallRef} width={36} height={36} className="avatar-crop-canvas-sm" />
                <span className="avatar-crop-preview-label">顶栏</span>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <div className="dialog-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={uploading}>
          取消
        </Button>
        {file.type === "image/gif" && (
          <Button type="button" variant="secondary" onClick={() => onConfirm(file)} disabled={uploading}>
            {uploading ? <Spinner label="" size={15} /> : <Upload size={15} />}
            上传原动图
          </Button>
        )}
        <Button type="button" onClick={() => void handleConfirm()} disabled={uploading || Boolean(loadError)}>
          {uploading ? <><Spinner label="" size={15} />上传中...</> : <><Check size={15} />确认并上传</>}
        </Button>
      </div>
    </Dialog>
  );
}
