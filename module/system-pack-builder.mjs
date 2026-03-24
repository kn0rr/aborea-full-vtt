
export async function buildSystemPacks(){
  const manifest = game.system;
  if(!manifest || !Array.isArray(manifest.packs)) return;

  for(const p of manifest.packs){
    console.log("Pack:", p.name);
  }
}
