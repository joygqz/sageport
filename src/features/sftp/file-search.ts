function captureAt(
  captures: readonly string[],
  index: number,
): string | undefined {
  if (index >= captures.length) return undefined;
  return captures[index] ?? "";
}

function expandRegexReplacement(
  replacement: string,
  captures: readonly string[],
): string {
  let expanded = "";

  for (let index = 0; index < replacement.length; index += 1) {
    const character = replacement[index];

    if (character === "\\") {
      const escaped = replacement[index + 1];
      if (escaped === "n") {
        expanded += "\n";
        index += 1;
      } else if (escaped === "t") {
        expanded += "\t";
        index += 1;
      } else if (escaped === "\\") {
        expanded += "\\";
        index += 1;
      } else {
        expanded += character;
      }
      continue;
    }

    if (character !== "$") {
      expanded += character;
      continue;
    }

    const token = replacement[index + 1];
    if (token === "$") {
      expanded += "$";
      index += 1;
      continue;
    }

    if (token === "&" || token === "0") {
      const match = captureAt(captures, 0);
      if (match === undefined) {
        expanded += `$${token}`;
      } else {
        expanded += match;
      }
      index += 1;
      continue;
    }

    if (token !== undefined && token >= "1" && token <= "9") {
      const following = replacement[index + 2];
      const hasSecondDigit =
        following !== undefined && following >= "0" && following <= "9";
      const captureToken = hasSecondDigit ? `${token}${following}` : token;
      const capture = captureAt(captures, Number(captureToken));

      if (capture === undefined) {
        expanded += `$${captureToken}`;
      } else {
        expanded += capture;
      }
      index += captureToken.length;
      continue;
    }

    expanded += character;
  }

  return expanded;
}

function preserveSourceCase(value: string, source: string | undefined): string {
  if (!source || source.toUpperCase() === source.toLowerCase()) return value;

  if (source === source.toUpperCase()) return value.toUpperCase();
  if (source === source.toLowerCase()) return value.toLowerCase();

  const first = source[0];
  const rest = source.slice(1);
  const isCapitalized =
    first.toUpperCase() !== first.toLowerCase() &&
    first === first.toUpperCase() &&
    rest === rest.toLowerCase();

  if (!isCapitalized || !value) return value;
  return value[0].toUpperCase() + value.slice(1).toLowerCase();
}

export function expandReplacement(
  replacement: string,
  captures: readonly string[] | null,
  preserveCase: boolean,
  sourceText?: string,
): string {
  const expanded =
    captures === null
      ? replacement
      : expandRegexReplacement(replacement, captures);

  if (!preserveCase) return expanded;
  return preserveSourceCase(expanded, sourceText ?? captures?.[0]);
}
