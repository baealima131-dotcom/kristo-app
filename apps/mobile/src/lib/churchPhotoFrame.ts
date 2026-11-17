/**
 * Shape of the church picture on Church Overview (own church and public overview), shared with
 * the crop screen so the saved picture fills the Overview frame exactly as it was positioned.
 */
export const CHURCH_PHOTO_ASPECT = 5 / 8; // width / height

/** Overview frame width as a share of the card's content row. */
export const CHURCH_PHOTO_FRAME_WIDTH = "42%" as const;

/** Saved picture size (5:8). */
export const CHURCH_PHOTO_OUTPUT_WIDTH = 600;
export const CHURCH_PHOTO_OUTPUT_HEIGHT = 960;

export type ChurchPhotoCropInput = {
  /** Picture size in pixels. */
  imageWidth: number;
  imageHeight: number;
  /** On-screen frame size. */
  frameWidth: number;
  frameHeight: number;
  /** Zoom (1 = picture just covers the frame) and drag offset of the picture centre, in screen points. */
  zoom: number;
  offsetX: number;
  offsetY: number;
};

/** Part of the picture (in its own pixels) that is inside the frame, as shown on screen. */
export function computeChurchPhotoCrop(p: ChurchPhotoCropInput) {
  const cover = Math.max(p.frameWidth / p.imageWidth, p.frameHeight / p.imageHeight);
  const k = cover * p.zoom; // screen points per picture pixel
  const width = Math.min(p.imageWidth, p.frameWidth / k);
  const height = Math.min(p.imageHeight, p.frameHeight / k);
  const originX = Math.max(0, Math.min(p.imageWidth - width, ((p.imageWidth * k - p.frameWidth) / 2 - p.offsetX) / k));
  const originY = Math.max(0, Math.min(p.imageHeight - height, ((p.imageHeight * k - p.frameHeight) / 2 - p.offsetY) / k));
  return {
    originX: Math.round(originX),
    originY: Math.round(originY),
    width: Math.round(width),
    height: Math.round(height),
  };
}
