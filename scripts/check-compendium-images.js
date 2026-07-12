/**
 * Prüf-Makro: findet tote Bild-Pfade in allen ABOREA-System-Packs.
 * In Foundry als Script-Makro (GM) ausführen — nach buildSystemPacks().
 * Für jeden 404 wird der Ordnerinhalt gelistet, um schnell einen Ersatz zu finden.
 */
(async () => {
  const imgs = new Set();
  for (const pack of game.packs.filter(p => p.metadata.packageName === game.system.id)) {
    const docs = await pack.getDocuments();
    for (const doc of docs) {
      if (doc.img) imgs.add(doc.img);
      for (const item of doc.items ?? []) if (item.img) imgs.add(item.img);
    }
  }

  const missing = [];
  for (const img of imgs) {
    try {
      const res = await fetch(img, { method: "HEAD" });
      if (!res.ok) missing.push(img);
    } catch { missing.push(img); }
  }

  if (!missing.length) {
    ui.notifications.info(`Alle ${imgs.size} Bilder OK.`);
    return;
  }

  console.warn(`=== ${missing.length} fehlende Bilder ===`);
  const listedDirs = new Set();
  for (const img of missing.sort()) {
    console.warn(`FEHLT: ${img}`);
    const dir = img.substring(0, img.lastIndexOf("/"));
    if (listedDirs.has(dir)) continue;
    listedDirs.add(dir);
    try {
      const browse = await foundry.applications.apps.FilePicker.implementation.browse("public", dir);
      console.log(`  Verfügbar in ${dir}:`, browse.files.map(f => f.split("/").pop()).join(", "));
    } catch {
      console.log(`  Ordner ${dir} existiert nicht.`);
    }
  }
  ui.notifications.warn(`${missing.length} fehlende Bilder — Details in der Konsole (F12).`);
})();
