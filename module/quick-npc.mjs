// module/quick-npc.mjs — GM-Tools: Schnell-NSC + Gruppenprobe
import { openGroupCheckDialog } from "./checks.mjs";

async function _pickCreature() {
  const pack = game.packs.find(p =>
    p.metadata.packageName === "aborea-v7" && p.metadata.name === "creatures"
  );
  if (!pack) { ui.notifications.error("Kreaturen-Pack 'aborea-v7.creatures' nicht gefunden."); return null; }

  const index = await pack.getIndex({ fields: ["name", "img", "system.creature.threat"] });
  const sorted = [...index].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));

  const options = sorted.map(e => {
    const threat = e.system?.creature?.threat ?? "?";
    return `<option value="${e._id}">${e.name} (Bedrohung ${threat})</option>`;
  }).join("");

  return new Promise(resolve => {
    new Dialog({
      title: "Kreatur auf Szene platzieren",
      content: `
        <div style="margin-bottom:8px">
          <label style="display:block;margin-bottom:4px;font-weight:600">Kreatur auswählen</label>
          <select id="quick-npc-sel" style="width:100%">${options}</select>
        </div>
        <div>
          <label style="display:block;margin-bottom:4px;font-weight:600">Anzahl</label>
          <input id="quick-npc-count" type="number" value="1" min="1" max="20" style="width:60px" />
        </div>
      `,
      buttons: {
        place: {
          label: "Platzieren",
          icon: '<i class="fas fa-map-marker-alt"></i>',
          callback: html => {
            const id    = html[0].querySelector("#quick-npc-sel").value;
            const count = Number(html[0].querySelector("#quick-npc-count").value) || 1;
            resolve({ id, count, pack });
          }
        },
        cancel: { label: "Abbrechen", callback: () => resolve(null) }
      },
      default: "place",
      close: () => resolve(null)
    }).render(true);
  });
}

export async function spawnCreatureOnScene() {
  const activeScene = game.scenes.active;
  if (!activeScene) { ui.notifications.warn("Keine aktive Szene."); return; }

  const pick = await _pickCreature();
  if (!pick) return;

  const doc = await pick.pack.getDocument(pick.id);
  if (!doc) { ui.notifications.error("Kreatur konnte nicht geladen werden."); return; }

  // Startposition: Mitte der Szene, leicht versetzt je Exemplar
  const gridSize = activeScene.grid?.size ?? 100;
  const midX = Math.floor((activeScene.dimensions?.width ?? 1000) / 2 / gridSize) * gridSize;
  const midY = Math.floor((activeScene.dimensions?.height ?? 800) / 2 / gridSize) * gridSize;

  const baseToken = doc.prototypeToken?.toObject() ?? {};
  const tokenDocs = [];
  for (let i = 0; i < pick.count; i++) {
    const col = i % 5;
    const row = Math.floor(i / 5);
    tokenDocs.push({
      ...baseToken,
      name:        doc.name + (pick.count > 1 ? ` ${i + 1}` : ""),
      x:           midX + col * gridSize,
      y:           midY + row * gridSize,
      actorId:     doc.id,
      actorLink:   false,
      displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
      displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
      bar1:        { attribute: "resources.hp" },
    });
  }

  await activeScene.createEmbeddedDocuments("Token", tokenDocs);
  ui.notifications.info(`${pick.count}× ${doc.name} auf Szene platziert.`);
}

export function registerQuickNpcSceneControl() {
  const entry = {
    name:  "aborea-creatures",
    title: "ABOREA Kreaturen",
    icon:  "fas fa-dragon",
    layer: "TokenLayer",
    tools: [
      {
        name:    "quick-spawn",
        title:   "Kreatur schnell auf Szene platzieren",
        icon:    "fas fa-plus-circle",
        button:  true,
        onClick: () => spawnCreatureOnScene(),
      },
      {
        name:    "group-check",
        title:   "Gruppenprobe würfeln",
        icon:    "fas fa-users",
        button:  true,
        onClick: () => openGroupCheckDialog(),
      }
    ]
  };

  Hooks.on("getSceneControlButtonsV2", controls => {
    if (!game.user?.isGM) return;
    if (Array.isArray(controls)) controls.push(entry);
  });
  Hooks.on("getSceneControlButtons", controls => {
    if (!game.user?.isGM) return;
    if (Array.isArray(controls)) controls.push(entry);
    else if (controls && typeof controls === "object") controls[entry.name] = entry;
  });
}
