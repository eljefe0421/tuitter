import { Box, Text } from "@opentui/core";
import { theme } from "../theme.js";

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export function renderScreenTimeWarning(secondsToday: number, maxSeconds: number) {
  return Box(
    {
      id: "screen-time-warning",
      position: "absolute",
      zIndex: 100,
      top: 0,
      left: 0,
      width: "100%",
      height: "100%",
      backgroundColor: "#180000",
      flexDirection: "column",
      justifyContent: "center",
      alignItems: "center",
    },
    Box(
      {
        width: "80%",
        maxWidth: 76,
        borderStyle: "double",
        borderColor: theme.danger,
        backgroundColor: "#220000",
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
      },
      Text({ content: "SCREEN TIME LIMIT REACHED", fg: theme.danger }),
      Text({
        id: "screen-time-warning-usage",
        content: `You used ${formatDuration(secondsToday)} / ${formatDuration(maxSeconds)} today.`,
        fg: theme.textPrimary,
      }),
      Text({ content: "Press q or esc to exit tuitter.", fg: theme.textMuted }),
    ),
  );
}
