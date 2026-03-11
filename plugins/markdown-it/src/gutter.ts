/* ---------------------------------------------------------------
 * AUTO-GENERATED — DO NOT EDIT
 *
 * Source: plugins/shared/src/gutter.ts
 * Run `node plugins/sync-types.mjs` to regenerate.
 * --------------------------------------------------------------- */

export type MrsfResolvedState = "open" | "resolved" | "mixed";

export interface MrsfGutterBadgePresentation {
  icon: string;
  countText: string;
  label: string;
  title: string;
  ariaLabel: string;
  className?: string;
  attributes?: Record<string, string>;
}

export interface MrsfGutterBadgeContext {
  line: number;
  commentCount: number;
  threadCount: number;
  resolvedState: MrsfResolvedState;
  highestSeverity: string | null;
  isActive: boolean;
}

export interface MrsfGutterBadgeRenderContext extends MrsfGutterBadgeContext {
  defaultPresentation: MrsfGutterBadgePresentation;
}

export interface MrsfGutterAddButtonPresentation {
  label: string;
  title: string;
  ariaLabel: string;
  className?: string;
  attributes?: Record<string, string>;
}

export interface MrsfGutterAddButtonContext {
  line: number;
  isActive: boolean;
}

export interface MrsfGutterAddButtonRenderContext extends MrsfGutterAddButtonContext {
  defaultPresentation: MrsfGutterAddButtonPresentation;
}

export interface MrsfGutterRenderers {
  badge?: (
    context: MrsfGutterBadgeRenderContext,
  ) => Partial<MrsfGutterBadgePresentation> | null | undefined;
  addButton?: (
    context: MrsfGutterAddButtonRenderContext,
  ) => Partial<MrsfGutterAddButtonPresentation> | null | undefined;
}

export interface MrsfBadgeSource {
  commentCount: number;
  threadCount: number;
  resolvedState: MrsfResolvedState;
}

export function formatMrsfCount(count: number, max = 9): string {
  return count > max ? `${max}+` : String(count);
}

export function createMrsfGutterBadgePresentation(
  context: MrsfGutterBadgeContext,
): MrsfGutterBadgePresentation {
  const icon = context.resolvedState === "resolved" ? "✓" : "💬";
  const countText = formatMrsfCount(context.commentCount);
  const label = `${icon} ${countText}`;
  const threadSummary = context.threadCount === 1 ? "1 thread" : `${context.threadCount} threads`;
  const commentSummary = context.commentCount === 1 ? "1 comment" : `${context.commentCount} comments`;

  return {
    icon,
    countText,
    label,
    title: `${threadSummary}, ${commentSummary}`,
    ariaLabel: `${label} on line ${context.line}`,
  };
}

export function createMrsfGutterAddButtonPresentation(
  _context: MrsfGutterAddButtonContext,
): MrsfGutterAddButtonPresentation {
  return {
    label: "Add",
    title: "Add comment thread",
    ariaLabel: "Add comment thread",
  };
}

export function resolveMrsfGutterBadgePresentation(
  context: MrsfGutterBadgeContext,
  renderer?: MrsfGutterRenderers["badge"],
): MrsfGutterBadgePresentation {
  const defaultPresentation = createMrsfGutterBadgePresentation(context);
  const override = renderer?.({
    ...context,
    defaultPresentation,
  });

  return {
    ...defaultPresentation,
    ...override,
    attributes: {
      ...(defaultPresentation.attributes ?? {}),
      ...(override?.attributes ?? {}),
    },
  };
}

export function resolveMrsfGutterAddButtonPresentation(
  context: MrsfGutterAddButtonContext,
  renderer?: MrsfGutterRenderers["addButton"],
): MrsfGutterAddButtonPresentation {
  const defaultPresentation = createMrsfGutterAddButtonPresentation(context);
  const override = renderer?.({
    ...context,
    defaultPresentation,
  });

  return {
    ...defaultPresentation,
    ...override,
    attributes: {
      ...(defaultPresentation.attributes ?? {}),
      ...(override?.attributes ?? {}),
    },
  };
}