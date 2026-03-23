
async function fetchJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Konnte ${path} nicht laden (${response.status})`);
  return response.json();
}

function sourceFlag(doc) {
  return doc?.flags?.["aborea-v7"]?.sourceId ?? doc?.system?.externalId ?? doc?.name;
}

async function ensureWorldCompendium({ name, label, type }) {
  const key = `${game.world.id}.${name}`;
  let pack = game.packs.get(key);
  if (pack) return pack;

  await CompendiumCollection.createCompendium({
    package: "world",
    name,
    label,
    type,
    system: game.system.id,
    ownership: {
      PLAYER: "OBSERVER",
      ASSISTANT: "OWNER"
    }
  });

  return game.packs.get(key);
}

async function importDocumentsToPack(pack, docs) {
  const existing = await pack.getDocuments();
  const bySourceId = new Map(existing.map(doc => [sourceFlag(doc), doc]));
  const creates = [];
  const updates = [];

  for (const doc of docs) {
    const srcId = sourceFlag(doc);
    const current = bySourceId.get(srcId);
    if (current) {
      updates.push(foundry.utils.mergeObject(doc, { _id: current.id }, { inplace: false }));
    } else {
      creates.push(doc);
    }
  }

  const cls = getDocumentClass(pack.metadata.type);
  if (creates.length) await cls.createDocuments(creates, { pack: pack.collection, keepId: true });
  if (updates.length) await cls.updateDocuments(updates, { pack: pack.collection, diff: false, recursive: false });

  return { created: creates.length, updated: updates.length };
}

export async function importAboreaPackSources({ notify = true } = {}) {
  if (!game.user.isGM) throw new Error("Nur ein GM kann ABOREA-Compendien importieren.");

  const packIndex = await fetchJson("systems/aborea-v7/packs/index.json");
  const summary = [];

  for (const entry of packIndex.packs) {
    const worldPack = await ensureWorldCompendium({
      name: entry.worldName,
      label: `ABOREA: ${entry.label}`,
      type: entry.type
    });

    const docs = [];
    for (const filename of entry.documents) {
      const doc = await fetchJson(`${entry.path}/${filename}`);
      docs.push(doc);
    }

    const result = await importDocumentsToPack(worldPack, docs);
    summary.push({ pack: entry.worldName, label: entry.label, ...result, total: docs.length });
  }

  if (notify) {
    const text = summary.map(s => `${s.label}: ${s.created} neu, ${s.updated} aktualisiert`).join(" | ");
    ui.notifications.info(`ABOREA-Import abgeschlossen. ${text}`);
  }
  return summary;
}

export async function importSingleAboreaPack(key, { notify = true } = {}) {
  if (!game.user.isGM) throw new Error("Nur ein GM kann ABOREA-Compendien importieren.");
  const packIndex = await fetchJson("systems/aborea-v7/packs/index.json");
  const entry = packIndex.packs.find(p => p.key === key);
  if (!entry) throw new Error(`Unbekanntes Pack: ${key}`);

  const worldPack = await ensureWorldCompendium({
    name: entry.worldName,
    label: `ABOREA: ${entry.label}`,
    type: entry.type
  });
  const docs = [];
  for (const filename of entry.documents) docs.push(await fetchJson(`${entry.path}/${filename}`));
  const result = await importDocumentsToPack(worldPack, docs);
  if (notify) ui.notifications.info(`ABOREA ${entry.label}: ${result.created} neu, ${result.updated} aktualisiert.`);
  return result;
}
