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
    clone._id ??= foundry.utils.randomID(16);
    clone.sort ??= (i + 1) * 1000;
    clone.folder ??= null;
    return clone;
  });
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

async function upsertDocumentsToPack(pack, docs, {replace=true}={}) {
  await ensureUnlocked(pack);
  docs = normalizeDocs(docs);
  const existing = await pack.getDocuments();
  const bySource = new Map(existing.map(doc => [sourceFlag(doc), doc]));
  const creates = [];
  const updates = [];

  for (const doc of docs) {
    const srcId = sourceFlag(doc);
    const current = bySource.get(srcId);
    if (current) updates.push(foundry.utils.mergeObject(doc, {_id: current.id}, {inplace: false}));
    else creates.push(doc);
  }

  const cls = pack.documentClass ?? getDocumentClassByType(pack.metadata.type);
  if (!cls) throw new Error(`Kein DocumentClass für Pack-Typ ${pack.metadata.type} gefunden.`);

  if (replace) {
    const incomingIds = new Set(docs.map(sourceFlag));
    const deleteIds = existing.filter(doc => !incomingIds.has(sourceFlag(doc))).map(doc => doc.id);
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

export async function buildSystemPacks({notify=true, replace=true}={}) {
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

export async function resetSystemPacks({notify=true}={}) {
  if (!game.user.isGM) throw new Error("Nur ein GM kann System-Packs zurücksetzen.");
  const entries = await getBuildEntries();
  for (const entry of entries) {
    const pack = getSystemPack(entry.key);
    if (!pack) continue;
    await ensureUnlocked(pack);
    const cls = pack.documentClass ?? getDocumentClassByType(pack.metadata.type);
    const docs = await pack.getDocuments();
    if (docs.length) await cls.deleteDocuments(docs.map(d => d.id), {pack: pack.collection});
  }
  if (notify) ui.notifications.info("ABOREA System-Packs geleert.");
  return true;
}
