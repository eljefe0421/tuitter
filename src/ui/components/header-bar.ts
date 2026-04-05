import { Box, Text } from "@opentui/core";
import { theme } from "../theme.js";

interface HeaderScreenTime {
  text: string;
  color: string;
}

export function renderHeaderBar(viewTitle: string, screenTime?: HeaderScreenTime) {
  return Box(
    {
      id: "header-bar",
      width: "100%",
      height: 3,
      borderStyle: "single",
      borderColor: theme.border,
      backgroundColor: theme.backgroundMuted,
      paddingLeft: 1,
      paddingRight: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    Text({ content: "tuitter", fg: theme.accentStrong }),
    Box(
      {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        flexGrow: 1,
      },
      Text({ content: viewTitle, fg: theme.textPrimary }),
      Text({
        id: "header-screen-time",
        content: screenTime ? `  ${screenTime.text}` : "",
        fg: screenTime?.color ?? theme.textMuted,
      }),
    ),
  );
}
