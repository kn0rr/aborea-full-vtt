export async function loadSystemData() {
  const base = `systems/aborea-v7/data`;
  const files = ["races", "classes", "weapons", "armors", "spells", "miracles"];
  const data = {};

  for (const key of files) {
    try {
      const response = await fetch(`${base}/${key}.json`);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      data[key] = await response.json();
    } catch (err) {
      console.error(`ABOREA V7 | Konnte ${key}.json nicht laden`, err);
      data[key] = [];
    }
  }

  return data;
}
