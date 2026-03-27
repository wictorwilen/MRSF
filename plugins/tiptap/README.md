# @mrsf/tiptap-mrsf

Experimental Tiptap integration for MRSF (Markdown Review Sidecar Format). Help needed.

> Status: Experimental. Help wanted on anchor fidelity, gutter parity, and overall hardening.

This package keeps review state in memory while the editor changes and expects
the host application to control sidecar loading and persistence explicitly.

Current scope:

- ProseMirror-native inline comment rendering
- In-memory review state with live line shifting
- Save, reload, reanchor, reply, edit, resolve, and delete flows
- Lightweight package-owned dialogs and inline thread popovers

Performance tuning:

- `liveTracking: "debounced"` batches editor text changes and applies them after a short pause. This is the default.
- `liveTracking: "save-only"` defers live tracking until `editor.commands.mrsfSave()` or controller save is called.
- `liveTracking: "eager"` applies each editor text change immediately.

The first implementation pass focuses on inline-anchored comments. Line-only
thread visualization and gutter parity will be added on top of the same state
model instead of reusing the shared DOM controller.