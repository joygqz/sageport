import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  CaseSensitive,
  CaseUpper,
  ChevronDown,
  ChevronRight,
  Regex,
  Replace,
  ReplaceAll,
  WholeWord,
  X,
} from "lucide-react";

import {
  FindActionButton,
  FindBar,
  FindCount,
  FindInput,
  FindToggleButton,
} from "@/components/ui";
import { useI18n } from "@/i18n";
import { cn, isValidRegex } from "@/lib/utils";
import { expandReplacement } from "./file-search";
import { monaco } from "./monaco";

const MATCH_LIMIT = 20_000;
const EDIT_SOURCE = "sageport.fileFind";

type CodeEditor = ReturnType<typeof monaco.editor.create>;
type FindMatch = monaco.editor.FindMatch;

interface SearchResults {
  matches: FindMatch[];
  capped: boolean;
  invalidRegex: boolean;
}

interface FindState {
  query: string;
  replacement: string;
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  preserveCase: boolean;
  results: SearchResults;
  activeIndex: number;
}

export interface FileFindBarHandle {
  focus: (query?: string) => void;
  move: (direction: 1 | -1) => void;
}

interface FileFindBarProps {
  editor: CodeEditor;
  replaceVisible: boolean;
  requestId: number;
  seedQuery: string;
  onReplaceVisibleChange: (visible: boolean) => void;
  onClose: () => void;
}

const EMPTY_RESULTS: SearchResults = {
  matches: [],
  capped: false,
  invalidRegex: false,
};

function readMatches(editor: CodeEditor, state: FindState): SearchResults {
  const model = editor.getModel();
  if (!model || !state.query) return EMPTY_RESULTS;
  if (state.regex && !isValidRegex(state.query)) {
    return { ...EMPTY_RESULTS, invalidRegex: true };
  }

  const wordSeparators = state.wholeWord
    ? editor.getOption(monaco.editor.EditorOption.wordSeparators)
    : null;
  const found = model.findMatches(
    state.query,
    model.getFullModelRange(),
    state.regex,
    state.matchCase,
    wordSeparators,
    state.regex,
    MATCH_LIMIT + 1,
  );
  return {
    matches: found.slice(0, MATCH_LIMIT),
    capped: found.length > MATCH_LIMIT,
    invalidRegex: false,
  };
}

function initialFindState(editor: CodeEditor, query: string): FindState {
  const state: FindState = {
    query,
    replacement: "",
    matchCase: false,
    wholeWord: false,
    regex: false,
    preserveCase: false,
    results: EMPTY_RESULTS,
    activeIndex: -1,
  };
  const results = readMatches(editor, state);
  const model = editor.getModel();
  const activeIndex =
    model && results.matches.length > 0
      ? indexAtOrAfter(
          model,
          results.matches,
          editor.getSelection()?.getStartPosition() ??
            editor.getPosition() ??
            results.matches[0].range.getStartPosition(),
        )
      : -1;
  return { ...state, results, activeIndex };
}

function sameRange(a: monaco.IRange, b: monaco.IRange) {
  return (
    a.startLineNumber === b.startLineNumber &&
    a.startColumn === b.startColumn &&
    a.endLineNumber === b.endLineNumber &&
    a.endColumn === b.endColumn
  );
}

function indexAtOrAfter(
  model: monaco.editor.ITextModel,
  matches: readonly FindMatch[],
  position: monaco.IPosition,
) {
  const offset = model.getOffsetAt(position);
  const index = matches.findIndex(
    (match) => model.getOffsetAt(match.range.getStartPosition()) >= offset,
  );
  return index === -1 ? 0 : index;
}

function revealMatch(editor: CodeEditor, match: FindMatch) {
  editor.setSelection(match.range);
  editor.revealRangeInCenterIfOutsideViewport(
    match.range,
    monaco.editor.ScrollType.Smooth,
  );
}

function positionAfterText(start: monaco.IPosition, text: string) {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length === 1) {
    return {
      lineNumber: start.lineNumber,
      column: start.column + lines[0].length,
    };
  }
  return {
    lineNumber: start.lineNumber + lines.length - 1,
    column: lines[lines.length - 1].length + 1,
  };
}

export const FileFindBar = forwardRef<FileFindBarHandle, FileFindBarProps>(
  function FileFindBar(
    {
      editor,
      replaceVisible,
      requestId,
      seedQuery,
      onReplaceVisibleChange,
      onClose,
    },
    ref,
  ) {
    const { t } = useI18n();
    const replaceRowId = useId();
    const resultId = useId();
    const inputRef = useRef<HTMLInputElement>(null);
    const pendingPositionRef = useRef<monaco.IPosition | null>(null);
    const skipEmptyPendingMatchRef = useRef(false);
    const [state, setState] = useState(() =>
      initialFindState(editor, seedQuery),
    );
    const stateRef = useRef(state);
    const decorations = useMemo(
      () => editor.createDecorationsCollection(),
      [editor],
    );

    const commitState = useCallback(
      (next: FindState, reveal: boolean) => {
        stateRef.current = next;
        setState(next);
        const match = next.results.matches[next.activeIndex];
        if (reveal && match) revealMatch(editor, match);
      },
      [editor],
    );

    const updateSearch = useCallback(
      (
        patch: Partial<
          Pick<FindState, "query" | "matchCase" | "wholeWord" | "regex">
        >,
      ) => {
        const current = stateRef.current;
        const previousMatch =
          current.results.matches[current.activeIndex] ?? null;
        const nextBase = { ...current, ...patch };
        const results = readMatches(editor, nextBase);
        const model = editor.getModel();
        const activeIndex =
          model && results.matches.length > 0
            ? indexAtOrAfter(
                model,
                results.matches,
                previousMatch?.range.getStartPosition() ??
                  editor.getSelection()?.getStartPosition() ??
                  editor.getPosition() ??
                  results.matches[0].range.getStartPosition(),
              )
            : -1;
        commitState({ ...nextBase, results, activeIndex }, true);
      },
      [commitState, editor],
    );

    useLayoutEffect(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, [requestId]);

    useEffect(() => {
      const subscription = editor.onDidChangeModelContent(() => {
        const current = stateRef.current;
        const results = readMatches(editor, current);
        const model = editor.getModel();
        const pendingPosition = pendingPositionRef.current;
        let activeIndex = -1;
        if (model && results.matches.length > 0) {
          activeIndex =
            pendingPosition === null
              ? Math.min(
                  Math.max(current.activeIndex, 0),
                  results.matches.length - 1,
                )
              : indexAtOrAfter(
                  model,
                  results.matches,
                  model.validatePosition(pendingPosition),
                );

          const pendingMatch = results.matches[activeIndex];
          const validatedPending = pendingPosition
            ? model.validatePosition(pendingPosition)
            : null;
          if (
            skipEmptyPendingMatchRef.current &&
            results.matches.length > 1 &&
            pendingMatch?.range.isEmpty() &&
            validatedPending &&
            pendingMatch.range.startLineNumber ===
              validatedPending.lineNumber &&
            pendingMatch.range.startColumn === validatedPending.column
          ) {
            activeIndex = (activeIndex + 1) % results.matches.length;
          }
        }

        pendingPositionRef.current = null;
        skipEmptyPendingMatchRef.current = false;
        const next = { ...current, results, activeIndex };
        stateRef.current = next;
        setState(next);
        const match = results.matches[activeIndex];
        if (pendingPosition !== null && match) revealMatch(editor, match);
      });
      return () => subscription.dispose();
    }, [editor]);

    useEffect(() => {
      decorations.set(
        state.results.matches.map((match, index) => ({
          range: match.range,
          options: {
            className:
              index === state.activeIndex
                ? "sageport-find-match-current"
                : "sageport-find-match",
            showIfCollapsed: true,
            stickiness:
              monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
            zIndex: index === state.activeIndex ? 20 : 10,
          },
        })),
      );
    }, [decorations, state.activeIndex, state.results.matches]);

    useEffect(
      () => () => {
        decorations.clear();
      },
      [decorations],
    );

    const selectMatch = useCallback(
      (index: number) => {
        const current = stateRef.current;
        const match = current.results.matches[index];
        if (!match) return;
        commitState({ ...current, activeIndex: index }, true);
      },
      [commitState],
    );

    const move = useCallback(
      (direction: 1 | -1) => {
        const current = stateRef.current;
        const count = current.results.matches.length;
        if (count === 0) return;
        const index = current.activeIndex < 0 ? 0 : current.activeIndex;
        selectMatch((index + direction + count) % count);
      },
      [selectMatch],
    );

    useImperativeHandle(
      ref,
      () => ({
        focus: (nextQuery) => {
          if (nextQuery && nextQuery !== stateRef.current.query) {
            updateSearch({ query: nextQuery });
          }
          inputRef.current?.focus();
          inputRef.current?.select();
        },
        move,
      }),
      [move, updateSearch],
    );

    const replaceCurrent = useCallback(() => {
      const model = editor.getModel();
      if (!model) return;

      const current = stateRef.current;
      const fresh = readMatches(editor, current);
      const previous = current.results.matches[current.activeIndex];
      let index = previous
        ? fresh.matches.findIndex((match) =>
            sameRange(match.range, previous.range),
          )
        : -1;
      if (index < 0 && fresh.matches.length > 0) {
        index = indexAtOrAfter(
          model,
          fresh.matches,
          editor.getSelection()?.getStartPosition() ??
            editor.getPosition() ??
            fresh.matches[0].range.getStartPosition(),
        );
      }
      const match = fresh.matches[index];
      if (!match) return;

      const sourceText = model.getValueInRange(match.range);
      const text = expandReplacement(
        current.replacement,
        current.regex ? match.matches : null,
        current.preserveCase,
        sourceText,
      );
      if (text === sourceText) {
        pendingPositionRef.current = null;
        skipEmptyPendingMatchRef.current = false;
        move(1);
        return;
      }

      skipEmptyPendingMatchRef.current = match.range.isEmpty();
      pendingPositionRef.current = positionAfterText(
        match.range.getStartPosition(),
        text,
      );
      editor.pushUndoStop();
      const applied = editor.executeEdits(EDIT_SOURCE, [
        { range: match.range, text, forceMoveMarkers: true },
      ]);
      editor.pushUndoStop();
      if (!applied) {
        pendingPositionRef.current = null;
        skipEmptyPendingMatchRef.current = false;
      }
    }, [editor, move]);

    const replaceAllMatches = useCallback(() => {
      const model = editor.getModel();
      if (!model) return;
      const current = stateRef.current;
      const fresh = readMatches(editor, current);
      if (fresh.capped || fresh.matches.length === 0) return;

      const edits = fresh.matches.map((match) => {
        const sourceText = model.getValueInRange(match.range);
        return {
          range: match.range,
          text: expandReplacement(
            current.replacement,
            current.regex ? match.matches : null,
            current.preserveCase,
            sourceText,
          ),
          forceMoveMarkers: true,
        };
      });

      pendingPositionRef.current = null;
      skipEmptyPendingMatchRef.current = false;
      editor.pushUndoStop();
      editor.executeEdits(EDIT_SOURCE, edits);
      editor.pushUndoStop();
    }, [editor]);

    const dismiss = useCallback(() => {
      decorations.clear();
      onClose();
    }, [decorations, onClose]);

    const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") {
        event.preventDefault();
        move(event.shiftKey ? -1 : 1);
      }
    };

    const resultLabel = !state.query
      ? t("editor.find.noResults")
      : state.results.invalidRegex
        ? t("editor.find.invalidRegex")
        : state.results.matches.length === 0
          ? t("editor.find.noResults")
          : t("editor.find.resultCount", {
              current: state.activeIndex + 1,
              total: state.results.capped
                ? `${MATCH_LIMIT.toLocaleString()}+`
                : state.results.matches.length,
            });
    const hasResults = state.results.matches.length > 0;

    return (
      <FindBar
        label={t("editor.find.dialogLabel")}
        onDismiss={dismiss}
        className="grid w-[min(30rem,calc(100%-1.5rem))] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1"
      >
        <FindActionButton
          label={t("editor.find.toggleReplace")}
          icon={replaceVisible ? ChevronDown : ChevronRight}
          aria-expanded={replaceVisible}
          aria-controls={replaceRowId}
          onClick={() => onReplaceVisibleChange(!replaceVisible)}
          className={cn("h-auto self-stretch", replaceVisible && "row-span-2")}
        />

        <div className="relative min-w-0">
          <FindInput
            ref={inputRef}
            value={state.query}
            onChange={(event) => updateSearch({ query: event.target.value })}
            onKeyDown={onInputKeyDown}
            placeholder={t("editor.find.placeholder")}
            aria-label={t("editor.find.placeholder")}
            aria-invalid={state.results.invalidRegex || undefined}
            aria-describedby={state.results.invalidRegex ? resultId : undefined}
            className="pr-[4.75rem]"
          />
          <div className="absolute inset-y-0 right-0.5 flex items-center">
            <FindToggleButton
              active={state.matchCase}
              label={t("editor.find.matchCase")}
              icon={CaseSensitive}
              onClick={() =>
                updateSearch({ matchCase: !stateRef.current.matchCase })
              }
            />
            <FindToggleButton
              active={state.wholeWord}
              label={t("editor.find.wholeWord")}
              icon={WholeWord}
              onClick={() =>
                updateSearch({ wholeWord: !stateRef.current.wholeWord })
              }
            />
            <FindToggleButton
              active={state.regex}
              label={t("editor.find.regex")}
              icon={Regex}
              onClick={() => updateSearch({ regex: !stateRef.current.regex })}
            />
          </div>
        </div>

        <div className="flex items-center gap-1">
          <FindCount
            id={resultId}
            danger={Boolean(
              state.query && (state.results.invalidRegex || !hasResults),
            )}
          >
            {resultLabel}
          </FindCount>
          <FindActionButton
            label={t("editor.find.previous")}
            disabled={!hasResults}
            onClick={() => move(-1)}
            icon={ArrowUp}
          />
          <FindActionButton
            label={t("editor.find.next")}
            disabled={!hasResults}
            onClick={() => move(1)}
            icon={ArrowDown}
          />
          <FindActionButton
            label={t("editor.find.close")}
            onClick={dismiss}
            icon={X}
          />
        </div>

        {replaceVisible && (
          <>
            <div id={replaceRowId} className="relative col-start-2 min-w-0">
              <FindInput
                value={state.replacement}
                onChange={(event) =>
                  commitState(
                    {
                      ...stateRef.current,
                      replacement: event.target.value,
                    },
                    false,
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    replaceCurrent();
                  }
                }}
                placeholder={t("editor.find.replacePlaceholder")}
                aria-label={t("editor.find.replacePlaceholder")}
                className="pr-7"
              />
              <div className="absolute inset-y-0 right-0.5 flex items-center">
                <FindToggleButton
                  active={state.preserveCase}
                  label={t("editor.find.preserveCase")}
                  icon={CaseUpper}
                  onClick={() =>
                    commitState(
                      {
                        ...stateRef.current,
                        preserveCase: !stateRef.current.preserveCase,
                      },
                      false,
                    )
                  }
                />
              </div>
            </div>
            <div className="flex items-center gap-1 justify-self-start">
              <FindActionButton
                label={t("editor.find.replace")}
                disabled={!hasResults}
                onClick={replaceCurrent}
                icon={Replace}
              />
              <FindActionButton
                label={t("editor.find.replaceAll")}
                disabled={!hasResults || state.results.capped}
                onClick={replaceAllMatches}
                icon={ReplaceAll}
              />
            </div>
          </>
        )}
      </FindBar>
    );
  },
);
