// Centralized DOM z-index registry (S2-C).
//
// The renderer composes a tall stack of DOM overlays on top of the Phaser
// canvas; every overlay sets `style.zIndex` directly. Without a single
// registry, layers drift: prior to this slice, the only documentation was a
// 3-entry note in `.github/copilot-instructions.md` ("status bar 100,
// terminal overlay 10000, sprite card 10001") while the codebase actually
// used 12+ distinct layers. New overlays were prone to either picking a
// number that collided with an existing layer or unintentionally floating
// above settings/dialogs.
//
// Rules:
//   1. Every renderer DOM overlay sets `style.zIndex` using a constant from
//      this module — never a magic number.
//   2. Layers are ordered bottom-to-top in the value sequence below.
//   3. Adding a new overlay = adding a new named constant here, not picking
//      an unused number ad hoc.
//   4. Co-resident overlays (e.g. SETTINGS + NOTIFICATION_SETTINGS) may share
//      a layer when they are never open simultaneously by construction. The
//      shared value documents that invariant.
//
// The constants are plain numbers (not an enum) so they remain trivially
// assignable to `style.zIndex` which accepts string-coercible values.

/**
 * Canonical z-index registry. Layers in ascending order so a quick visual scan
 * confirms relative ordering.
 */
export const ZIndex = {
  /** Status bar at the bottom of the app shell. */
  STATUS_BAR: 100,

  /** In-scene HTML overlay rendered by OfficeScene above the Phaser canvas
   *  but below all modal surfaces (e.g. fleet-progress sticker). */
  OFFICE_SCENE_OVERLAY: 150,

  /** Transient toast notifications (auto-dismissed). */
  TOAST: 9000,

  /** Terminal overlay panel host (xterm.js + tab strip). */
  TERMINAL_OVERLAY: 10000,

  /** Sprite/session card that floats above the terminal overlay. */
  TERMINAL_SPRITE_CARD: 10001,

  /** Indeterminate "Restoring session…" loader shown over the terminal
   *  viewport while a session restore is in flight (spec 021). Above the xterm
   *  content but below the sprite card so the card chrome stays visible. */
  TERMINAL_RESTORE_LOADING: 10002,

  /** Serious-mode terminal controller (full-pane mode). Sits above the
   *  terminal overlay so its chrome (mode toggle, footer) stays on top. */
  SERIOUS_TERMINAL: 10003,

  /** Sprite customizer modal. Above terminal but below settings. */
  SPRITE_CUSTOMIZER: 15000,

  /** Teams remote settings modal. Above the sprite customizer but below the
   *  main settings panel, matching other feature-settings overlays. Routed via
   *  the same `settings:open` / `settings:close` bus. */
  TEAMS_SETTINGS: 18000,

  /** Office Orchestrator agent panel — a focused chat TUI overlay that dims the
   *  game. Sits above the terminal/serious surfaces and the Teams settings modal
   *  but below the main Settings panel, so Settings can still open on top. Routed
   *  via the same `settings:open` / `settings:close` focus bus (spec 016). */
  ORCHESTRATOR_PANEL: 19000,

  /** Settings panel modal. */
  SETTINGS: 20000,

  /** Notification settings modal. Shares SETTINGS' layer because the two
   *  are never open simultaneously by app construction (both routed via
   *  the same `settings:open` / `settings:close` bus). */
  NOTIFICATION_SETTINGS: 20000,

  /** Generic blocking modal dialog (e.g. layout chooser, new office dialog).
   *  Sits above everything except the absolute top-most modal layer. */
  MODAL_DIALOG: 99999,

  /** Reserved for the topmost modal layer (e.g. critical confirmation that
   *  must sit above an already-open MODAL_DIALOG). */
  TOP_MODAL: 100000,
} as const;

export type ZIndexLayer = keyof typeof ZIndex;
