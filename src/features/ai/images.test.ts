import { describe, expect, it } from "vitest";

import type { AiImageAttachment } from "@/types/models";
import { estimateMessageTokens, modelHistoryWindow } from "./history";
import { imageDataUrl, imageHistoryError, MAX_IMAGE_BYTES } from "./images";
import { buildLogFromHistory } from "./transcript";

const image: AiImageAttachment = {
  id: "image-1",
  name: "screenshot.png",
  mimeType: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=",
  width: 1,
  height: 1,
};

describe("image messages", () => {
  it("supports image-only messages and restores images in the transcript", () => {
    const messages = [{ role: "user" as const, images: [image] }];
    expect(imageHistoryError([], [image])).toBeNull();
    expect(buildLogFromHistory(messages)[0]).toMatchObject({
      kind: "user",
      images: [image],
    });
    expect(modelHistoryWindow(messages).messages[0].images).toEqual([image]);
    expect(imageDataUrl(image)).toBe(`data:image/png;base64,${image.data}`);
  });

  it("counts image tokens without treating base64 as prompt text", () => {
    expect(estimateMessageTokens({ role: "user", images: [image] })).toBe(4108);
    expect(
      estimateMessageTokens({
        role: "user",
        images: [{ ...image, data: "A".repeat(100_000) }],
      }),
    ).toBe(4108);
  });

  it("rejects excessive attachments and unsupported content", () => {
    expect(imageHistoryError([], Array(5).fill(image))).toBe(
      "ai.images.tooMany",
    );
    expect(
      imageHistoryError([], [{ ...image, data: "https://example.com/image" }]),
    ).toBe("ai.images.invalid");
    expect(imageHistoryError([], [{ ...image, width: 100_000 }])).toBe(
      "ai.images.invalid",
    );
    expect(
      imageHistoryError(
        [],
        [{ ...image, data: "A".repeat(MAX_IMAGE_BYTES * 2) }],
      ),
    ).toBe("ai.images.invalid");
  });

  it("keeps image history within the persisted chat payload limit", () => {
    const large = { ...image, data: "A".repeat(1_000_000) };
    expect(
      imageHistoryError(
        [{ role: "user", images: Array(8).fill(large) }],
        [large],
      ),
    ).toBe("ai.images.historyFull");
  });

  it("drops older image turns as a unit while preserving the current image", () => {
    const older = { role: "user" as const, content: "older", images: [image] };
    const current = {
      role: "user" as const,
      content: "current",
      images: [{ ...image, id: "new" }],
    };
    const result = modelHistoryWindow(
      [older, { role: "assistant", content: "reply" }, current],
      5000,
    );
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].images?.[0].id).toBe("new");
    expect(older.images).toEqual([image]);
  });
});
