import { Box, Text } from "@opentui/core";
import { theme } from "../theme.js";

function wrapParagraph(paragraph: string, width: number): string[] {
  if (!paragraph) {
    return [""];
  }

  const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) {
    return [""];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      if (word.length <= width) {
        current = word;
        continue;
      }

      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }

    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
      continue;
    }

    lines.push(current);
    if (word.length <= width) {
      current = word;
      continue;
    }

    for (let i = 0; i < word.length; i += width) {
      lines.push(word.slice(i, i + width));
    }
    current = "";
  }

  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [""];
}

function wrapText(text: string, width: number): string[] {
  const normalizedWidth = Math.max(1, width);
  const paragraphs = text.split("\n");
  const wrapped: string[] = [];
  for (const paragraph of paragraphs) {
    wrapped.push(...wrapParagraph(paragraph, normalizedWidth));
  }
  return wrapped.length > 0 ? wrapped : [""];
}

export function renderStatusBar(message: string, hints: string, totalWidth: number) {
  const innerWidth = Math.max(1, totalWidth - 4); // border (2) + horizontal padding (2)
  const messageLines = wrapText(message || "Ready", innerWidth);
  const hintsLines = wrapText(hints, innerWidth);
  const messageText = messageLines.join("\n");
  const hintsText = hintsLines.join("\n");
  const contentHeight = messageLines.length + hintsLines.length;
  const totalHeight = contentHeight + 2; // border only; paddingTop/paddingBottom are 0

  return Box(
    {
      id: "status-bar",
      width: "100%",
      height: totalHeight,
      borderStyle: "single",
      borderColor: theme.border,
      backgroundColor: theme.backgroundMuted,
      paddingTop: 0,
      paddingBottom: 0,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "column",
      alignItems: "stretch",
    },
    Box(
      {
        width: "100%",
        height: messageLines.length,
      },
      Text({ content: messageText, fg: theme.textMuted }),
    ),
    Box(
      {
        width: "100%",
        height: hintsLines.length,
      },
      Text({ content: hintsText, fg: theme.textPrimary }),
    ),
  );
}
