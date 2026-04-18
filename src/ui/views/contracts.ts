import type { CliRenderer, KeyEvent } from "@opentui/core";
import type { ExpandedPost } from "../../types.js";
import type { InlineImageManager } from "../media/inline-image-manager.js";

export interface ViewContext {
  renderer: CliRenderer;
  inlineImageManager: InlineImageManager;
  setStatus: (message: string) => void;
  pushPostDetail: (post: ExpandedPost) => Promise<void>;
  pushProfile: (username: string) => Promise<void>;
  pushSearch: () => Promise<void>;
  pushCategories: () => Promise<void>;
  pushCategoryTimeline: (slug: string, name: string) => Promise<void>;
  popView: () => void;
}

export interface ViewDescriptor {
  title: string;
  hints: string;
  content: unknown;
}

export interface TuitterView {
  onEnter: () => Promise<void> | void;
  onExit?: () => Promise<void> | void;
  onAfterRenderSync?: () => void;
  onDidRender?: () => Promise<void> | void;
  render: () => ViewDescriptor;
  handleKey: (key: KeyEvent) => Promise<boolean> | boolean;
  // When true, the app skips global single-letter shortcuts (/, c, q) so the
  // view can receive raw typed characters (e.g. search input field).
  isInputFocused?: () => boolean;
}

export function isKey(key: KeyEvent, ...names: string[]): boolean {
  return names.includes(key.name) || names.includes(key.sequence);
}
