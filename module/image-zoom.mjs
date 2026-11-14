// module/image-zoom.mjs — Bilder groß anzeigen, auch ohne Rechte am Dokument
//
// Spieler sahen Tokens auf der Karte und Gegenstände in Beute und Chat, konnten
// sie aber nicht vergrößern: ohne Besitzrecht gibt es weder das Token-Menü
// noch den Bogen des Gegenstands. Foundrys ImagePopout selbst braucht keine
// Rechte (client/applications/apps/image-popout.mjs, v13.351) — es fehlte nur
// ein Weg dorthin.
//
//  - Token: Maus darauf, Taste B (änderbar unter "Steuerung konfigurieren").
//  - Bilder in Beute, Chatkarten, Inventar und Bögen: ein Klick.
//
// Gezeigt wird nur, was der Benutzer ohnehin sehen darf: beim Token sein Bild
// auf der Karte, das Porträt des Akteurs erst ab Recht "Begrenzt". Der Name
// steht nur dabei, wenn er auch auf der Karte zu sehen ist.

const SYSTEM_ID = "aborea-v7";
export const ZOOM_KEYBINDING = "zoomHoveredToken";

/** Bilder, die ein Klick vergrössert. */
export const ZOOMABLE_SELECTOR = [
  "img.loot-item-img", "img.loot-portrait", "img.picker-item-img",
  "img.ac-portrait", "img.god-img", "img.coin-icon", "img.profile-img",
  "img.item-img", ".aborea-chat-card img",
].join(", ");

const DEFAULT_ICONS = new Set(["icons/svg/mystery-man.svg", "icons/svg/item-bag.svg", ""]);

// ══════════════════════════════════════════════════════════════════
//  Reine Rechnungen
// ══════════════════════════════════════════════════════════════════

/**
 * Welches Bild zeigt die Vergrösserung eines Tokens?
 * Das Porträt nur, wenn der Benutzer den Akteur sehen darf und es eines gibt —
 * sonst das Tokenbild, das er auf der Karte ohnehin sieht.
 */
export function tokenZoomImage({ tokenSrc = "", actorImg = "", canSeeActor = false } = {}) {
  if (canSeeActor && actorImg && !DEFAULT_ICONS.has(actorImg)) return actorImg;
  return tokenSrc || actorImg || "";
}

/** Titel der Vergrösserung: der Name nur, wenn er sichtbar sein darf. */
export function zoomTitle({ name = "", canSeeName = false } = {}) {
  return canSeeName && name ? String(name) : "";
}

/**
 * Soll ein Klick auf dieses Bild vergrössern?
 * Ein Bild mit data-edit wechselt auf einem bearbeitbaren Bogen das Bild —
 * dort bleibt es dabei. Auf einem nur lesbaren Bogen vergrössert es.
 */
export function shouldZoomOnClick({ matches = false, hasEdit = false, editable = false, src = "" } = {}) {
  if (!matches || !src) return false;
  if (hasEdit && editable) return false;
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  Foundry-Anbindung
// ══════════════════════════════════════════════════════════════════

function popout(src, title = "", uuid = null) {
  if (!src) return;
  const ImagePopout = foundry.applications.apps.ImagePopout;
  new ImagePopout({ src, uuid, window: { title } }).render({ force: true });
}

/** Vergrössert den Token unter der Maus. */
export function zoomHoveredToken() {
  const token = canvas?.tokens?.hover;
  if (!token?.visible) return false;
  const doc = token.document;
  const actor = token.actor;
  const src = tokenZoomImage({
    tokenSrc:    doc.texture?.src ?? "",
    actorImg:    actor?.img ?? "",
    canSeeActor: !!actor?.testUserPermission(game.user, "LIMITED"),
  });
  const title = zoomTitle({ name: doc.name, canSeeName: game.user.isGM || !!token.nameplate?.visible });
  popout(src, title);
  return true;
}

/** Ist der Bogen, in dem das Element steht, bearbeitbar? */
function isEditableHost(el) {
  const appEl = el.closest(".application, .app");
  const app = appEl ? foundry.applications.instances?.get(appEl.id) : null;
  return !!app?.isEditable;
}

function onClick(ev) {
  const img = ev.target?.closest?.("img");
  if (!img) return;
  const ok = shouldZoomOnClick({
    matches:  img.matches(ZOOMABLE_SELECTOR) && !!img.closest(".aborea, .aborea-chat-card, .aborea-loot-picker"),
    hasEdit:  img.hasAttribute("data-edit") || img.dataset.action === "editImage",
    editable: isEditableHost(img),
    src:      img.getAttribute("src") ?? "",
  });
  if (!ok) return;
  ev.preventDefault();
  ev.stopPropagation();
  popout(img.getAttribute("src"), img.getAttribute("title") || img.getAttribute("alt") || "");
}

export function registerImageZoom() {
  game.keybindings.register(SYSTEM_ID, ZOOM_KEYBINDING, {
    name: "Bild vergrößern",
    hint: "Zeigt das Bild des Tokens unter dem Mauszeiger groß an — auch für Tokens, die einem nicht gehören.",
    editable: [{ key: "KeyB" }],
    onDown: () => zoomHoveredToken(),
    precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
  });
  // Erfassungsphase: vor den Klickhandlern der Bögen, die sonst einen Bogen
  // öffnen wollten, für den das Recht fehlt.
  document.addEventListener("click", onClick, true);
}
