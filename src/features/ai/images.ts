import type { TKey } from "@/i18n";
import type { AiChatMessage, AiImageAttachment } from "@/types/models";

export const MAX_MESSAGE_IMAGES = 4;
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const MAX_IMAGE_EDGE = 1568;
const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_SESSION_IMAGE_CHARACTERS = 8 * 1024 * 1024;
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";

export class ImageAttachmentError extends Error {
  constructor(readonly key: TKey) {
    super(key);
  }
}

export function imageDataUrl(image: AiImageAttachment): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

export function imageHistoryError(
  history: AiChatMessage[],
  images: AiImageAttachment[],
): TKey | null {
  if (images.length > MAX_MESSAGE_IMAGES) return "ai.images.tooMany";
  if (
    images.some(
      (image) =>
        !IMAGE_ACCEPT.split(",").includes(image.mimeType) ||
        !image.data ||
        image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data) ||
        !Number.isInteger(image.width) ||
        !Number.isInteger(image.height) ||
        image.width < 1 ||
        image.height < 1 ||
        image.width > MAX_IMAGE_EDGE ||
        image.height > MAX_IMAGE_EDGE,
    )
  )
    return "ai.images.invalid";
  const characters = [
    ...history.flatMap((message) => message.images ?? []),
    ...images,
  ].reduce((total, image) => total + image.data.length, 0);
  return characters > MAX_SESSION_IMAGE_CHARACTERS
    ? "ai.images.historyFull"
    : null;
}

export async function prepareImage(file: File): Promise<AiImageAttachment> {
  if (!IMAGE_ACCEPT.split(",").includes(file.type))
    throw new ImageAttachmentError("ai.images.unsupported");
  if (!file.size || file.size > MAX_SOURCE_BYTES)
    throw new ImageAttachmentError("ai.images.tooLarge");
  const url = URL.createObjectURL(file);
  try {
    const source = new Image();
    source.src = url;
    await source.decode();
    if (
      !source.naturalWidth ||
      !source.naturalHeight ||
      source.naturalWidth * source.naturalHeight > 40_000_000
    ) {
      throw new ImageAttachmentError("ai.images.invalid");
    }
    const scale = Math.min(
      1,
      MAX_IMAGE_EDGE / Math.max(source.naturalWidth, source.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(source.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new ImageAttachmentError("ai.images.invalid");
    context.fillStyle = "white";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    let mimeType: AiImageAttachment["mimeType"] = "image/png";
    let data = canvas.toDataURL(mimeType).split(",")[1];
    for (const quality of [0.92, 0.8, 0.65]) {
      if (data.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4) break;
      mimeType = "image/jpeg";
      data = canvas.toDataURL(mimeType, quality).split(",")[1];
    }
    if (data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4)
      throw new ImageAttachmentError("ai.images.tooLarge");
    return {
      id: crypto.randomUUID(),
      name: file.name.slice(0, 128),
      mimeType,
      data,
      width: canvas.width,
      height: canvas.height,
    };
  } catch (error) {
    if (error instanceof ImageAttachmentError) throw error;
    throw new ImageAttachmentError("ai.images.invalid");
  } finally {
    URL.revokeObjectURL(url);
  }
}
