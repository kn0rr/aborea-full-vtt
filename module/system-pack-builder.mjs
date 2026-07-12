async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`Konnte ${path} nicht laden (${response.status})`);
  }
  return response.json();
}

function sourceFlag(doc) {
  return doc?.flags?.["aborea-v7"]?.sourceId ?? doc?.system?.externalId ?? doc?._id ?? doc?.name;
}

function getSystemPack(key) {
  const collection = `${game.system.id}.${key}`;
  return game.packs.get(collection);
}

function normalizeDocs(docs) {
  return docs.map((doc, i) => {
    const clone = foundry.utils.deepClone(doc);
    clone.flags ??= {};
    clone.flags["aborea-v7"] ??= {};
    clone.flags["aborea-v7"].sourceId = sourceFlag(clone);
    clone.flags["aborea-v7"].sourceImg = clone.img ?? null;
    clone._id ??= foundry.utils.randomID(16);
    clone.sort ??= (i + 1) * 1000;
    clone.folder ??= null;
    return clone;
  });
}

/**
 * img-Schutz: manuell im Pack geänderte Bilder überleben den Re-Import.
 * sourceImg-Flag merkt sich das zuletzt importierte Quell-Bild — weicht das
 * aktuelle Bild davon ab, wurde es manuell gesetzt und bleibt erhalten.
 * Einträge ohne Flag (Alt-Bestand) bekommen einmalig das Quell-Bild.
 */
function protectManualImg(payload, existing) {
  const storedSourceImg = existing.flags?.["aborea-v7"]?.sourceImg;
  const manuallyChanged = storedSourceImg !== undefined
    && existing.img
    && existing.img !== storedSourceImg;
  if (manuallyChanged) payload.img = existing.img;
  return payload;
}

async function ensureUnlocked(pack) {
  if (pack.locked && pack.configure) await pack.configure({locked: false});
}

function getDocumentClassByType(type) {
  switch (type) {
    case "Actor": return CONFIG.Actor.documentClass;
    case "Item": return CONFIG.Item.documentClass;
    case "JournalEntry": return CONFIG.JournalEntry?.documentClass;
    case "RollTable": return CONFIG.RollTable?.documentClass;
    case "Scene": return CONFIG.Scene?.documentClass;
    default: return CONFIG[type]?.documentClass;
  }
}

async function upsertDocumentsToPack(pack, docs, {replace=false}={}) {
  await ensureUnlocked(pack);
  docs = normalizeDocs(docs);
  const existing = await pack.getDocuments();
  const bySource = new Map(existing.map(doc => [sourceFlag(doc), doc]));
  const creates = [];
  const updates = [];

  for (const doc of docs) {
    const srcId = sourceFlag(doc);
    const current = bySource.get(srcId);
    if (current) {
      const payload = foundry.utils.mergeObject(doc, {_id: current.id}, {inplace: false});
      updates.push(protectManualImg(payload, current));
    }
    else creates.push(doc);
  }

  const cls = pack.documentClass ?? getDocumentClassByType(pack.metadata.type);
  if (!cls) throw new Error(`Kein DocumentClass für Pack-Typ ${pack.metadata.type} gefunden.`);

  if (replace) {
    const incomingIds = new Set(docs.map(sourceFlag));
    // Nur selbst importierte Einträge (sourceId-Flag) löschen — manuell im
    // Kompendium angelegte Einträge bleiben auch bei replace:true erhalten.
    const deleteIds = existing
      .filter(doc => doc.flags?.["aborea-v7"]?.sourceId && !incomingIds.has(sourceFlag(doc)))
      .map(doc => doc.id);
    if (deleteIds.length) await cls.deleteDocuments(deleteIds, {pack: pack.collection});
  }
  if (creates.length) await cls.createDocuments(creates, {pack: pack.collection, keepId: true});
  if (updates.length) await cls.updateDocuments(updates, {pack: pack.collection, diff: false, recursive: false});
  return {created: creates.length, updated: updates.length, total: docs.length};
}

async function getBuildEntries() {
  const sys = await fetchJson(`systems/${game.system.id}/system.json`);
  const packs = Array.isArray(sys?.packs) ? sys.packs : [];
  const dataPathFor = (key) => `systems/${game.system.id}/data/${key}.json`;
  const entries = [];

  for (const pack of packs) {
    const key = pack.name;
    const docs = await fetchJson(dataPathFor(key));
    if (!docs) {
      console.warn(`ABOREA: überspringe Pack ${key}, keine Datenquelle unter ${dataPathFor(key)}.`);
      continue;
    }
    entries.push({ key, label: pack.label, type: pack.type, path: `data/${key}.json` });
  }
  return entries;
}

export async function buildSystemPacks({notify=true, replace=false}={}) {
  if (!game.user.isGM) throw new Error("Nur ein GM kann System-Packs befüllen.");

  const entries = await getBuildEntries();
  const summary = [];

  for (const entry of entries) {
    const pack = getSystemPack(entry.key);
    if (!pack) throw new Error(`System-Pack ${entry.key} (${game.system.id}.${entry.key}) wurde nicht gefunden.`);
    const docs = await fetchJson(`systems/${game.system.id}/${entry.path}`);
    if (!docs) continue;
    const result = await upsertDocumentsToPack(pack, docs, {replace});
    summary.push({pack: pack.collection, label: pack.metadata.label, ...result});
  }

  if (notify) {
    const text = summary.map(s => `${s.label}: ${s.created} neu, ${s.updated} aktualisiert`).join(" | ") || "keine Datenquellen";
    ui.notifications.info(`ABOREA System-Packs gebaut. ${text}`);
  }
  return summary;
}

export async function resetSystemPacks({notify=true, includeManual=false}={}) {
  if (!game.user.isGM) throw new Error("Nur ein GM kann System-Packs zurücksetzen.");
  const entries = await getBuildEntries();
  let kept = 0;
  for (const entry of entries) {
    const pack = getSystemPack(entry.key);
    if (!pack) continue;
    await ensureUnlocked(pack);
    const cls = pack.documentClass ?? getDocumentClassByType(pack.metadata.type);
    const docs = await pack.getDocuments();
    // Manuell angelegte Einträge (ohne sourceId-Flag) nur mit includeManual:true löschen
    const deletable = includeManual ? docs : docs.filter(d => d.flags?.["aborea-v7"]?.sourceId);
    kept += docs.length - deletable.length;
    if (deletable.length) await cls.deleteDocuments(deletable.map(d => d.id), {pack: pack.collection});
  }
  if (notify) {
    const keptHint = kept ? ` ${kept} manuelle(r) Eintrag/Einträge behalten.` : "";
    ui.notifications.info(`ABOREA System-Packs geleert.${keptHint}`);
  }
  return true;
}
