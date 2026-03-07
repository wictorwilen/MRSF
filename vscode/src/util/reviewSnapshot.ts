import * as vscode from "vscode";
import type { Comment, MrsfDocument } from "@mrsf/cli";
import {
  projectDecorationSnapshot,
  type DecorationSnapshot,
} from "@mrsf/monaco-mrsf/browser";
import { toDocumentGeometry } from "./positions.js";

export function buildReviewSnapshot(
  document: vscode.TextDocument,
  review: MrsfDocument,
  showResolved: boolean,
): DecorationSnapshot {
  return projectDecorationSnapshot(review, {
    showResolved,
    geometry: toDocumentGeometry(document),
  });
}

export function toCommentMap(review: MrsfDocument): Map<string, Comment> {
  return new Map(review.comments.map((comment) => [comment.id, comment]));
}