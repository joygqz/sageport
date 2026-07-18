# Repository guidelines

## Code

- Do not add code comments. Use clear names and structure so the code explains itself.

## UI copy

Follow the [GitHub Primer content guidelines](https://primer.style/product/getting-started/foundations/content/) and [ConfirmationDialog guidelines](https://primer.style/product/components/confirmation-dialog/guidelines/).

- Keep copy clear, concise, active, and consistent. Use sentence case in English.
- Use short, specific `verb + object` action labels. Avoid generic labels such as `Confirm`, `Yes`, `No`, and `OK`.
- Do not punctuate headings, labels, or buttons. Confirmation titles are specific questions. Reserve ellipses for progress states, and avoid semicolons and exclamation marks.
- State consequences for destructive actions. Use `Delete` only for permanent deletion and `Remove` when the item remains elsewhere.
- Make validation and errors actionable, without blame, humor, internal codes, or repeated context. Give icon-only controls specific accessible names.
- Update `src/i18n/locales/en.ts` and `src/i18n/locales/zh-CN.ts` together. Keep keys identical, write natural Simplified Chinese, and preserve meaningful technical text.

After changing UI copy, run `pnpm format:check`, `pnpm check:conventions`, `pnpm typecheck`, `pnpm test`, and `pnpm lint`.
