import type * as monaco from "monaco-editor";
import type {
  DecorationSnapshot,
  EditorRange,
  MonacoDecorationClasses,
  MonacoDecorationOptions,
  MonacoDecorationSet,
} from "./types.js";

const defaultClasses: MonacoDecorationClasses = {
  lineOpen: "mrsf-monaco-gutter-open",
  lineResolved: "mrsf-monaco-gutter-resolved",
  lineMixed: "mrsf-monaco-gutter-mixed",
  lineHigh: "mrsf-monaco-gutter-high",
  lineMedium: "mrsf-monaco-gutter-medium",
  lineLow: "mrsf-monaco-gutter-low",
  inlineBase: "mrsf-monaco-inline",
  inlineResolved: "mrsf-monaco-inline-resolved",
  inlineHigh: "mrsf-monaco-inline-high",
  inlineMedium: "mrsf-monaco-inline-medium",
  inlineLow: "mrsf-monaco-inline-low",
};

function toMonacoRange(range: EditorRange): monaco.Range {
  return {
    startLineNumber: range.start.lineIndex + 1,
    startColumn: range.start.column + 1,
    endLineNumber: range.end.lineIndex + 1,
    endColumn: range.end.column + 1,
  } as monaco.IRange as monaco.Range;
}

function severityClass(
  severity: string | null,
  classes: MonacoDecorationClasses,
  kind: "line" | "inline",
): string | undefined {
  if (severity === "high") return kind === "line" ? classes.lineHigh : classes.inlineHigh;
  if (severity === "medium") return kind === "line" ? classes.lineMedium : classes.inlineMedium;
  if (severity === "low") return kind === "line" ? classes.lineLow : classes.inlineLow;
  return undefined;
}

function resolvedClass(
  resolvedState: "open" | "resolved" | "mixed",
  classes: MonacoDecorationClasses,
): string {
  if (resolvedState === "resolved") return classes.lineResolved;
  if (resolvedState === "mixed") return classes.lineMixed;
  return classes.lineOpen;
}

export function createMonacoDecorationSet(
  snapshot: DecorationSnapshot,
  options: MonacoDecorationOptions = {},
): MonacoDecorationSet {
  const classes: MonacoDecorationClasses = {
    ...defaultClasses,
    ...options.classes,
  };

  const gutter = options.gutterIcons === false
    ? []
    : snapshot.gutterMarks.map((mark) => {
        const classNames = [
          resolvedClass(mark.resolvedState, classes),
          severityClass(mark.highestSeverity, classes, "line"),
        ].filter((value): value is string => !!value);

        return {
          range: {
            startLineNumber: mark.line,
            startColumn: 1,
            endLineNumber: mark.line,
            endColumn: 1,
          },
          options: {
            isWholeLine: true,
            glyphMarginClassName: classNames.join(" "),
            glyphMarginHoverMessage: options.hover === false
              ? undefined
              : [
                  { value: `MRSF: ${mark.commentCount} comment${mark.commentCount === 1 ? "" : "s"}` },
                  { value: `Threads: ${mark.threadCount}` },
                ],
            zIndex: options.decorationZIndex,
          },
        } satisfies monaco.editor.IModelDeltaDecoration;
      });

  const inline = options.inlineHighlights === false
    ? []
    : snapshot.inlineRanges.map((inlineRange) => {
        const classNames = [
          classes.inlineBase,
          inlineRange.resolved ? classes.inlineResolved : undefined,
          severityClass(inlineRange.severity, classes, "inline"),
        ].filter((value): value is string => !!value);

        return {
          range: toMonacoRange(inlineRange.range),
          options: {
            className: classNames.join(" "),
            hoverMessage: options.hover === false
              ? undefined
              : [{ value: inlineRange.selectedText ?? "MRSF comment" }],
            zIndex: options.decorationZIndex,
          },
        } satisfies monaco.editor.IModelDeltaDecoration;
      });

  return { gutter, inline };
}

export function defaultMonacoDecorationClasses(): MonacoDecorationClasses {
  return { ...defaultClasses };
}

export function injectDefaultMonacoDecorationStyles(
  targetDocument?: Document,
  classes: MonacoDecorationClasses = defaultClasses,
): void {
  const resolvedDocument = targetDocument ?? (
    typeof document !== "undefined" ? document : undefined
  );
  if (!resolvedDocument) {
    return;
  }

  const styleId = "mrsf-monaco-decoration-styles";
  if (resolvedDocument.getElementById(styleId)) {
    return;
  }

  const style = resolvedDocument.createElement("style");
  style.id = styleId;
  style.textContent = `
.${classes.lineOpen} { background: linear-gradient(180deg, #d97706 0%, #b45309 100%); border-radius: 999px; width: 10px; height: 10px; margin-left: 4px; margin-top: 4px; }
.${classes.lineResolved} { background: linear-gradient(180deg, #16a34a 0%, #15803d 100%); border-radius: 999px; width: 10px; height: 10px; margin-left: 4px; margin-top: 4px; }
.${classes.lineMixed} { background: linear-gradient(90deg, #d97706 0%, #16a34a 100%); border-radius: 999px; width: 10px; height: 10px; margin-left: 4px; margin-top: 4px; }
.${classes.lineHigh} { box-shadow: 0 0 0 2px rgba(220, 38, 38, 0.35); }
.${classes.lineMedium} { box-shadow: 0 0 0 2px rgba(217, 119, 6, 0.3); }
.${classes.lineLow} { box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2); }
.${classes.inlineBase} { background: rgba(245, 158, 11, 0.16); border-bottom: 1px solid rgba(217, 119, 6, 0.6); }
.${classes.inlineResolved} { background: rgba(34, 197, 94, 0.14); border-bottom-color: rgba(22, 163, 74, 0.55); }
.${classes.inlineHigh} { background: rgba(239, 68, 68, 0.16); border-bottom-color: rgba(220, 38, 38, 0.7); }
.${classes.inlineMedium} { background: rgba(245, 158, 11, 0.18); }
.${classes.inlineLow} { background: rgba(59, 130, 246, 0.12); border-bottom-color: rgba(37, 99, 235, 0.45); }
`;
  resolvedDocument.head.appendChild(style);
}